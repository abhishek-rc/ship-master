/**
 * Message Tracker Service
 * Provides idempotency by tracking processed message IDs
 * Uses Strapi Entity Service for proper connection management
 */

const CONTENT_TYPE = 'plugin::offline-sync.processed-message';

interface ProcessedMessage {
  id: number;
  documentId: string;
  messageId: string;
  shipId: string | null;
  contentType: string | null;
  contentId: string | null;
  operation: string | null;
  status: 'processed' | 'failed';
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageMetadata {
  shipId?: string;
  contentType?: string;
  contentId?: string;
  operation?: string;
}

export default ({ strapi: strapiInstance }: { strapi: any }) => {
  // Capture strapi in closure to ensure it's always available
  const strapi = strapiInstance;

  return {
    /**
     * Check if a message has already been processed
     */
    async isProcessed(messageId: string): Promise<boolean> {
      if (!messageId) return false;
      if (!strapi) {
        console.error('[MessageTracker] Strapi instance not available');
        return false;
      }

      try {
        const existing = await strapi.documents(CONTENT_TYPE).findFirst({
          filters: { messageId: { $eq: messageId } },
        });
        return !!existing;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.debug(`[MessageTracker] Check failed for ${messageId}: ${message}`);
        }
        return false;
      }
    },

    /**
     * Mark a message as processed
     */
    async markProcessed(messageId: string, metadata: MessageMetadata = {}): Promise<boolean> {
      if (!messageId) return false;
      if (!strapi) {
        console.error('[MessageTracker] Strapi instance not available');
        return false;
      }

      try {
        // Check if already exists (idempotent operation)
        const existing = await strapi.documents(CONTENT_TYPE).findFirst({
          filters: { messageId: { $eq: messageId } },
        });

        if (existing) {
          return false; // Already processed
        }

        await strapi.documents(CONTENT_TYPE).create({
          data: {
            messageId,
            shipId: metadata.shipId || null,
            contentType: metadata.contentType || null,
            contentId: metadata.contentId || null,
            operation: metadata.operation || null,
            status: 'processed',
            processedAt: new Date(),
          },
        });

        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Unique constraint violation means already processed - this is expected
        if (message.includes('unique') || message.includes('duplicate')) {
          return false;
        }
        if (strapi && strapi.log) {
          strapi.log.error(`[MessageTracker] Failed to mark processed: ${message}`);
        }
        return false;
      }
    },

    /**
     * Mark a message as failed
     */
    async markFailed(messageId: string): Promise<void> {
      if (!messageId) return;
      if (!strapi) {
        console.error('[MessageTracker] Strapi instance not available');
        return;
      }

      try {
        const existing = await strapi.documents(CONTENT_TYPE).findFirst({
          filters: { messageId: { $eq: messageId } },
        });

        if (existing) {
          await strapi.documents(CONTENT_TYPE).update({
            documentId: existing.documentId,
            data: { status: 'failed' },
          });
        } else {
          await strapi.documents(CONTENT_TYPE).create({
            data: {
              messageId,
              status: 'failed',
              processedAt: new Date(),
            },
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.debug(`[MessageTracker] Failed to mark as failed: ${message}`);
        }
      }
    },

    /**
     * Cleanup old processed messages (retention policy)
     */
    async cleanup(retentionDays: number = 7): Promise<number> {
      if (!strapi) {
        console.error('[MessageTracker] Strapi instance not available');
        return 0;
      }

      try {
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        const oldMessages = await strapi.documents(CONTENT_TYPE).findMany({
          filters: {
            processedAt: { $lt: cutoffDate.toISOString() },
          },
          limit: 1000, // Process in batches
        });

        for (const msg of oldMessages) {
          await strapi.documents(CONTENT_TYPE).delete({
            documentId: msg.documentId,
          });
        }

        if (oldMessages.length > 0 && strapi.log) {
          strapi.log.info(`[MessageTracker] Cleaned up ${oldMessages.length} old messages`);
        }

        return oldMessages.length;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[MessageTracker] Cleanup failed: ${message}`);
        } else {
          console.error(`[MessageTracker] Cleanup failed: ${message}`);
        }
        return 0;
      }
    },

    /**
     * Get processing statistics
     */
    async getStats(): Promise<{
      total: number;
      processed: number;
      failed: number;
      lastProcessed: Date | null;
    }> {
      if (!strapi) {
        return { total: 0, processed: 0, failed: 0, lastProcessed: null };
      }

      try {
        const all = await strapi.documents(CONTENT_TYPE).findMany({
          sort: { processedAt: 'desc' },
          limit: 10000,
        });

        const processed = all.filter((m: ProcessedMessage) => m.status === 'processed').length;
        const failed = all.filter((m: ProcessedMessage) => m.status === 'failed').length;
        const lastProcessed = all.length > 0 ? all[0].processedAt : null;

        return {
          total: all.length,
          processed,
          failed,
          lastProcessed,
        };
      } catch (error) {
        return { total: 0, processed: 0, failed: 0, lastProcessed: null };
      }
    },
  };
};
