import { PlainClientAPI } from 'contentful-management';
import { PageAppSDK, SidebarAppSDK } from '@contentful/app-sdk';
import { RateLimiter } from '../utils/rateLimiter';

export interface QueueItem {
  id: string;
  entryId: string;
  entryTitle: string;
  contentType: string;
  sourceEnv: string;
  targetEnv: string;
  dependencyCount: number;
  dependencyIds: string[];
  addedAt: number;
  addedBy: string;
}

// The queue lives in a single dedicated entry (JSON field) instead of app
// installation parameters. Entries have version numbers, so concurrent
// writes from multiple users fail with a 409 and retry against fresh data
// instead of silently overwriting each other.
const QUEUE_CONTENT_TYPE_ID = 'mergeQueueData';
const QUEUE_ENTRY_ID = 'merge-queue-data';
const MAX_RETRIES = 5;

export class QueueService {
  private cma: PlainClientAPI;
  private spaceId: string;
  private environmentId: string;
  private sdk: PageAppSDK | SidebarAppSDK;
  private rateLimiter: RateLimiter;
  private defaultLocale: string | null = null;

  constructor(cma: PlainClientAPI, spaceId: string, environmentId: string, sdk: PageAppSDK | SidebarAppSDK) {
    this.cma = cma;
    this.spaceId = spaceId;
    this.environmentId = environmentId;
    this.sdk = sdk;
    this.rateLimiter = new RateLimiter({
      maxRequestsPerSecond: 18,
      maxConcurrent: 10,
    });
  }

  async getQueue(): Promise<QueueItem[]> {
    const entry = await this.getQueueEntry();
    if (!entry) return [];
    const locale = await this.getDefaultLocale();
    return (entry.fields.items?.[locale]?.items as QueueItem[]) || [];
  }

  async addToQueue(item: Omit<QueueItem, 'id' | 'addedAt' | 'addedBy'>): Promise<void> {
    await this.mutateQueue((items) => {
      if (items.some((i) => i.entryId === item.entryId)) {
        throw new Error('Entry already in queue');
      }
      return [
        ...items,
        {
          ...item,
          id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          addedAt: Date.now(),
          addedBy: this.sdk.user.email || 'unknown',
        },
      ];
    });
  }

  async removeFromQueue(itemId: string): Promise<void> {
    await this.mutateQueue((items) => items.filter((i) => i.id !== itemId));
  }

  async clearQueue(): Promise<void> {
    await this.mutateQueue(() => []);
  }

  async isInQueue(entryId: string): Promise<boolean> {
    const items = await this.getQueue();
    return items.some((i) => i.entryId === entryId);
  }

  /**
   * Read-modify-write with optimistic locking: apply `mutate` to the current
   * items and save with the entry's version. On a 409 (someone else wrote
   * in between), re-read and retry.
   */
  private async mutateQueue(mutate: (items: QueueItem[]) => QueueItem[]): Promise<void> {
    const locale = await this.getDefaultLocale();

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const entry = (await this.getQueueEntry()) || (await this.createQueueEntry());
      const items = (entry.fields.items?.[locale]?.items as QueueItem[]) || [];
      const updated = mutate(items);

      try {
        await this.rateLimiter.execute(() =>
          this.cma.entry.update(
            { spaceId: this.spaceId, environmentId: this.environmentId, entryId: QUEUE_ENTRY_ID },
            {
              sys: entry.sys,
              fields: { items: { [locale]: { items: updated } } },
            } as any
          )
        );
        return;
      } catch (err: any) {
        const isVersionConflict =
          err.status === 409 || err.sys?.id === 'VersionMismatch' || err.message?.includes('VersionMismatch');
        if (!isVersionConflict || attempt === MAX_RETRIES - 1) {
          console.error('❌ [QueueService] Failed to save queue:', err);
          throw new Error('Failed to save queue');
        }
        // Version conflict — loop re-reads the fresh entry and retries.
      }
    }
  }

  private async getQueueEntry(): Promise<any | null> {
    try {
      return await this.rateLimiter.execute(() =>
        this.cma.entry.get({
          spaceId: this.spaceId,
          environmentId: this.environmentId,
          entryId: QUEUE_ENTRY_ID,
        })
      );
    } catch (err: any) {
      if (err.status === 404 || err.sys?.id === 'NotFound' || err.message?.includes('could not be found')) {
        return null;
      }
      console.error('❌ [QueueService] Failed to get queue:', err);
      return null;
    }
  }

  /** First use in an environment: create the storage content type + entry. */
  private async createQueueEntry(): Promise<any> {
    const locale = await this.getDefaultLocale();

    // Ensure the content type exists (idempotent — ignore "already exists").
    try {
      await this.cma.contentType.get({
        spaceId: this.spaceId,
        environmentId: this.environmentId,
        contentTypeId: QUEUE_CONTENT_TYPE_ID,
      });
    } catch {
      const ct = await this.cma.contentType.createWithId(
        { spaceId: this.spaceId, environmentId: this.environmentId, contentTypeId: QUEUE_CONTENT_TYPE_ID },
        {
          name: '🔀 Merge Queue (app data)',
          description: 'Internal storage for the Merge 3.0 app queue. Do not edit manually.',
          fields: [{ id: 'items', name: 'Items', type: 'Object', required: false, localized: false }],
        }
      );
      await this.cma.contentType.publish(
        { spaceId: this.spaceId, environmentId: this.environmentId, contentTypeId: QUEUE_CONTENT_TYPE_ID },
        ct
      );
    }

    try {
      return await this.cma.entry.createWithId(
        {
          spaceId: this.spaceId,
          environmentId: this.environmentId,
          entryId: QUEUE_ENTRY_ID,
          contentTypeId: QUEUE_CONTENT_TYPE_ID,
        },
        { fields: { items: { [locale]: { items: [] } } } }
      );
    } catch {
      // Raced another client creating it — fetch the winner.
      const entry = await this.getQueueEntry();
      if (entry) return entry;
      throw new Error('Failed to create merge queue storage entry');
    }
  }

  private async getDefaultLocale(): Promise<string> {
    if (this.defaultLocale) return this.defaultLocale;
    try {
      const locales = await this.rateLimiter.execute(() =>
        this.cma.locale.getMany({ spaceId: this.spaceId, environmentId: this.environmentId })
      );
      this.defaultLocale = locales.items.find((l: any) => l.default)?.code || 'en-US';
    } catch {
      this.defaultLocale = 'en-US';
    }
    return this.defaultLocale;
  }
}
