/**
 * Dead Letter Queue Service
 * Handles failed messages for retry or manual resolution
 * Uses Strapi Entity Service for proper connection management
 */

const CONTENT_TYPE = 'plugin::offline-sync.dead-letter';

interface DeadLetter {
  id: number;
  documentId: string;
  messageId: string;
  shipId: string | null;
  contentType: string | null;
  contentId: string | null;
  operation: string | null;
  payload: Record<string, unknown> | null;
  errorMessage: string | null;
  errorStack: string | null;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'retrying' | 'exhausted' | 'resolved';
  lastRetryAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DeadLetterInput {
  messageId: string;
  shipId?: string;
  contentType?: string;
  contentId?: string;
  operation?: string;
  payload?: Record<string, unknown>;
  error: Error | string;
  maxRetries?: number;
}

export default ({ strapi: strapiInstance }: { strapi: any }) => {
  // Capture strapi in closure to ensure it's always available
  const strapi = strapiInstance;

  return {
    /**
     * Add a failed message to the dead letter queue
     */
    async add(input: DeadLetterInput): Promise<DeadLetter | null> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      if (!input.messageId) {
        if (strapi.log) {
          strapi.log.warn('[DeadLetter] messageId is required');
        }
        return null;
      }

      try {
        const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
        const errorStack = input.error instanceof Error ? input.error.stack : undefined;

        const created = await strapi.documents(CONTENT_TYPE).create({
          data: {
            messageId: input.messageId,
            shipId: input.shipId || null,
            contentType: input.contentType || null,
            contentId: input.contentId || null,
            operation: input.operation || null,
            payload: input.payload || null,
            errorMessage,
            errorStack: errorStack || null,
            retryCount: 0,
            maxRetries: input.maxRetries ?? 3,
            status: 'pending',
          },
        });

        if (strapi.log) {
          strapi.log.warn(`[DeadLetter] Message ${input.messageId} added to dead letter queue`);
        }
        return created as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to add message: ${message}`);
        } else {
          console.error(`[DeadLetter] Failed to add message: ${message}`);
        }
        return null;
      }
    },

    /**
     * Get all pending dead letters for retry
     */
    async getPending(limit: number = 100): Promise<DeadLetter[]> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return [];
      }

      try {
        const result = await strapi.documents(CONTENT_TYPE).findMany({
          filters: {
            status: { $in: ['pending', 'retrying'] },
          },
          sort: { createdAt: 'asc' },
          limit,
        });
        return result as DeadLetter[];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to get pending: ${message}`);
        }
        return [];
      }
    },

    /**
     * Get all dead letters
     */
    async getAll(filters?: { status?: string; shipId?: string }): Promise<DeadLetter[]> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return [];
      }

      try {
        const queryFilters: Record<string, unknown> = {};
        if (filters?.status) {
          queryFilters.status = { $eq: filters.status };
        }
        if (filters?.shipId) {
          queryFilters.shipId = { $eq: filters.shipId };
        }

        const result = await strapi.documents(CONTENT_TYPE).findMany({
          filters: queryFilters,
          sort: { createdAt: 'desc' },
          limit: 1000,
        });
        return result as DeadLetter[];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to get all: ${message}`);
        }
        return [];
      }
    },

    /**
     * Get a specific dead letter by documentId
     */
    async get(documentId: string): Promise<DeadLetter | null> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const result = await strapi.documents(CONTENT_TYPE).findOne({
          documentId,
        });
        return result as DeadLetter | null;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to get ${documentId}: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark a dead letter as being retried
     */
    async markRetrying(documentId: string): Promise<DeadLetter | null> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const existing = await this.get(documentId);
        if (!existing) return null;

        const newRetryCount = existing.retryCount + 1;
        const status = newRetryCount >= existing.maxRetries ? 'exhausted' : 'retrying';

        const updated = await strapi.documents(CONTENT_TYPE).update({
          documentId,
          data: {
            retryCount: newRetryCount,
            status,
            lastRetryAt: new Date(),
          },
        });

        return updated as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to mark retrying: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark a dead letter as resolved (successfully processed on retry)
     */
    async markResolved(documentId: string, resolvedBy?: string): Promise<DeadLetter | null> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const updated = await strapi.documents(CONTENT_TYPE).update({
          documentId,
          data: {
            status: 'resolved',
            resolvedAt: new Date(),
            resolvedBy: resolvedBy || 'system',
          },
        });

        if (strapi.log) {
          strapi.log.info(`[DeadLetter] Message ${documentId} resolved`);
        }
        return updated as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to mark resolved: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark a dead letter as exhausted (max retries reached)
     */
    async markExhausted(documentId: string): Promise<DeadLetter | null> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return null;
      }

      try {
        const updated = await strapi.documents(CONTENT_TYPE).update({
          documentId,
          data: { status: 'exhausted' },
        });

        if (strapi.log) {
          strapi.log.warn(`[DeadLetter] Message ${documentId} exhausted all retries`);
        }
        return updated as DeadLetter;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to mark exhausted: ${message}`);
        }
        return null;
      }
    },

    /**
     * Delete a resolved dead letter
     */
    async delete(documentId: string): Promise<boolean> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return false;
      }

      try {
        await strapi.documents(CONTENT_TYPE).delete({ documentId });
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Failed to delete: ${message}`);
        }
        return false;
      }
    },

    /**
     * Get dead letter queue statistics
     */
    async getStats(): Promise<{
      total: number;
      pending: number;
      retrying: number;
      exhausted: number;
      resolved: number;
    }> {
      if (!strapi) {
        return { total: 0, pending: 0, retrying: 0, exhausted: 0, resolved: 0 };
      }

      try {
        const all = await strapi.documents(CONTENT_TYPE).findMany({
          limit: 10000,
        });

        return {
          total: all.length,
        pending: all.filter((d: DeadLetter) => d.status === 'pending').length,
        retrying: all.filter((d: DeadLetter) => d.status === 'retrying').length,
        exhausted: all.filter((d: DeadLetter) => d.status === 'exhausted').length,
        resolved: all.filter((d: DeadLetter) => d.status === 'resolved').length,
      };
    } catch (error) {
      return { total: 0, pending: 0, retrying: 0, exhausted: 0, resolved: 0 };
    }
  },

    /**
     * Cleanup old resolved dead letters
     */
    async cleanup(retentionDays: number = 30): Promise<number> {
      if (!strapi) {
        console.error('[DeadLetter] Strapi instance not available');
        return 0;
      }

      try {
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        const oldMessages = await strapi.documents(CONTENT_TYPE).findMany({
          filters: {
            status: { $eq: 'resolved' },
            resolvedAt: { $lt: cutoffDate.toISOString() },
          },
          limit: 500,
        });

        for (const msg of oldMessages) {
          await strapi.documents(CONTENT_TYPE).delete({
            documentId: msg.documentId,
          });
        }

        if (oldMessages.length > 0 && strapi.log) {
          strapi.log.info(`[DeadLetter] Cleaned up ${oldMessages.length} resolved messages`);
        }

        return oldMessages.length;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[DeadLetter] Cleanup failed: ${message}`);
        } else {
          console.error(`[DeadLetter] Cleanup failed: ${message}`);
        }
        return 0;
      }
    },
  };
};

