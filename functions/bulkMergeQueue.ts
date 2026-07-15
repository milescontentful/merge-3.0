import { FunctionTypeEnum } from '@contentful/node-apps-toolkit';
import type { AppActionRequest, FunctionEventHandler } from '@contentful/node-apps-toolkit';
import { makeCmaFetch, extractTitle } from './lib';

/**
 * "Add to Merge Queue" — an Entries.v1.0 App Action, so it appears in the
 * content list's bulk-selection toolbar (next to Run AI Action). Adds every
 * selected entry to the app's merge queue (the same optimistically-locked
 * `merge-queue-data` entry the frontend QueueService uses).
 */

const QUEUE_CONTENT_TYPE_ID = 'mergeQueueData';
const QUEUE_ENTRY_ID = 'merge-queue-data';
const MAX_RETRIES = 5;

export const handler: FunctionEventHandler<FunctionTypeEnum.AppActionCall> = async (event, context) => {
  const { body } = event as AppActionRequest<'Entries.v1.0'>;
  const ids = (body.entryIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: 'No entries selected' };

  const params = context.appInstallationParameters as any;
  const cmaToken = params?.cmaToken as string | undefined;
  if (!cmaToken) return { ok: false, error: 'No CMA token in app configuration' };
  const cf = makeCmaFetch(cmaToken);

  const envBase = `/spaces/${context.spaceId}/environments/${context.environmentId}`;

  try {
    // One batched fetch for titles/content types
    const entries = await cf('GET', `${envBase}/entries?sys.id[in]=${ids.join(',')}&limit=100`);
    const byId = new Map((entries.items || []).map((e: any) => [e.sys.id, e]));

    // Default locale for the queue entry's JSON field
    const locales = await cf('GET', `${envBase}/locales`);
    const locale = (locales.items || []).find((l: any) => l.default)?.code || 'en-US';

    // Read-modify-write the queue with optimistic locking (mirrors QueueService)
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let queueEntry: any;
      try {
        queueEntry = await cf('GET', `${envBase}/entries/${QUEUE_ENTRY_ID}`);
      } catch (err: any) {
        if (err.status !== 404) throw err;
        // Bootstrap content type + entry on first use
        try {
          await cf('GET', `${envBase}/content_types/${QUEUE_CONTENT_TYPE_ID}`);
        } catch {
          const ct = await cf('PUT', `${envBase}/content_types/${QUEUE_CONTENT_TYPE_ID}`, {
            name: '🔀 Merge Queue (app data)',
            description: 'Internal storage for the Merge 3.0 app queue. Do not edit manually.',
            fields: [{ id: 'items', name: 'Items', type: 'Object', required: false, localized: false }],
          });
          await cf('PUT', `${envBase}/content_types/${QUEUE_CONTENT_TYPE_ID}/published`, undefined, {
            'X-Contentful-Version': String(ct.sys.version),
          });
        }
        queueEntry = await cf(
          'PUT',
          `${envBase}/entries/${QUEUE_ENTRY_ID}`,
          { fields: { items: { [locale]: { items: [] } } } },
          { 'X-Contentful-Content-Type': QUEUE_CONTENT_TYPE_ID }
        );
      }

      const items: any[] = queueEntry.fields?.items?.[locale]?.items || [];
      const queuedEntryIds = new Set(items.map((i) => i.entryId));
      const fresh = ids.filter((id) => !queuedEntryIds.has(id));

      const added = fresh.map((id) => {
        const entry: any = byId.get(id);
        return {
          id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          entryId: id,
          entryTitle: entry ? extractTitle(entry, id) : id,
          contentType: entry?.sys?.contentType?.sys?.id || 'unknown',
          sourceEnv: context.environmentId,
          targetEnv: params?.defaultTargetEnvironment || '',
          dependencyCount: 0, // dependencies are re-resolved at merge time
          dependencyIds: [],
          addedAt: Date.now(),
          addedBy: 'bulk action',
        };
      });

      if (added.length === 0) {
        return { ok: true, added: 0, skipped: ids.length, message: 'All selected entries are already queued' };
      }

      try {
        await cf(
          'PUT',
          `${envBase}/entries/${QUEUE_ENTRY_ID}`,
          {
            fields: { items: { [locale]: { items: [...items, ...added] } } },
          },
          { 'X-Contentful-Version': String(queueEntry.sys.version) }
        );
        return { ok: true, added: added.length, skipped: ids.length - added.length };
      } catch (err: any) {
        if (err.status !== 409 || attempt === MAX_RETRIES - 1) throw err;
        // Version conflict — re-read and retry
      }
    }
    return { ok: false, error: 'Queue update kept conflicting — try again' };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to add entries to the merge queue' };
  }
};
