/**
 * Initial Sync Service
 * Syncs all existing content from master to replica and creates mappings
 * Used for production systems where data existed before sync was active
 */

export default ({ strapi: strapiInstance }: { strapi: any }) => {
  const strapi = strapiInstance;

  return {
    /**
     * Perform initial sync from master (REPLICA SIDE)
     * Fetches all content from master API and creates local copies with mappings
     */
    async pullFromMaster(options: {
      masterUrl: string;
      masterApiToken?: string;
      contentTypes?: string[];
      dryRun?: boolean;
    }): Promise<{
      success: boolean;
      synced: number;
      skipped: number;
      errors: string[];
      details: Array<{ contentType: string; masterDocId: string; localDocId: string; action: string }>;
    }> {
      const config = strapi.config.get('plugin::offline-sync', {});
      
      if (config.mode !== 'replica') {
        throw new Error('pullFromMaster only available in replica mode');
      }

      const shipId = config.shipId;
      const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
      
      const result = {
        success: true,
        synced: 0,
        skipped: 0,
        errors: [] as string[],
        details: [] as Array<{ contentType: string; masterDocId: string; localDocId: string; action: string }>,
      };

      // Get content types to sync
      const contentTypesToSync = options.contentTypes || config.contentTypes || [];
      
      if (contentTypesToSync.length === 0) {
        result.errors.push('No content types configured for sync');
        result.success = false;
        return result;
      }

      strapi.log.info(`[InitialSync] Starting pull from master: ${options.masterUrl}`);
      strapi.log.info(`[InitialSync] Content types: ${contentTypesToSync.join(', ')}`);
      strapi.log.info(`[InitialSync] Dry run: ${options.dryRun ? 'YES' : 'NO'}`);

      for (const contentType of contentTypesToSync) {
        try {
          strapi.log.info(`[InitialSync] Processing ${contentType}...`);
          
          // Fetch all content from master
          const apiPath = this.contentTypeToApiPath(contentType);
          const masterContent = await this.fetchFromMaster(
            options.masterUrl,
            apiPath,
            options.masterApiToken
          );

          if (!masterContent || !Array.isArray(masterContent)) {
            strapi.log.warn(`[InitialSync] No content found for ${contentType}`);
            continue;
          }

          strapi.log.info(`[InitialSync] Found ${masterContent.length} items in ${contentType}`);

          for (const masterDoc of masterContent) {
            const masterDocId = masterDoc.documentId || masterDoc.id;
            
            if (!masterDocId) {
              result.errors.push(`${contentType}: Document missing ID`);
              continue;
            }

            try {
              // Check if mapping already exists
              const existingMapping = await documentMapping.findByMasterDocumentId(
                shipId,
                contentType,
                masterDocId
              );

              if (existingMapping) {
                // Mapping exists - skip or update
                result.skipped++;
                result.details.push({
                  contentType,
                  masterDocId,
                  localDocId: existingMapping.replicaDocumentId,
                  action: 'skipped (mapping exists)',
                });
                continue;
              }

              // Try to find local document by matching fields
              const localDoc = await this.findMatchingLocalDocument(
                contentType,
                masterDoc
              );

              if (options.dryRun) {
                // Dry run - just log what would happen
                result.details.push({
                  contentType,
                  masterDocId,
                  localDocId: localDoc?.documentId || 'WOULD_CREATE',
                  action: localDoc ? 'would link' : 'would create',
                });
                result.synced++;
                continue;
              }

              if (localDoc) {
                // Found matching local document - create mapping
                await documentMapping.setMapping(
                  shipId,
                  contentType,
                  localDoc.documentId,
                  masterDocId
                );
                
                result.synced++;
                result.details.push({
                  contentType,
                  masterDocId,
                  localDocId: localDoc.documentId,
                  action: 'linked existing',
                });
                
                strapi.log.info(`[InitialSync] Linked: ${masterDocId} → ${localDoc.documentId}`);
              } else {
                // No local document - create new one
                const cleanedData = this.cleanSyncData(masterDoc);
                
                const created = await strapi.documents(contentType).create({
                  data: cleanedData,
                  status: 'published',
                });

                if (created?.documentId) {
                  await documentMapping.setMapping(
                    shipId,
                    contentType,
                    created.documentId,
                    masterDocId
                  );
                  
                  result.synced++;
                  result.details.push({
                    contentType,
                    masterDocId,
                    localDocId: created.documentId,
                    action: 'created new',
                  });
                  
                  strapi.log.info(`[InitialSync] Created: ${masterDocId} → ${created.documentId}`);
                }
              }
            } catch (docError: any) {
              result.errors.push(`${contentType}/${masterDocId}: ${docError.message}`);
            }
          }
        } catch (typeError: any) {
          result.errors.push(`${contentType}: ${typeError.message}`);
        }
      }

      strapi.log.info(`[InitialSync] Complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} errors`);
      
      if (result.errors.length > 0) {
        result.success = result.synced > 0; // Partial success if some items synced
      }

      return result;
    },

    /**
     * Create mappings for existing content that matches between master and replica
     * This doesn't create new content, just establishes mappings
     */
    async createMappingsOnly(options: {
      contentTypes?: string[];
      matchBy?: 'id' | 'name' | 'custom';
      customMatcher?: (masterDoc: any, localDoc: any) => boolean;
    }): Promise<{
      success: boolean;
      mapped: number;
      errors: string[];
    }> {
      const config = strapi.config.get('plugin::offline-sync', {});
      
      if (config.mode !== 'replica') {
        throw new Error('createMappingsOnly only available in replica mode');
      }

      // This would require master API access or a shared database
      // For now, return instructions
      return {
        success: false,
        mapped: 0,
        errors: ['Use pullFromMaster with dryRun=true first to see what would be synced'],
      };
    },

    /**
     * Convert content type to API path
     */
    contentTypeToApiPath(contentType: string): string {
      // api::benefit.benefit -> /api/benefits
      // api::add-on.add-on -> /api/add-ons
      const parts = contentType.split('.');
      const name = parts[parts.length - 1];
      
      // Simple pluralization (works for most cases)
      let plural = name;
      if (name.endsWith('y')) {
        plural = name.slice(0, -1) + 'ies';
      } else if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) {
        plural = name + 'es';
      } else {
        plural = name + 's';
      }
      
      return `/api/${plural}`;
    },

    /**
     * Fetch content from master API
     */
    async fetchFromMaster(
      masterUrl: string,
      apiPath: string,
      apiToken?: string
    ): Promise<any[]> {
      const url = `${masterUrl}${apiPath}?pagination[pageSize]=1000&populate=*`;
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (apiToken) {
        headers['Authorization'] = `Bearer ${apiToken}`;
      }

      try {
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const json = await response.json();
        return json.data || [];
      } catch (error: any) {
        strapi.log.error(`[InitialSync] Failed to fetch ${apiPath}: ${error.message}`);
        throw error;
      }
    },

    /**
     * Find matching local document by comparing key fields
     */
    async findMatchingLocalDocument(
      contentType: string,
      masterDoc: any
    ): Promise<any | null> {
      try {
        // Try to find by name/title first
        const nameField = masterDoc.name || masterDoc.title || masterDoc.label;
        
        if (nameField) {
          const results = await strapi.documents(contentType).findMany({
            filters: {
              $or: [
                { name: { $eq: nameField } },
                { title: { $eq: nameField } },
                { label: { $eq: nameField } },
              ],
            },
            limit: 1,
          });
          
          if (results && results.length > 0) {
            return results[0];
          }
        }

        // Try to find by slug if available
        if (masterDoc.slug) {
          const results = await strapi.documents(contentType).findMany({
            filters: { slug: { $eq: masterDoc.slug } },
            limit: 1,
          });
          
          if (results && results.length > 0) {
            return results[0];
          }
        }

        return null;
      } catch (error: any) {
        strapi.log.debug(`[InitialSync] Error finding match: ${error.message}`);
        return null;
      }
    },

    /**
     * Clean sync data - remove internal Strapi fields
     */
    cleanSyncData(data: any): any {
      if (!data || typeof data !== 'object') return data;

      const cleaned = { ...data };
      
      // Remove internal fields
      delete cleaned.id;
      delete cleaned.documentId;
      delete cleaned.createdAt;
      delete cleaned.updatedAt;
      delete cleaned.publishedAt;
      delete cleaned.createdBy;
      delete cleaned.updatedBy;
      delete cleaned.localizations;
      delete cleaned.locale;
      
      return cleaned;
    },
  };
};

