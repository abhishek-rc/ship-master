/**
 * Media Sync Service
 * 
 * Handles media synchronization between master (OSS) and replica (MinIO).
 * Uses the minio npm package to:
 * - Sync files from OSS to local MinIO when online
 * - Transform media URLs in content during sync
 * - Track sync status and handle offline scenarios
 */

import { Client as MinioClient } from 'minio';

interface MediaConfig {
  enabled: boolean;
  transformUrls: boolean;
  syncOnStartup: boolean;
  syncInterval: number;
  oss: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    baseUrl: string;
    region?: string;
    uploadPath?: string;  // Path prefix for uploads (e.g., 'strapi-uploads')
    pathStyle?: boolean;  // Use path-style URLs (false for Alibaba OSS)
  };
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    baseUrl: string;
  };
  mediaFields: string[];
}

interface SyncStats {
  lastSyncAt: Date | null;
  filesDownloaded: number;
  filesSkipped: number;
  filesFailed: number;
  totalBytes: number;
  isRunning: boolean;
  error: string | null;
}

export default ({ strapi }: { strapi: any }) => {
  let ossClient: MinioClient | null = null;
  let minioClient: MinioClient | null = null;
  let syncIntervalId: NodeJS.Timeout | null = null;
  let isSyncing = false;

  const syncStats: SyncStats = {
    lastSyncAt: null,
    filesDownloaded: 0,
    filesSkipped: 0,
    filesFailed: 0,
    totalBytes: 0,
    isRunning: false,
    error: null,
  };

  /**
   * Escape special regex characters in a string
   */
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  /**
   * Get media configuration from plugin config
   */
  const getMediaConfig = (): MediaConfig | null => {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (!config.media?.enabled) {
      return null;
    }

    return {
      enabled: config.media.enabled,
      transformUrls: config.media.transformUrls !== false,
      syncOnStartup: config.media.syncOnStartup !== false,
      syncInterval: config.media.syncInterval || 300000, // 5 minutes default
      oss: {
        endPoint: config.media.oss?.endPoint || '',
        port: config.media.oss?.port || 443,
        useSSL: config.media.oss?.useSSL !== false,
        accessKey: config.media.oss?.accessKey || '',
        secretKey: config.media.oss?.secretKey || '',
        bucket: config.media.oss?.bucket || '',
        baseUrl: config.media.oss?.baseUrl || '',
        region: config.media.oss?.region || '',
        uploadPath: config.media.oss?.uploadPath || '',  // Path prefix (e.g., 'strapi-uploads')
        pathStyle: config.media.oss?.pathStyle === true,  // Default false for Alibaba OSS
      },
      minio: {
        endPoint: config.media.minio?.endPoint || 'localhost',
        port: config.media.minio?.port || 9000,
        useSSL: config.media.minio?.useSSL || false,
        accessKey: config.media.minio?.accessKey || 'minioadmin',
        secretKey: config.media.minio?.secretKey || 'minioadmin',
        bucket: config.media.minio?.bucket || 'media',
        baseUrl: config.media.minio?.baseUrl || 'http://localhost:9000/media',
      },
      mediaFields: config.media.mediaFields || [
        'url', 'src', 'href', 'image', 'thumbnail', 'video', 'file',
        'formats', 'previewUrl', 'provider_metadata',
      ],
    };
  };

  /**
   * Initialize MinIO clients
   */
  const initClients = (): boolean => {
    const config = getMediaConfig();
    if (!config) {
      return false;
    }

    try {
      // Initialize OSS client (Alibaba OSS is S3-compatible)
      if (config.oss.endPoint && config.oss.accessKey) {
        const ossEndpoint = config.oss.endPoint.replace(/^https?:\/\//, '');
        
        // For Alibaba OSS, region should match endpoint (e.g., oss-cn-hangzhou)
        const ossRegion = config.oss.region || ossEndpoint.split('.')[0] || 'oss-cn-hangzhou';
        
        ossClient = new MinioClient({
          endPoint: ossEndpoint,
          port: config.oss.port,
          useSSL: config.oss.useSSL,
          accessKey: config.oss.accessKey,
          secretKey: config.oss.secretKey,
          region: ossRegion,
          pathStyle: config.oss.pathStyle,  // false for Alibaba OSS (virtual-hosted style)
        });
        
        strapi.log.info(`[MediaSync] OSS client initialized`);
        strapi.log.info(`[MediaSync]   Endpoint: ${ossEndpoint}`);
        strapi.log.info(`[MediaSync]   Bucket: ${config.oss.bucket}`);
        strapi.log.info(`[MediaSync]   Region: ${ossRegion}`);
        strapi.log.info(`[MediaSync]   Upload Path: ${config.oss.uploadPath || '(root)'}`);
      } else {
        strapi.log.warn('[MediaSync] OSS client not initialized - missing endpoint or accessKey');
      }

      // Initialize local MinIO client
      if (config.minio.endPoint && config.minio.accessKey) {
        minioClient = new MinioClient({
          endPoint: config.minio.endPoint.replace(/^https?:\/\//, ''),
          port: config.minio.port,
          useSSL: config.minio.useSSL,
          accessKey: config.minio.accessKey,
          secretKey: config.minio.secretKey,
        });
        strapi.log.info('[MediaSync] MinIO client initialized');
      }

      return true;
    } catch (error: any) {
      strapi.log.error(`[MediaSync] Failed to initialize clients: ${error.message}`);
      return false;
    }
  };

  /**
   * Ensure MinIO bucket exists
   */
  const ensureBucket = async (): Promise<boolean> => {
    const config = getMediaConfig();
    if (!config || !minioClient) {
      return false;
    }

    try {
      const exists = await minioClient.bucketExists(config.minio.bucket);
      if (!exists) {
        await minioClient.makeBucket(config.minio.bucket);
        strapi.log.info(`[MediaSync] Created MinIO bucket: ${config.minio.bucket}`);
      }
      return true;
    } catch (error: any) {
      strapi.log.error(`[MediaSync] Failed to ensure bucket: ${error.message}`);
      return false;
    }
  };

  /**
   * Check if file exists in MinIO
   */
  const fileExistsInMinio = async (objectName: string): Promise<boolean> => {
    const config = getMediaConfig();
    if (!config || !minioClient) {
      return false;
    }

    try {
      await minioClient.statObject(config.minio.bucket, objectName);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Sync a single file from OSS to MinIO
   */
  const syncFile = async (objectName: string): Promise<boolean> => {
    const config = getMediaConfig();
    if (!config || !ossClient || !minioClient) {
      return false;
    }

    try {
      // Get file from OSS
      const dataStream = await ossClient.getObject(config.oss.bucket, objectName);

      // Get file stats for size
      const stat = await ossClient.statObject(config.oss.bucket, objectName);

      // Upload to MinIO
      await minioClient.putObject(
        config.minio.bucket,
        objectName,
        dataStream,
        stat.size,
        { 'Content-Type': stat.metaData?.['content-type'] || 'application/octet-stream' }
      );

      syncStats.filesDownloaded++;
      syncStats.totalBytes += stat.size;

      return true;
    } catch (error: any) {
      strapi.log.debug(`[MediaSync] Failed to sync file ${objectName}: ${error.message}`);
      syncStats.filesFailed++;
      return false;
    }
  };

  /**
   * Sync all files from OSS to MinIO
   */
  const syncAllFiles = async (): Promise<void> => {
    const config = getMediaConfig();
    if (!config || !ossClient || !minioClient) {
      strapi.log.warn('[MediaSync] Cannot sync - clients not initialized');
      return;
    }

    if (isSyncing) {
      strapi.log.debug('[MediaSync] Sync already in progress, skipping');
      return;
    }

    isSyncing = true;
    syncStats.isRunning = true;
    syncStats.error = null;

    const startTime = Date.now();
    let processed = 0;
    let listed = 0;

    try {
      strapi.log.info('[MediaSync] Starting media sync from OSS to MinIO...');

      // Ensure MinIO bucket exists
      await ensureBucket();

      // Use uploadPath as prefix when listing (e.g., 'strapi-uploads/')
      const prefix = config.oss.uploadPath 
        ? (config.oss.uploadPath.endsWith('/') ? config.oss.uploadPath : config.oss.uploadPath + '/')
        : '';
      
      strapi.log.info(`[MediaSync] Listing files from OSS bucket: ${config.oss.bucket}`);
      strapi.log.info(`[MediaSync] Using prefix: "${prefix || '(root)'}"`);

      // First, try to verify OSS connection
      try {
        const bucketExists = await ossClient.bucketExists(config.oss.bucket);
        if (!bucketExists) {
          strapi.log.error(`[MediaSync] OSS bucket "${config.oss.bucket}" does not exist or is not accessible`);
          syncStats.error = `Bucket "${config.oss.bucket}" not found`;
          return;
        }
        strapi.log.info(`[MediaSync] ✅ OSS bucket "${config.oss.bucket}" is accessible`);
      } catch (bucketError: any) {
        strapi.log.error(`[MediaSync] Failed to check OSS bucket: ${bucketError.message}`);
        syncStats.error = bucketError.message;
        return;
      }

      // List all objects in OSS bucket with prefix
      const objectsStream = ossClient.listObjects(config.oss.bucket, prefix, true);

      for await (const obj of objectsStream) {
        listed++;
        
        if (!obj.name) continue;

        // Log first few files for debugging
        if (listed <= 5) {
          strapi.log.debug(`[MediaSync] Found file: ${obj.name} (${obj.size} bytes)`);
        }

        processed++;

        // Check if file already exists in MinIO
        const exists = await fileExistsInMinio(obj.name);
        if (exists) {
          syncStats.filesSkipped++;
          continue;
        }

        // Sync file
        const success = await syncFile(obj.name);
        if (success && processed <= 10) {
          strapi.log.debug(`[MediaSync] ✅ Downloaded: ${obj.name}`);
        }

        // Log progress every 100 files
        if (processed % 100 === 0) {
          strapi.log.info(`[MediaSync] Progress: ${processed} files processed (${syncStats.filesDownloaded} downloaded, ${syncStats.filesSkipped} skipped)`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (listed === 0) {
        strapi.log.warn(`[MediaSync] ⚠️ No files found in OSS bucket with prefix "${prefix}"`);
        strapi.log.warn(`[MediaSync] Check if uploadPath is correct in your config`);
      } else {
        strapi.log.info(`[MediaSync] ✅ Sync completed in ${duration}s`);
        strapi.log.info(`[MediaSync]   Files listed: ${listed}`);
        strapi.log.info(`[MediaSync]   Downloaded: ${syncStats.filesDownloaded}`);
        strapi.log.info(`[MediaSync]   Skipped (already exists): ${syncStats.filesSkipped}`);
        strapi.log.info(`[MediaSync]   Failed: ${syncStats.filesFailed}`);
      }

      syncStats.lastSyncAt = new Date();
    } catch (error: any) {
      strapi.log.error(`[MediaSync] Sync failed: ${error.message}`);
      strapi.log.error(`[MediaSync] Error details: ${error.stack || error}`);
      syncStats.error = error.message;
    } finally {
      isSyncing = false;
      syncStats.isRunning = false;
    }
  };

  /**
   * Transform URLs in content
   */
  const transformUrls = (
    data: any,
    fromBaseUrl: string,
    toBaseUrl: string,
    mediaFields: string[],
    depth: number = 0
  ): any => {
    if (depth > 20 || data === null || data === undefined) {
      return data;
    }

    // Handle strings
    if (typeof data === 'string') {
      if (data.includes(fromBaseUrl)) {
        return data.replace(new RegExp(escapeRegex(fromBaseUrl), 'g'), toBaseUrl);
      }
      return data;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => transformUrls(item, fromBaseUrl, toBaseUrl, mediaFields, depth + 1));
    }

    // Handle objects
    if (typeof data === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = transformUrls(value, fromBaseUrl, toBaseUrl, mediaFields, depth + 1);
      }
      return result;
    }

    return data;
  };

  return {
    /**
     * Check if media sync is enabled
     */
    isEnabled(): boolean {
      const config = getMediaConfig();
      return config?.enabled === true;
    },

    /**
     * Initialize media sync service
     */
    async initialize(): Promise<void> {
      const config = getMediaConfig();
      if (!config) {
        strapi.log.debug('[MediaSync] Media sync not enabled');
        return;
      }

      strapi.log.info('[MediaSync] Initializing media sync service...');

      // Initialize clients
      if (!initClients()) {
        strapi.log.warn('[MediaSync] Failed to initialize clients');
        return;
      }

      // Ensure bucket exists
      await ensureBucket();

      // Run initial sync if configured
      if (config.syncOnStartup) {
        strapi.log.info('[MediaSync] Running initial sync...');
        // Run async to not block startup
        setImmediate(() => this.sync());
      }

      // Start periodic sync
      if (config.syncInterval > 0) {
        syncIntervalId = setInterval(() => {
          this.sync();
        }, config.syncInterval);
        strapi.log.info(`[MediaSync] Periodic sync enabled (interval: ${config.syncInterval / 1000}s)`);
      }
    },

    /**
     * Shutdown media sync service
     */
    async shutdown(): Promise<void> {
      if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
      }
      strapi.log.info('[MediaSync] Service stopped');
    },

    /**
     * Trigger manual sync
     */
    async sync(): Promise<SyncStats> {
      // Reset counters for this sync
      syncStats.filesDownloaded = 0;
      syncStats.filesSkipped = 0;
      syncStats.filesFailed = 0;
      syncStats.totalBytes = 0;

      await syncAllFiles();
      return { ...syncStats };
    },

    /**
     * Get sync statistics
     */
    getStats(): SyncStats {
      return { ...syncStats };
    },

    /**
     * Transform media URLs from master (OSS) to replica (MinIO)
     */
    transformToReplica(data: any): any {
      const config = getMediaConfig();
      if (!config || !config.transformUrls) {
        return data;
      }

      if (!config.oss.baseUrl || !config.minio.baseUrl) {
        return data;
      }

      return transformUrls(
        data,
        config.oss.baseUrl,
        config.minio.baseUrl,
        config.mediaFields
      );
    },

    /**
     * Transform media URLs from replica (MinIO) to master (OSS)
     */
    transformToMaster(data: any): any {
      const config = getMediaConfig();
      if (!config || !config.transformUrls) {
        return data;
      }

      if (!config.oss.baseUrl || !config.minio.baseUrl) {
        return data;
      }

      return transformUrls(
        data,
        config.minio.baseUrl,
        config.oss.baseUrl,
        config.mediaFields
      );
    },

    /**
     * Check if MinIO is accessible
     */
    async isMinioHealthy(): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !minioClient) {
        return false;
      }

      try {
        await minioClient.bucketExists(config.minio.bucket);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Check if OSS is accessible
     */
    async isOssHealthy(): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !ossClient) {
        return false;
      }

      try {
        await ossClient.bucketExists(config.oss.bucket);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Get health status
     */
    async getHealth(): Promise<{
      minioConnected: boolean;
      ossConnected: boolean;
      lastSync: Date | null;
      isRunning: boolean;
    }> {
      return {
        minioConnected: await this.isMinioHealthy(),
        ossConnected: await this.isOssHealthy(),
        lastSync: syncStats.lastSyncAt,
        isRunning: syncStats.isRunning,
      };
    },

    /**
     * Sync a specific file by path
     */
    async syncFile(objectPath: string): Promise<boolean> {
      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        return false;
      }

      return syncFile(objectPath);
    },

    /**
     * Get file URL from MinIO
     */
    getMinioUrl(objectPath: string): string {
      const config = getMediaConfig();
      if (!config) {
        return objectPath;
      }
      return `${config.minio.baseUrl}/${objectPath}`;
    },

    /**
     * Get file URL from OSS
     */
    getOssUrl(objectPath: string): string {
      const config = getMediaConfig();
      if (!config) {
        return objectPath;
      }
      return `${config.oss.baseUrl}/${objectPath}`;
    },

    /**
     * Extract all media URLs from content data
     * Recursively scans object for URLs matching OSS base URL
     */
    extractMediaUrls(data: any): string[] {
      const config = getMediaConfig();
      if (!config) {
        return [];
      }

      const urls: Set<string> = new Set();
      const ossBaseUrl = config.oss.baseUrl;

      const extractFromValue = (value: any): void => {
        if (typeof value === 'string') {
          // Check if it's an OSS URL
          if (value.includes(ossBaseUrl)) {
            urls.add(value);
          }
        } else if (Array.isArray(value)) {
          value.forEach(extractFromValue);
        } else if (typeof value === 'object' && value !== null) {
          Object.values(value).forEach(extractFromValue);
        }
      };

      extractFromValue(data);
      return Array.from(urls);
    },

    /**
     * Extract object path from full URL
     * e.g., "https://bucket.oss.com/uploads/image.jpg" → "uploads/image.jpg"
     */
    urlToObjectPath(url: string): string | null {
      const config = getMediaConfig();
      if (!config) {
        return null;
      }

      // Remove base URL to get object path
      if (url.includes(config.oss.baseUrl)) {
        return url.replace(config.oss.baseUrl + '/', '').replace(config.oss.baseUrl, '');
      }
      if (url.includes(config.minio.baseUrl)) {
        return url.replace(config.minio.baseUrl + '/', '').replace(config.minio.baseUrl, '');
      }

      return null;
    },

    /**
     * Sync media files referenced in content (on-demand sync)
     * Called when content is received from master to immediately download images
     * 
     * @param data - Content data containing media URLs
     * @returns Number of files synced
     */
    async syncContentMedia(data: any): Promise<{ synced: number; skipped: number; failed: number }> {
      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        return { synced: 0, skipped: 0, failed: 0 };
      }

      const result = { synced: 0, skipped: 0, failed: 0 };

      try {
        // Extract all media URLs from content
        const urls = this.extractMediaUrls(data);

        if (urls.length === 0) {
          return result;
        }

        strapi.log.debug(`[MediaSync] On-demand sync: Found ${urls.length} media URLs in content`);

        // Ensure bucket exists
        await ensureBucket();

        // Sync each file
        for (const url of urls) {
          const objectPath = this.urlToObjectPath(url);
          if (!objectPath) {
            continue;
          }

          try {
            // Check if already exists in MinIO
            const exists = await fileExistsInMinio(objectPath);
            if (exists) {
              result.skipped++;
              continue;
            }

            // Download from OSS and upload to MinIO
            const success = await syncFile(objectPath);
            if (success) {
              result.synced++;
              strapi.log.debug(`[MediaSync] ✅ On-demand synced: ${objectPath}`);
            } else {
              result.failed++;
            }
          } catch (fileError: any) {
            result.failed++;
            strapi.log.debug(`[MediaSync] Failed to sync ${objectPath}: ${fileError.message}`);
          }
        }

        if (result.synced > 0) {
          strapi.log.info(`[MediaSync] 🖼️ On-demand sync: ${result.synced} files downloaded, ${result.skipped} skipped, ${result.failed} failed`);
        }

        return result;
      } catch (error: any) {
        strapi.log.error(`[MediaSync] On-demand sync error: ${error.message}`);
        return result;
      }
    },

    /**
     * Sync a single URL (download if not exists)
     */
    async syncUrl(url: string): Promise<boolean> {
      const objectPath = this.urlToObjectPath(url);
      if (!objectPath) {
        return false;
      }

      const config = getMediaConfig();
      if (!config || !ossClient || !minioClient) {
        return false;
      }

      try {
        // Check if already exists
        const exists = await fileExistsInMinio(objectPath);
        if (exists) {
          return true; // Already synced
        }

        // Sync the file
        return await syncFile(objectPath);
      } catch {
        return false;
      }
    },
  };
};
