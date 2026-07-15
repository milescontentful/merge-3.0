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

interface QueueData {
  items: QueueItem[];
}

export class QueueService {
  private cma: PlainClientAPI;
  private spaceId: string;
  private environmentId: string;
  private sdk: PageAppSDK | SidebarAppSDK;
  private rateLimiter: RateLimiter;
  private static QUEUE_KEY = 'mergeQueue';

  constructor(cma: PlainClientAPI, spaceId: string, environmentId: string, sdk: PageAppSDK | SidebarAppSDK) {
    this.cma = cma;
    this.spaceId = spaceId;
    this.environmentId = environmentId;
    this.sdk = sdk;
    // Initialize rate limiter for CMA calls
    this.rateLimiter = new RateLimiter({
      maxRequestsPerSecond: 18,
      maxConcurrent: 10,
    });
  }

  /**
   * Get all items in the queue
   */
  async getQueue(): Promise<QueueItem[]> {
    
    try {
      // Use CMA to get app installation data with rate limiting
      const appInstallation = await this.rateLimiter.execute(() =>
        this.cma.appInstallation.get({
          spaceId: this.spaceId,
          environmentId: this.environmentId,
          appDefinitionId: this.sdk.ids.app!,
        })
      );


      const parameters = appInstallation.parameters as any;
      const queueData = parameters?.[QueueService.QUEUE_KEY] as QueueData | undefined;
      
      
      return queueData?.items || [];
    } catch (err: any) {
      console.error('❌ [QueueService] Failed to get queue:', err);
      console.error('❌ [QueueService] Error message:', err.message);
      console.error('❌ [QueueService] Error details:', err);
      // If not found, return empty array
      if (err.message?.includes('not found')) {
        return [];
      }
      return [];
    }
  }

  /**
   * Add an item to the queue
   */
  async addToQueue(item: Omit<QueueItem, 'id' | 'addedAt' | 'addedBy'>): Promise<void> {
    
    const items = await this.getQueue();
    
    // Check if entry already in queue
    const existingIndex = items.findIndex(i => i.entryId === item.entryId);
    if (existingIndex >= 0) {
      throw new Error('Entry already in queue');
    }

    const newItem: QueueItem = {
      ...item,
      id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      addedAt: Date.now(),
      addedBy: this.sdk.user.email || 'unknown',
    };

    items.push(newItem);
    
    await this.saveQueue(items);
  }

  /**
   * Remove an item from the queue
   */
  async removeFromQueue(itemId: string): Promise<void> {
    const items = await this.getQueue();
    const filtered = items.filter(i => i.id !== itemId);
    await this.saveQueue(filtered);
  }

  /**
   * Clear all items from the queue
   */
  async clearQueue(): Promise<void> {
    await this.saveQueue([]);
  }

  /**
   * Check if an entry is already in the queue
   */
  async isInQueue(entryId: string): Promise<boolean> {
    const items = await this.getQueue();
    return items.some(i => i.entryId === entryId);
  }

  /**
   * Save the queue to App Installation parameters
   */
  private async saveQueue(items: QueueItem[]): Promise<void> {
    
    const data: QueueData = { items };
    
    try {
      
      // Get current app installation with rate limiting
      const appInstallation = await this.rateLimiter.execute(() =>
        this.cma.appInstallation.get({
          spaceId: this.spaceId,
          environmentId: this.environmentId,
          appDefinitionId: this.sdk.ids.app!,
        })
      );


      // Update parameters with queue data
      const updatedParameters = {
        ...appInstallation.parameters,
        [QueueService.QUEUE_KEY]: data,
      };


      // Update app installation with rate limiting
      const result = await this.rateLimiter.execute(() =>
        this.cma.appInstallation.upsert(
          {
            spaceId: this.spaceId,
            environmentId: this.environmentId,
            appDefinitionId: this.sdk.ids.app!,
          },
          {
            parameters: updatedParameters,
          }
        )
      );
      
    } catch (err) {
      console.error('❌ [QueueService] Failed to save queue:', err);
      console.error('❌ [QueueService] Error details:', err);
      throw new Error('Failed to save queue');
    }
  }
}
