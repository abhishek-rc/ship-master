/**
 * Ship Tracker Service
 * Uses Strapi Entity Service for proper connection management
 */

const CONTENT_TYPE = 'plugin::offline-sync.ship-registry';

interface Ship {
  id: number;
  documentId: string;
  shipId: string;
  shipName: string;
  connectivityStatus: 'online' | 'offline';
  lastSeenAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ShipInput {
  shipId: string;
  shipName?: string;
  connectivityStatus?: 'online' | 'offline';
  lastSeenAt?: Date;
  metadata?: Record<string, unknown>;
}

export default ({ strapi: strapiParam }: { strapi: any }) => {
  // Explicitly capture strapi in closure to ensure it's available
  const strapi = strapiParam;

  return {
    /**
     * Register or update a ship
     */
    async registerShip(shipId: string, shipName?: string): Promise<Ship | null> {
      if (!shipId) {
        if (strapi && strapi.log) {
          strapi.log.warn('[ShipTracker] shipId is required');
        }
        return null;
      }

      if (!strapi) {
        console.error('[ShipTracker] Strapi instance is not available in closure');
        return null;
      }

      try {
        // Check if ship exists
        const existing = await strapi.documents(CONTENT_TYPE).findFirst({
          filters: { shipId: { $eq: shipId } },
        });

        const now = new Date();

        if (existing) {
          // Update existing ship
          const updated = await strapi.documents(CONTENT_TYPE).update({
            documentId: existing.documentId,
            data: {
              connectivityStatus: 'online',
              lastSeenAt: now,
            },
          });
          strapi.log.debug(`[ShipTracker] Updated ship ${shipId} - last seen: ${now.toISOString()}`);
          return updated as Ship;
        }

        // Create new ship
        const created = await strapi.documents(CONTENT_TYPE).create({
          data: {
            shipId,
            shipName: shipName || shipId,
            connectivityStatus: 'online',
            lastSeenAt: now,
          },
        });

        strapi.log.info(`[ShipTracker] ✅ New ship registered: ${shipId} (${shipName || shipId})`);
        return created as Ship;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const stack = error instanceof Error ? error.stack : undefined;
        if (strapi && strapi.log) {
          strapi.log.error(`[ShipTracker] ❌ Failed to register ship ${shipId}: ${message}`);
          if (stack) {
            strapi.log.debug(`[ShipTracker] Error stack: ${stack}`);
          }
          // Log additional error details if available
          if (error && typeof error === 'object' && 'details' in error) {
            strapi.log.debug(`[ShipTracker] Error details: ${JSON.stringify((error as any).details)}`);
          }
        } else {
          console.error(`[ShipTracker] ❌ Failed to register ship ${shipId}: ${message}`);
        }
        throw error;
      }
    },

    /**
     * List all registered ships
     */
    async listShips(): Promise<Ship[]> {
      if (!strapi) {
        console.error('[ShipTracker] Strapi instance not available');
        return [];
      }
      try {
        const result = await strapi.documents(CONTENT_TYPE).findMany({
          sort: { lastSeenAt: 'desc' },
        });
        return result as Ship[];
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[ShipTracker] Failed to list ships: ${message}`);
        }
        return [];
      }
    },

    /**
     * Get a specific ship by shipId
     */
    async getShip(shipId: string): Promise<Ship | null> {
      if (!strapi) {
        console.error('[ShipTracker] Strapi instance not available');
        return null;
      }
      try {
        const result = await strapi.documents(CONTENT_TYPE).findFirst({
          filters: { shipId: { $eq: shipId } },
        });
        return result as Ship | null;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[ShipTracker] Failed to get ship ${shipId}: ${message}`);
        }
        return null;
      }
    },

    /**
     * Mark ships as offline if not seen recently
     */
    async markOfflineShips(thresholdMinutes: number = 5): Promise<number> {
      if (!strapi) {
        console.error('[ShipTracker] Strapi instance not available');
        return 0;
      }
      try {
        const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

        // Find online ships that haven't been seen recently
        const staleShips = await strapi.documents(CONTENT_TYPE).findMany({
          filters: {
            connectivityStatus: { $eq: 'online' },
            lastSeenAt: { $lt: threshold.toISOString() },
          },
        });

        // Update each to offline
        let count = 0;
        for (const ship of staleShips) {
          await strapi.documents(CONTENT_TYPE).update({
            documentId: ship.documentId,
            data: { connectivityStatus: 'offline' },
          });
          count++;
        }

        if (count > 0 && strapi.log) {
          strapi.log.info(`[ShipTracker] Marked ${count} ships as offline`);
        }

        return count;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (strapi && strapi.log) {
          strapi.log.error(`[ShipTracker] Failed to mark offline ships: ${message}`);
        }
        return 0;
      }
    },

    /**
     * Get ship statistics
     */
    async getStats(): Promise<{ total: number; online: number; offline: number }> {
      if (!strapi) {
        return { total: 0, online: 0, offline: 0 };
      }
      try {
        const ships = await strapi.documents(CONTENT_TYPE).findMany({
          sort: { lastSeenAt: 'desc' },
        });
        const online = ships.filter((s: any) => s.connectivityStatus === 'online').length;
        return {
          total: ships.length,
          online,
          offline: ships.length - online,
        };
      } catch (error) {
        return { total: 0, online: 0, offline: 0 };
      }
    },
  };
};
