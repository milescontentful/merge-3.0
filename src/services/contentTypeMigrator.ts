import { PlainClientAPI } from 'contentful-management';

export interface MissingContentType {
  id: string;
  name: string;
  existsInSource: boolean;
  existsInTarget: boolean;
}

export class ContentTypeMigrator {
  private cma: PlainClientAPI;
  private spaceId: string;
  private sourceEnvironmentId: string;
  private targetEnvironmentId: string;

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
  }

  /**
   * Check which content types are missing in the target environment
   */
  async detectMissingContentTypes(entries: any[]): Promise<MissingContentType[]> {
    
    const contentTypeIds = new Set<string>();
    
    // Extract all content type IDs from entries
    entries.forEach(entry => {
      const contentTypeId = entry.sys?.contentType?.sys?.id;
      if (contentTypeId) {
        contentTypeIds.add(contentTypeId);
      }
    });


    const missing: MissingContentType[] = [];

    for (const contentTypeId of contentTypeIds) {
      try {
        // Check if content type exists in target
        await this.cma.contentType.get({
          spaceId: this.spaceId,
          environmentId: this.targetEnvironmentId,
          contentTypeId,
        });
        // Content type exists in target
      } catch (err: any) {
        if (err.message?.includes('not found') || err.message?.includes('could not be found') || err.sys?.id === 'NotFound') {
          // Content type missing in target
          console.warn('⚠️ [ContentTypeMigrator] Content type missing in target:', contentTypeId);
          
          try {
            // Get content type from source to get the name
            const sourceContentType = await this.cma.contentType.get({
              spaceId: this.spaceId,
              environmentId: this.sourceEnvironmentId,
              contentTypeId,
            });
            
            missing.push({
              id: contentTypeId,
              name: sourceContentType.name,
              existsInSource: true,
              existsInTarget: false,
            });
          } catch (sourceErr) {
            console.error('❌ [ContentTypeMigrator] Could not fetch content type from source:', contentTypeId, sourceErr);
            missing.push({
              id: contentTypeId,
              name: contentTypeId,
              existsInSource: false,
              existsInTarget: false,
            });
          }
        }
      }
    }

    return missing;
  }

  /**
   * Copy a single content type from source to target environment
   */
  async copyContentType(contentTypeId: string): Promise<void> {

    try {
      // 1. Fetch content type from source
      const sourceContentType = await this.cma.contentType.get({
        spaceId: this.spaceId,
        environmentId: this.sourceEnvironmentId,
        contentTypeId,
      });


      // 2. Prepare content type data (remove system fields)
      const contentTypeData: any = {
        name: sourceContentType.name,
        description: sourceContentType.description,
        displayField: sourceContentType.displayField,
        fields: sourceContentType.fields,
      };


      // 3. Create content type in target
      const createdContentType = await this.cma.contentType.createWithId(
        {
          spaceId: this.spaceId,
          environmentId: this.targetEnvironmentId,
          contentTypeId,
        },
        contentTypeData
      );


      // 4. Publish the content type
      await this.cma.contentType.publish(
        {
          spaceId: this.spaceId,
          environmentId: this.targetEnvironmentId,
          contentTypeId,
        },
        createdContentType
      );

    } catch (err: any) {
      console.error('❌ [ContentTypeMigrator] Failed to copy content type:', contentTypeId, err);
      throw new Error(`Failed to copy content type ${contentTypeId}: ${err.message}`);
    }
  }

  /**
   * Copy multiple content types from source to target
   */
  async copyContentTypes(contentTypeIds: string[]): Promise<{ success: string[]; failed: string[] }> {

    const success: string[] = [];
    const failed: string[] = [];

    for (const contentTypeId of contentTypeIds) {
      try {
        await this.copyContentType(contentTypeId);
        success.push(contentTypeId);
      } catch (err) {
        failed.push(contentTypeId);
      }
    }


    return { success, failed };
  }
}

