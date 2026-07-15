import { PlainClientAPI } from 'contentful-management';
import { ChangeItem, ConflictResolution, FieldResolution, MergeProgress } from '../types';
import { RateLimiter, retryWithBackoff } from '../utils/rateLimiter';

export class MergeExecutor {
  private cma: PlainClientAPI;
  private spaceId: string;
  private targetEnvironmentId: string;
  private autoPublish: boolean;
  private onProgress?: (progress: MergeProgress) => void;
  private rateLimiter: RateLimiter;
  // entryId -> field names where the user chose to keep the TARGET value
  private keepTargetFields: Map<string, Set<string>> = new Map();

  constructor(
    cma: PlainClientAPI,
    spaceId: string,
    targetEnvironmentId: string,
    autoPublish: boolean = true,
    onProgress?: (progress: MergeProgress) => void
  ) {
    this.cma = cma;
    this.spaceId = spaceId;
    this.targetEnvironmentId = targetEnvironmentId;
    this.autoPublish = autoPublish;
    this.onProgress = onProgress;
    // Initialize rate limiter: 18 requests/second, max 10 concurrent
    this.rateLimiter = new RateLimiter({
      maxRequestsPerSecond: 18,
      maxConcurrent: 10,
    });
  }

  async executeMerge(
    changes: ChangeItem[],
    resolutions: ConflictResolution[],
    fieldResolutions: FieldResolution[] = []
  ): Promise<MergeProgress> {
    // Index the per-field choices from the preview dialog
    this.keepTargetFields = new Map();
    for (const fr of fieldResolutions) {
      if (fr.useSource) continue; // default behavior — source wins
      if (!this.keepTargetFields.has(fr.entryId)) this.keepTargetFields.set(fr.entryId, new Set());
      this.keepTargetFields.get(fr.entryId)!.add(fr.fieldName);
    }
    
    const progress: MergeProgress = {
      total: changes.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      status: 'processing',
      errors: [],
    };

    // Filter out skipped items
    const resolutionMap = new Map(resolutions.map((r) => [r.id, r.action]));
    const itemsToProcess = changes.filter((change) => {
      if (change.hasConflict) {
        return resolutionMap.get(change.id) === 'overwrite';
      }
      return true; // Process non-conflict items
    });


    // Separate assets and entries, process assets first
    const assets = itemsToProcess.filter((item) => item.type === 'Asset');
    const entries = itemsToProcess.filter((item) => item.type === 'Entry');
    

    // Process assets first (as they may be referenced by entries)
    for (const asset of assets) {
      try {
        progress.currentItem = `Asset: ${asset.title || asset.id}`;
        this.reportProgress(progress);

        await this.processAsset(asset);
        progress.succeeded++;
      } catch (error: any) {
        console.error(`Error processing asset ${asset.id}:`, error);
        progress.failed++;
        progress.errors.push({
          id: asset.id,
          message: error.message || 'Unknown error',
        });
      }
      progress.processed++;
      this.reportProgress(progress);
    }

    // Process entries
    for (const entry of entries) {
      try {
        progress.currentItem = `Entry: ${entry.title || entry.id}`;
        this.reportProgress(progress);

        await this.processEntry(entry);
        progress.succeeded++;
      } catch (error: any) {
        console.error(`Error processing entry ${entry.id}:`, error);
        progress.failed++;
        progress.errors.push({
          id: entry.id,
          message: error.message || 'Unknown error',
        });
      }
      progress.processed++;
      this.reportProgress(progress);
    }

    progress.status = progress.failed > 0 ? 'error' : 'completed';
    progress.currentItem = undefined;
    this.reportProgress(progress);

    return progress;
  }

  private async processAsset(change: ChangeItem): Promise<void> {
    if (!change.sourceData) {
      throw new Error('Source data not found');
    }

    const sourceAsset = change.sourceData;

    if (change.changeType === 'add') {
      // Create new asset with rate limiting and retry
      const newAsset = await this.rateLimiter.execute(() =>
        retryWithBackoff(
          () => this.cma.asset.createWithId(
            {
              spaceId: this.spaceId,
              environmentId: this.targetEnvironmentId,
              assetId: change.id,
            },
            {
              fields: sourceAsset.fields,
            }
          ),
          {
            onRetry: (attempt, error) => {
            },
          }
        )
      );

      // Process the asset to make it available with rate limiting and retry
      await this.rateLimiter.execute(() =>
        retryWithBackoff(
          () => this.cma.asset.processForAllLocales(
            {
              spaceId: this.spaceId,
              environmentId: this.targetEnvironmentId,
              assetId: newAsset.sys.id,
            },
            newAsset
          ),
          {
            onRetry: (attempt, error) => {
            },
          }
        )
      );

      // Asset created as draft - users can bulk publish in Contentful UI
    } else if (change.changeType === 'update') {
      // Update existing asset
      const targetAsset = change.targetData;
      
      const updatedAsset = await this.rateLimiter.execute(() =>
        retryWithBackoff(
          () => this.cma.asset.update(
            {
              spaceId: this.spaceId,
              environmentId: this.targetEnvironmentId,
              assetId: change.id,
            },
            {
              ...targetAsset,
              fields: sourceAsset.fields,
            }
          ),
          {
            onRetry: (attempt, error) => {
            },
          }
        )
      );

      // Re-process the asset with rate limiting and retry
      await this.rateLimiter.execute(() =>
        retryWithBackoff(
          () => this.cma.asset.processForAllLocales(
            {
              spaceId: this.spaceId,
              environmentId: this.targetEnvironmentId,
              assetId: updatedAsset.sys.id,
            },
            updatedAsset
          ),
          {
            onRetry: (attempt, error) => {
            },
          }
        )
      );

      // Asset updated as draft - users can bulk publish in Contentful UI
    }
  }

  private async processEntry(change: ChangeItem): Promise<void> {
    
    if (!change.sourceData) {
      throw new Error('Source data not found');
    }

    const sourceEntry = change.sourceData;

    if (change.changeType === 'add') {
      
      // Create new entry with rate limiting and retry
      const newEntry = await this.rateLimiter.execute(() =>
        retryWithBackoff(
          () => this.cma.entry.createWithId(
            {
              spaceId: this.spaceId,
              environmentId: this.targetEnvironmentId,
              entryId: change.id,
              contentTypeId: sourceEntry.sys.contentType.sys.id,
            },
            {
              fields: sourceEntry.fields,
            }
          ),
          {
            onRetry: (attempt, error) => {
            },
          }
        )
      );
      
    } else if (change.changeType === 'update') {
      
      // Update existing entry. Start from source fields, then restore any
      // fields the user chose to keep from the target in the preview.
      const targetEntry = change.targetData;
      const keep = this.keepTargetFields.get(change.id);
      let fields = sourceEntry.fields;
      if (keep && keep.size > 0) {
        fields = { ...sourceEntry.fields };
        for (const fieldName of keep) {
          if (targetEntry?.fields?.[fieldName] !== undefined) {
            fields[fieldName] = targetEntry.fields[fieldName];
          } else {
            delete fields[fieldName]; // target had no value — keep it absent
          }
        }
      }

      const updatedEntry = await this.rateLimiter.execute(() =>
        retryWithBackoff(
          () => this.cma.entry.update(
            {
              spaceId: this.spaceId,
              environmentId: this.targetEnvironmentId,
              entryId: change.id,
            },
            {
              ...targetEntry,
              fields,
            }
          ),
          {
            onRetry: (attempt, error) => {
            },
          }
        )
      );
      
    }
    
  }

  private reportProgress(progress: MergeProgress): void {
    if (this.onProgress) {
      this.onProgress({ ...progress });
    }
  }
}

