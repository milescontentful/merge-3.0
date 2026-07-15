import { PlainClientAPI } from 'contentful-management';
import { ChangeItem } from '../types';
import { RateLimiter, processInParallel } from '../utils/rateLimiter';

export class ConflictDetector {
  private cma: PlainClientAPI;
  private spaceId: string;
  private sourceEnvironmentId: string;
  private targetEnvironmentId: string;
  private rateLimiter: RateLimiter;

  constructor(
    cma: PlainClientAPI,
    spaceId: string,
    sourceEnvironmentId: string,
    targetEnvironmentId: string
  ) {
    this.cma = cma;
    this.spaceId = spaceId;
    this.sourceEnvironmentId = sourceEnvironmentId;
    this.targetEnvironmentId = targetEnvironmentId;
    // Initialize rate limiter for CMA calls
    this.rateLimiter = new RateLimiter({
      maxRequestsPerSecond: 18,
      maxConcurrent: 10,
    });
  }

  async detectChanges(
    items: Array<{ id: string; type: 'Entry' | 'Asset' }>
  ): Promise<ChangeItem[]> {
    
    // Process items in parallel with rate limiting
    const changes = await processInParallel(
      items,
      async (item) => {
        try {
          if (item.type === 'Entry') {
            return await this.detectEntryChange(item.id);
          } else if (item.type === 'Asset') {
            return await this.detectAssetChange(item.id);
          }
          return null;
        } catch (error) {
          console.error(`Error detecting change for ${item.type} ${item.id}:`, error);
          return null;
        }
      },
      {
        concurrency: 10,
      }
    );

    // Filter out null results
    const validChanges = changes.filter((c): c is ChangeItem => c !== null);

    const adds = validChanges.filter(c => c.changeType === 'add').length;
    const updates = validChanges.filter(c => c.changeType === 'update').length;
    const conflicts = validChanges.filter(c => c.hasConflict).length;
    

    return validChanges;
  }

  // Helper to extract all linked entry/asset IDs from an entry
  private extractLinks(entry: any): string[] {
    const links: string[] = [];
    const fields = entry.fields || {};
    
    Object.values(fields).forEach((field: any) => {
      if (!field) return;
      
      // Check if field is localized
      const fieldValues = typeof field === 'object' && !Array.isArray(field) && !field.sys 
        ? Object.values(field) 
        : [field];
      
      fieldValues.forEach((value: any) => {
        if (!value) return;
        
        // Handle arrays
        if (Array.isArray(value)) {
          value.forEach((item: any) => {
            if (item?.sys?.type === 'Link' && item.sys.id) {
              links.push(item.sys.id);
            }
          });
        }
        // Handle single links
        else if (value?.sys?.type === 'Link' && value.sys.id) {
          links.push(value.sys.id);
        }
      });
    });
    
    return [...new Set(links)]; // Remove duplicates
  }

  // Helper to fetch linked entries/assets (parallelized)
  private async fetchIncludes(entry: any, environmentId: string): Promise<Record<string, any>> {
    const includes: Record<string, any> = {};
    const linkIds = this.extractLinks(entry);
    
    if (linkIds.length === 0) {
      return includes;
    }
    
    // Fetch all linked entries/assets in parallel with rate limiting
    const results = await processInParallel(
      linkIds,
      async (linkId) => {
        try {
          // Try as entry first
          const linkedEntry = await this.rateLimiter.execute(() =>
            this.cma.entry.get({
              spaceId: this.spaceId,
              environmentId,
              entryId: linkId,
            })
          );
          return { linkId, item: linkedEntry };
        } catch (entryErr) {
          try {
            // Try as asset
            const linkedAsset = await this.rateLimiter.execute(() =>
              this.cma.asset.get({
                spaceId: this.spaceId,
                environmentId,
                assetId: linkId,
              })
            );
            return { linkId, item: linkedAsset };
          } catch (assetErr) {
            console.warn(`Could not fetch linked item ${linkId}`);
            return { linkId, item: null };
          }
        }
      },
      {
        concurrency: 10,
      }
    );
    
    // Build includes object from results
    for (const result of results) {
      if (result.item) {
        includes[result.linkId] = result.item;
      }
    }
    
    return includes;
  }

  private async detectEntryChange(entryId: string): Promise<ChangeItem | null> {
    try {
      
      // Get entry from source environment with rate limiting
      const sourceEntry = await this.rateLimiter.execute(() =>
        this.cma.entry.get({
          spaceId: this.spaceId,
          environmentId: this.sourceEnvironmentId,
          entryId: entryId,
        })
      );


      // Fetch includes for source entry
      const sourceIncludes = await this.fetchIncludes(sourceEntry, this.sourceEnvironmentId);

      // Try to get entry from target environment
      let targetEntry;
      let targetIncludes: Record<string, any> = {};
      let changeType: 'add' | 'update' | 'delete' = 'add';
      let hasConflict = false;

      try {
        targetEntry = await this.rateLimiter.execute(() =>
          this.cma.entry.get({
            spaceId: this.spaceId,
            environmentId: this.targetEnvironmentId,
            entryId: entryId,
          })
        );


        // Fetch includes for target entry
        targetIncludes = await this.fetchIncludes(targetEntry, this.targetEnvironmentId);

        // Entry exists in target, check if it's different
        if (
          sourceEntry.sys.updatedAt !== targetEntry.sys.updatedAt ||
          JSON.stringify(sourceEntry.fields) !== JSON.stringify(targetEntry.fields)
        ) {
          changeType = 'update';
          hasConflict = true; // Requires user decision to overwrite
        } else {
          // No changes needed
          return null;
        }
      } catch (error: any) {
        // Entry doesn't exist in target (404), so it's an add
        
        if (error.status === 404 || error.sys?.id === 'NotFound' || error.message?.includes('could not be found')) {
          changeType = 'add';
          hasConflict = false;
        } else {
          console.error('❌ [ConflictDetector] Unexpected error:', error);
          throw error;
        }
      }

      const title = this.extractTitle(sourceEntry);

      const result = {
        id: entryId,
        type: 'Entry',
        changeType,
        contentType: sourceEntry.sys.contentType?.sys.id,
        title,
        hasConflict,
        sourceData: {
          ...sourceEntry,
          includes: sourceIncludes,
        },
        targetData: targetEntry ? {
          ...targetEntry,
          includes: targetIncludes,
        } : undefined,
      };
      
      
      return result;
    } catch (error) {
      console.error(`❌ [ConflictDetector] Error detecting entry change for ${entryId}:`, error);
      return null;
    }
  }

  private async detectAssetChange(assetId: string): Promise<ChangeItem | null> {
    try {
      // Get asset from source environment with rate limiting
      const sourceAsset = await this.rateLimiter.execute(() =>
        this.cma.asset.get({
          spaceId: this.spaceId,
          environmentId: this.sourceEnvironmentId,
          assetId: assetId,
        })
      );

      // Try to get asset from target environment
      let targetAsset;
      let changeType: 'add' | 'update' | 'delete' = 'add';
      let hasConflict = false;

      try {
        targetAsset = await this.rateLimiter.execute(() =>
          this.cma.asset.get({
            spaceId: this.spaceId,
            environmentId: this.targetEnvironmentId,
            assetId: assetId,
          })
        );

        // Asset exists in target, check if it's different
        if (
          sourceAsset.sys.updatedAt !== targetAsset.sys.updatedAt ||
          JSON.stringify(sourceAsset.fields) !== JSON.stringify(targetAsset.fields)
        ) {
          changeType = 'update';
          hasConflict = true; // Requires user decision to overwrite
        } else {
          // No changes needed
          return null;
        }
      } catch (error: any) {
        // Asset doesn't exist in target (404), so it's an add
        
        if (error.status === 404 || error.sys?.id === 'NotFound' || error.message?.includes('could not be found')) {
          changeType = 'add';
          hasConflict = false;
        } else {
          console.error('❌ [ConflictDetector] Unexpected asset error:', error);
          throw error;
        }
      }

      const title = sourceAsset.fields?.title?.['en-US'] || 
                    sourceAsset.fields?.title?.[Object.keys(sourceAsset.fields?.title || {})[0]] || 
                    'Untitled Asset';

      return {
        id: assetId,
        type: 'Asset',
        changeType,
        title,
        hasConflict,
        sourceData: sourceAsset,
        targetData: targetAsset,
      };
    } catch (error) {
      console.error(`Error detecting asset change for ${assetId}:`, error);
      return null;
    }
  }

  private extractTitle(entry: any): string {
    const titleFields = ['title', 'name', 'internalName', 'heading'];
    
    for (const fieldName of titleFields) {
      if (entry.fields?.[fieldName]) {
        const field = entry.fields[fieldName];
        const locale = Object.keys(field)[0];
        if (field[locale]) {
          return String(field[locale]).substring(0, 100);
        }
      }
    }

    return entry.sys.id;
  }
}

