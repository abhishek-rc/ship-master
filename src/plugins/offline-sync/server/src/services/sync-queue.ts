export default ({ strapi }: { strapi: any }) => {
  let tableExists: boolean | null = null;

  const parseJsonField = (value: any): any => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  };

  return {
    /**
     * Check if sync_queue table exists (cached)
     */
    async ensureTable(): Promise<boolean> {
      if (tableExists !== null) return tableExists;
      
      const db = strapi.db.connection;
      tableExists = await db.schema.hasTable('sync_queue');
      return tableExists;
    },

    /**
     * Enqueue an operation for sync
     */
    async enqueue(operation: {
      shipId: string;
      contentType: string;
      contentId: string | number;
      operation: 'create' | 'update' | 'delete';
      localVersion: number;
      data: any;
    }): Promise<any> {
      if (!await this.ensureTable()) {
        strapi.log.warn('sync_queue table does not exist');
        return null;
      }

      const db = strapi.db.connection;
      const [result] = await db('sync_queue')
        .insert({
          ship_id: operation.shipId,
          content_type: operation.contentType,
          content_id: String(operation.contentId),
          operation: operation.operation,
          local_version: operation.localVersion,
          data: JSON.stringify(operation.data),
          status: 'pending',
          created_at: new Date(),
        })
        .returning('*');

      return result;
    },

    /**
     * Dequeue pending operations
     */
    async dequeue(shipId: string, limit: number = 100): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const entries = await db('sync_queue')
        .where({ ship_id: shipId, status: 'pending' })
        .orderBy('created_at', 'asc')
        .limit(limit);

      if (entries.length > 0) {
        await db('sync_queue')
          .whereIn('id', entries.map((e: any) => e.id))
          .update({ status: 'syncing' });
      }

      return entries.map((entry: any) => ({
        ...entry,
        data: parseJsonField(entry.data),
      }));
    },

    /**
     * Mark operation as pushed (sent to Kafka, awaiting Master)
     */
    async markPushed(queueId: number, kafkaOffset?: number): Promise<void> {
      const db = strapi.db.connection;
      await db('sync_queue')
        .where({ id: queueId })
        .update({
          status: 'pushed',
          synced_at: new Date(),
          kafka_offset: kafkaOffset || null,
        });
    },

    /**
     * Mark operation as synced (Master confirmed)
     */
    async markSynced(queueId: number): Promise<void> {
      const db = strapi.db.connection;
      await db('sync_queue')
        .where({ id: queueId })
        .update({ status: 'synced' });
    },

    /**
     * Mark operation as failed
     */
    async markFailed(queueId: number, error: Error): Promise<void> {
      const db = strapi.db.connection;
      const entry = await db('sync_queue').where({ id: queueId }).first();

      await db('sync_queue')
        .where({ id: queueId })
        .update({
          status: 'failed',
          error_message: error.message,
          retry_count: (entry?.retry_count || 0) + 1,
        });
    },

    /**
     * Mark operation as conflict (Master rejected due to conflict)
     */
    async markConflict(options: {
      contentType: string;
      contentId: string;
      shipId: string;
      conflictId: number;
      reason: string;
    }): Promise<void> {
      if (!await this.ensureTable()) {
        return;
      }

      const db = strapi.db.connection;
      
      // Find the queue entry for this content
      const entry = await db('sync_queue')
        .where({
          ship_id: options.shipId,
          content_type: options.contentType,
          content_id: String(options.contentId),
        })
        .whereIn('status', ['pending', 'syncing', 'pushed'])
        .orderBy('created_at', 'desc')
        .first();

      if (entry) {
        await db('sync_queue')
          .where({ id: entry.id })
          .update({
            status: 'conflict',
            error_message: `Conflict #${options.conflictId}: ${options.reason}`,
            updated_at: new Date(),
          });
        
        strapi.log.info(`[SyncQueue] Marked entry ${entry.id} as conflict`);
      } else {
        strapi.log.debug(`[SyncQueue] No pending entry found for ${options.contentType}/${options.contentId}`);
      }
    },

    /**
     * Get conflict entries
     */
    async getConflicts(shipId: string): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const entries = await db('sync_queue')
        .where({ ship_id: shipId, status: 'conflict' })
        .orderBy('created_at', 'desc')
        .limit(100);

      return entries.map((entry: any) => ({
        ...entry,
        data: parseJsonField(entry.data),
      }));
    },

    /**
     * Get pending operations count
     */
    async getPending(shipId: string): Promise<number> {
      if (!await this.ensureTable()) {
        return 0;
      }

      const db = strapi.db.connection;
      const [result] = await db('sync_queue')
        .where({ ship_id: shipId, status: 'pending' })
        .count('* as count');

      return parseInt(result.count as string) || 0;
    },

    /**
     * Get queue entries
     */
    async getQueue(shipId: string): Promise<any[]> {
      if (!await this.ensureTable()) {
        return [];
      }

      const db = strapi.db.connection;
      const entries = await db('sync_queue')
        .where({ ship_id: shipId })
        .orderBy('created_at', 'desc')
        .limit(100);

      return entries.map((entry: any) => ({
        ...entry,
        data: parseJsonField(entry.data),
      }));
    },
  };
};

