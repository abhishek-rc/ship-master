export default ({ strapi }: { strapi: any }) => ({
  /**
   * Push pending operations to master
   */
  async push(): Promise<{ pushed: number; failed: number }> {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (config.mode !== 'replica') {
      throw new Error('Push sync only available in replica mode');
    }

    const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
    const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');

    let pushed = 0;
    let failed = 0;

    try {
      // Get pending operations
      const pending = await syncQueue.dequeue(config.shipId, config.sync.batchSize);

      strapi.log.info(`Pushing ${pending.length} operations to master...`);

      for (const operation of pending) {
        try {
          const message = {
            messageId: `msg-${Date.now()}-${operation.id}`,
            shipId: config.shipId,
            timestamp: new Date().toISOString(),
            operation: operation.operation,
            contentType: operation.content_type,
            contentId: operation.content_id,
            version: operation.local_version,
            data: operation.data,
            metadata: {
              queueId: operation.id,
            },
          };

          await kafkaProducer.send(message);
          // Mark as 'synced' - Kafka guarantees delivery, so once sent we can consider it synced
          await syncQueue.markSynced(operation.id);
          pushed++;
        } catch (error: any) {
          strapi.log.error(`Failed to push operation ${operation.id}: ${error.message}`);
          await syncQueue.markFailed(operation.id, error);
          failed++;
        }
      }

      strapi.log.info(`Push completed: ${pushed} pushed, ${failed} failed`);

      return { pushed, failed };
    } catch (error: any) {
      strapi.log.error(`Push sync error: ${error.message}`);
      throw error;
    }
  },

  /**
   * Pull updates from master
   * In bi-directional sync, ships subscribe to master-updates topic
   * This method is called when ship comes online to catch up on missed updates
   */
  async pull(): Promise<{ pulled: number; conflicts: number }> {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (config.mode !== 'replica') {
      throw new Error('Pull sync only available in replica mode');
    }

    // Pull is now handled by Kafka consumer subscribing to master-updates topic
    // This method can be used for on-demand sync or initial data load

    // For now, just log that pull sync is handled via Kafka subscription
    strapi.log.info('[Sync] Pull sync is handled via Kafka subscription to master-updates topic');

    // Return current stats (could be enhanced with actual pull tracking)
    return { pulled: 0, conflicts: 0 };
  },

  /**
   * Clean data for sync - remove internal Strapi fields
   */
  cleanSyncData(data: Record<string, unknown>): Record<string, unknown> {
    if (!data || typeof data !== 'object') return data;

    const internalFields = [
      'id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt',
      'createdBy', 'updatedBy', 'locale', 'localizations',
    ];

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!internalFields.includes(key)) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  },

  /**
   * Process ship update (master side)
   * Conflict detection: checks if master was modified since last sync from this ship
   */
  async processShipUpdate(message: any): Promise<void> {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (config.mode !== 'master') {
      throw new Error('processShipUpdate only available in master mode');
    }

    // Validate message
    const { messageId, contentType, contentId: replicaDocumentId, version: shipVersion, data, operation, shipId, timestamp } = message;
    if (!contentType || !replicaDocumentId || !shipId) {
      strapi.log.warn('[Sync] Invalid message: missing required fields');
      return;
    }

    const messageTracker = strapi.plugin('offline-sync').service('message-tracker');
    const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
    const shipTracker = strapi.plugin('offline-sync').service('ship-tracker');
    const deadLetter = strapi.plugin('offline-sync').service('dead-letter');
    const conflictResolver = strapi.plugin('offline-sync').service('conflict-resolver');

    // Idempotency check - skip if already processed
    if (messageId) {
      const alreadyProcessed = await messageTracker.isProcessed(messageId);
      if (alreadyProcessed) {
        strapi.log.debug(`[Sync] Duplicate message skipped: ${messageId}`);
        return;
      }
    }

    // Register ship (non-blocking, but log errors for debugging)
    shipTracker.registerShip(shipId, shipId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.warn(`[Sync] Failed to register ship ${shipId} (non-blocking): ${message}`);
      // Don't throw - this is non-blocking, but we log it for debugging
    });

    // Set flag to prevent Document Service middleware from re-broadcasting these changes
    // This prevents infinite sync loops (ship->master->ship->...)
    (strapi as any)._offlineSyncFromShip = true;

    try {
      // Validate content type exists
      const model = strapi.contentTypes[contentType];
      if (!model) {
        strapi.log.warn(`[Sync] Unknown content type: ${contentType}`);
        if (messageId) await messageTracker.markFailed(messageId);
        return;
      }

      // Clean data - remove internal fields
      const cleanedData = this.cleanSyncData(data || {});

      // Get master documentId from mapping (if exists)
      let masterDocumentId = await documentMapping.getMasterDocumentId(
        shipId,
        contentType,
        replicaDocumentId
      );

      // Handle operations
      if (operation === 'delete') {
        if (masterDocumentId) {
          await strapi.documents(contentType).delete({ documentId: masterDocumentId });
          await documentMapping.deleteMapping(shipId, contentType, replicaDocumentId);
          strapi.log.info(`[Sync] ✅ Deleted ${contentType} (replica: ${replicaDocumentId})`);
        } else {
          strapi.log.debug(`[Sync] Delete skipped - no mapping for ${replicaDocumentId}`);
        }
      } else if (operation === 'create' || !masterDocumentId) {
        // Create new document - no conflict possible
        const created = await strapi.documents(contentType).create({
          data: cleanedData,
          status: 'published',
        });

        if (created?.documentId) {
          await documentMapping.setMapping(shipId, contentType, replicaDocumentId, created.documentId);
          strapi.log.info(`[Sync] ✅ Created ${contentType}: ${replicaDocumentId} -> ${created.documentId}`);

          // Send create ACK back to ship so it saves the reverse mapping
          // This allows Master's future updates to be applied correctly on Replica
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
          if (kafkaProducer.isConnected()) {
            await kafkaProducer.sendCreateAck({
              shipId,
              contentType,
              replicaDocumentId,
              masterDocumentId: created.documentId,
            });
          }
        }
      } else {
        // UPDATE - Check for conflicts using lastSyncedAt from mapping
        const mapping = await documentMapping.getMapping(shipId, contentType, replicaDocumentId);
        const lastSyncedAt = mapping?.updatedAt ? new Date(mapping.updatedAt) : null;

        // Get current master document
        const masterDoc = await strapi.documents(contentType).findOne({ documentId: masterDocumentId });
        const masterUpdatedAt = masterDoc?.updatedAt ? new Date(masterDoc.updatedAt) : null;

        // Conflict: Master was modified AFTER our last sync to it
        // This means someone edited on master while ship was making changes
        const hasConflict = lastSyncedAt && masterUpdatedAt && masterUpdatedAt > lastSyncedAt;

        if (hasConflict) {
          // Log conflict for admin resolution
          const conflictLog = await conflictResolver.logConflict({
            contentType,
            contentId: masterDocumentId,
            shipId,
            shipVersion: shipVersion || 0,
            masterVersion: 0, // Not using versions anymore
            shipData: cleanedData,
            masterData: this.cleanSyncData(masterDoc || {}),
            conflictType: 'concurrent-edit',
          });

          strapi.log.warn(`[Sync] ⚠️ CONFLICT: ${contentType} (${masterDocumentId}) - master was edited after last sync`);

          // Send conflict notification back to replica
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
          if (kafkaProducer.isConnected()) {
            await kafkaProducer.sendConflictNotification({
              shipId,
              contentType,
              contentId: masterDocumentId,
              replicaDocumentId,
              conflictId: conflictLog?.id || 0,
              reason: 'Master was edited after last sync from this ship',
              masterData: this.cleanSyncData(masterDoc || {}),
              shipData: cleanedData,
              queueId: message.metadata?.queueId,
            });
          }

          if (messageId) {
            await messageTracker.markProcessed(messageId, { shipId, contentType, contentId: replicaDocumentId, operation, conflict: true });
          }
          return; // Don't apply - needs resolution
        }

        // No conflict - apply update and publish
        await strapi.documents(contentType).update({
          documentId: masterDocumentId,
          data: cleanedData,
          status: 'published',
        });

        // Update the mapping timestamp (so we know when we last synced)
        await documentMapping.setMapping(shipId, contentType, replicaDocumentId, masterDocumentId);

        strapi.log.info(`[Sync] ✅ Updated ${contentType} (master: ${masterDocumentId})`);
      }

      // Mark message as processed
      if (messageId) {
        await messageTracker.markProcessed(messageId, { shipId, contentType, contentId: replicaDocumentId, operation });
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (messageId) await messageTracker.markFailed(messageId);

      await deadLetter.add({
        messageId: messageId || `unknown-${Date.now()}`,
        shipId,
        contentType,
        contentId: replicaDocumentId,
        operation,
        payload: { version: shipVersion, data },
        error: error instanceof Error ? error : new Error(errorMessage),
        maxRetries: 3,
      });

      strapi.log.error(`[Sync] Error: ${contentType}:${replicaDocumentId} - ${errorMessage}`);
    } finally {
      // Always reset the flag to allow normal master changes to be broadcast
      (strapi as any)._offlineSyncFromShip = false;
    }
  },

  /**
   * Process master update (replica side)
   * Called when replica receives updates from master via Kafka
   */
  async processMasterUpdate(message: any): Promise<void> {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (config.mode !== 'replica') {
      throw new Error('processMasterUpdate only available in replica mode');
    }

    const { messageId, contentType, contentId: masterDocumentId, data, operation } = message;

    // Handle conflict-rejected notifications from master (conflict detected)
    if (operation === 'conflict-rejected') {
      await this.handleConflictNotification(message);
      return;
    }

    // Handle conflict resolution notifications from master (admin resolved conflict)
    if (operation === 'conflict-resolved') {
      await this.handleConflictResolution(message);
      return;
    }

    // Handle create-ack from master (mapping confirmation)
    if (operation === 'create-ack') {
      await this.handleCreateAck(message);
      return;
    }

    if (!contentType || !masterDocumentId) {
      strapi.log.warn('[Sync] Invalid master update: missing required fields');
      return;
    }

    // Skip updates that originated from this ship to avoid loops
    const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
    const shipId = config.shipId;

    // Set flag to prevent Document Service middleware from re-queueing these changes
    // This prevents infinite sync loops (master->replica->master->...)
    (strapi as any)._offlineSyncFromMaster = true;

    try {
      // Validate content type exists
      const model = strapi.contentTypes[contentType];
      if (!model) {
        strapi.log.warn(`[Sync] Unknown content type from master: ${contentType}`);
        return;
      }

      // Clean data - remove internal fields
      const cleanedData = this.cleanSyncData(data || {});

      // Check if we have a local copy of this master document
      // (reverse lookup: find local doc mapped to this master doc)
      const localMapping = await documentMapping.findByMasterDocumentId(
        shipId,
        contentType,
        masterDocumentId
      );

      if (operation === 'delete') {
        if (localMapping?.replicaDocumentId) {
          // Check if local document exists
          const localDoc = await strapi.documents(contentType).findOne({
            documentId: localMapping.replicaDocumentId
          });

          if (localDoc) {
            await strapi.documents(contentType).delete({
              documentId: localMapping.replicaDocumentId
            });
            strapi.log.info(`[Sync] 📥 Deleted local ${contentType} (${localMapping.replicaDocumentId}) from master`);
          }

          // Clean up mapping
          await documentMapping.deleteMapping(shipId, contentType, localMapping.replicaDocumentId);
        }
      } else if (localMapping?.replicaDocumentId) {
        // Update existing local document
        const localDoc = await strapi.documents(contentType).findOne({
          documentId: localMapping.replicaDocumentId
        });

        if (localDoc) {
          // Check for local modifications (conflict detection)
          const localUpdatedAt = localDoc.updatedAt ? new Date(localDoc.updatedAt) : null;
          const mappingUpdatedAt = localMapping.updatedAt ? new Date(localMapping.updatedAt) : null;

          // If local was modified since last sync, we have a conflict
          const hasLocalChanges = mappingUpdatedAt && localUpdatedAt && localUpdatedAt > mappingUpdatedAt;

          if (hasLocalChanges) {
            // Log conflict - local ship has unsaved changes that conflict with master update
            strapi.log.warn(`[Sync] ⚠️ Local conflict: ${contentType} (${localMapping.replicaDocumentId}) - local changes would be overwritten`);
            // For now, master wins (can be made configurable)
          }

          // Apply master update to local and publish
          await strapi.documents(contentType).update({
            documentId: localMapping.replicaDocumentId,
            data: cleanedData,
            status: 'published',
          });

          // Update mapping timestamp
          await documentMapping.setMapping(shipId, contentType, localMapping.replicaDocumentId, masterDocumentId);

          strapi.log.info(`[Sync] 📥 Updated local ${contentType} (${localMapping.replicaDocumentId}) from master`);
        } else {
          // Local doc was deleted, recreate it
          const created = await strapi.documents(contentType).create({
            data: cleanedData,
            status: 'published',
          });

          if (created?.documentId) {
            await documentMapping.setMapping(shipId, contentType, created.documentId, masterDocumentId);
            strapi.log.info(`[Sync] 📥 Recreated ${contentType}: master ${masterDocumentId} -> local ${created.documentId}`);

            // Send mapping ACK to master so it knows the relationship
            const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
            if (kafkaProducer.isConnected()) {
              await kafkaProducer.sendMappingAck({
                contentType,
                replicaDocumentId: created.documentId,
                masterDocumentId,
              });
            }
          }
        }
      } else if (operation !== 'delete') {
        // No local copy exists - create new document (but NOT for delete operations)
        const created = await strapi.documents(contentType).create({
          data: cleanedData,
          status: 'published',
        });

        if (created?.documentId) {
          await documentMapping.setMapping(shipId, contentType, created.documentId, masterDocumentId);
          strapi.log.info(`[Sync] 📥 Created local ${contentType} from master: ${masterDocumentId} -> ${created.documentId}`);

          // Send mapping ACK to master so it knows the relationship
          const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
          if (kafkaProducer.isConnected()) {
            await kafkaProducer.sendMappingAck({
              contentType,
              replicaDocumentId: created.documentId,
              masterDocumentId,
            });
          }
        }
      } else {
        // Delete operation but no local mapping - nothing to delete, just log
        strapi.log.debug(`[Sync] Delete skipped - no local copy of ${contentType}/${masterDocumentId}`);
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error(`[Sync] Failed to process master update: ${contentType}:${masterDocumentId} - ${errorMessage}`);
    } finally {
      // Always reset the flag to allow normal local changes to be queued
      (strapi as any)._offlineSyncFromMaster = false;
    }
  },

  /**
   * Handle conflict notification from master (replica side)
   * Called when master rejects our update due to conflict
   */
  async handleConflictNotification(message: any): Promise<void> {
    const config = strapi.config.get('plugin::offline-sync', {});
    const {
      shipId,
      contentType,
      contentId,
      replicaDocumentId,
      conflictId,
      reason,
      masterData,
      shipData,
      queueId,
    } = message;

    // Only process if this notification is for our ship
    if (shipId !== config.shipId) {
      strapi.log.debug(`[Sync] Ignoring conflict notification for different ship: ${shipId}`);
      return;
    }

    strapi.log.warn(`[Sync] ⚠️ CONFLICT NOTIFICATION received from master`);
    strapi.log.warn(`[Sync]   Content: ${contentType} / ${replicaDocumentId}`);
    strapi.log.warn(`[Sync]   Conflict ID: ${conflictId}`);
    strapi.log.warn(`[Sync]   Reason: ${reason}`);

    try {
      // Mark the local sync_queue entry as 'conflict'
      const syncQueue = strapi.plugin('offline-sync').service('sync-queue');
      await syncQueue.markConflict({
        contentType,
        contentId: replicaDocumentId,
        shipId: config.shipId,
        conflictId,
        reason,
      });

      // Emit an event for the admin UI to show notification (optional)
      strapi.eventHub?.emit('offline-sync.conflict', {
        shipId: config.shipId,
        contentType,
        contentId: replicaDocumentId,
        conflictId,
        reason,
        masterData,
        shipData,
        timestamp: new Date().toISOString(),
      });

      strapi.log.info(`[Sync] Conflict marked locally as PENDING. Awaiting resolution from master admin.`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error(`[Sync] Failed to handle conflict notification: ${errorMessage}`);
    }
  },

  /**
   * Handle conflict resolution notification from master (replica side)
   * Called when master admin resolves a conflict
   */
  async handleConflictResolution(message: any): Promise<void> {
    const config = strapi.config.get('plugin::offline-sync', {});
    const {
      shipId,
      contentType,
      contentId,
      replicaDocumentId,
      conflictId,
      resolution, // 'keep-ship', 'keep-master', 'merge'
      resolvedData,
      resolvedBy,
    } = message;

    // Only process if this notification is for our ship
    if (shipId !== config.shipId) {
      strapi.log.debug(`[Sync] Ignoring conflict resolution for different ship: ${shipId}`);
      return;
    }

    strapi.log.info(`[Sync] ✅ CONFLICT RESOLUTION received from master`);
    strapi.log.info(`[Sync]   Content: ${contentType} / ${replicaDocumentId}`);
    strapi.log.info(`[Sync]   Conflict ID: ${conflictId}`);
    strapi.log.info(`[Sync]   Resolution: ${resolution}`);
    strapi.log.info(`[Sync]   Resolved by: ${resolvedBy || 'admin'}`);

    const syncQueue = strapi.plugin('offline-sync').service('sync-queue');

    try {
      switch (resolution) {
        case 'keep-ship':
          // Ship's version was accepted - our changes were applied to master
          await syncQueue.markConflictAccepted({
            contentType,
            contentId: replicaDocumentId,
            shipId: config.shipId,
            conflictId,
          });
          strapi.log.info(`[Sync] 🎉 Your changes were ACCEPTED and applied to master!`);
          break;

        case 'keep-master':
          // Master's version was kept - our changes were rejected
          await syncQueue.markConflictRejected({
            contentType,
            contentId: replicaDocumentId,
            shipId: config.shipId,
            conflictId,
            reason: 'Admin chose to keep master version',
          });

          // Optionally apply master's resolved data to local
          if (resolvedData) {
            try {
              const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
              const localMapping = await documentMapping.findByMasterDocumentId(
                config.shipId,
                contentType,
                contentId
              );

              if (localMapping?.replicaDocumentId) {
                (strapi as any)._offlineSyncFromMaster = true;
                await strapi.documents(contentType).update({
                  documentId: localMapping.replicaDocumentId,
                  data: this.cleanSyncData(resolvedData),
                  status: 'published',
                });
                (strapi as any)._offlineSyncFromMaster = false;
                strapi.log.info(`[Sync] Local content updated with master's version`);
              }
            } catch (updateError: any) {
              strapi.log.debug(`[Sync] Could not update local content: ${updateError.message}`);
            }
          }
          strapi.log.warn(`[Sync] ❌ Your changes were REJECTED. Master version was kept.`);
          break;

        case 'merge':
          // Changes were merged
          await syncQueue.markConflictMerged({
            contentType,
            contentId: replicaDocumentId,
            shipId: config.shipId,
            conflictId,
            mergeDetails: 'Changes were merged by admin',
          });

          // Apply merged data to local
          if (resolvedData) {
            try {
              const documentMapping = strapi.plugin('offline-sync').service('document-mapping');
              const localMapping = await documentMapping.findByMasterDocumentId(
                config.shipId,
                contentType,
                contentId
              );

              if (localMapping?.replicaDocumentId) {
                (strapi as any)._offlineSyncFromMaster = true;
                await strapi.documents(contentType).update({
                  documentId: localMapping.replicaDocumentId,
                  data: this.cleanSyncData(resolvedData),
                  status: 'published',
                });
                (strapi as any)._offlineSyncFromMaster = false;
                strapi.log.info(`[Sync] Local content updated with merged version`);
              }
            } catch (updateError: any) {
              strapi.log.debug(`[Sync] Could not update local content: ${updateError.message}`);
            }
          }
          strapi.log.info(`[Sync] 🔀 Changes were MERGED by admin.`);
          break;

        default:
          strapi.log.warn(`[Sync] Unknown resolution type: ${resolution}`);
      }

      // Emit an event for the admin UI
      strapi.eventHub?.emit('offline-sync.conflict-resolved', {
        shipId: config.shipId,
        contentType,
        contentId: replicaDocumentId,
        conflictId,
        resolution,
        timestamp: new Date().toISOString(),
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error(`[Sync] Failed to handle conflict resolution: ${errorMessage}`);
    }
  },

  /**
   * Handle mapping acknowledgment from replica (master side)
   * Called when replica creates a local copy of a master document and sends ACK
   * This allows master to save the mapping so future updates from replica work correctly
   */
  async handleMappingAck(message: any): Promise<void> {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (config.mode !== 'master') {
      strapi.log.debug('[Sync] handleMappingAck called in non-master mode, skipping');
      return;
    }

    const { shipId, contentType, replicaDocumentId, masterDocumentId } = message;

    if (!shipId || !contentType || !replicaDocumentId || !masterDocumentId) {
      strapi.log.warn('[Sync] Invalid mapping ACK: missing required fields');
      return;
    }

    try {
      const documentMapping = strapi.plugin('offline-sync').service('document-mapping');

      // Check if mapping already exists
      const existingMapping = await documentMapping.getMasterDocumentId(
        shipId,
        contentType,
        replicaDocumentId
      );

      if (existingMapping) {
        strapi.log.debug(`[Sync] Mapping already exists for ${shipId}/${contentType}/${replicaDocumentId}`);
        return;
      }

      // Verify the master document exists
      const masterDoc = await strapi.documents(contentType).findOne({
        documentId: masterDocumentId
      });

      if (!masterDoc) {
        strapi.log.warn(`[Sync] Master document not found: ${contentType}/${masterDocumentId}`);
        return;
      }

      // Save the mapping on master
      await documentMapping.setMapping(shipId, contentType, replicaDocumentId, masterDocumentId);

      strapi.log.info(`[Sync] ✅ Mapping ACK received: ${shipId}'s ${replicaDocumentId} → master's ${masterDocumentId}`);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error(`[Sync] Failed to handle mapping ACK: ${errorMessage}`);
    }
  },

  /**
   * Handle create acknowledgment from master (replica side)
   * Called when master creates a document from our CREATE operation
   * This tells us: "Your replicaDocId R001 is now masterDocId M001"
   * We save this mapping so Master's future updates work correctly
   */
  async handleCreateAck(message: any): Promise<void> {
    const config = strapi.config.get('plugin::offline-sync', {});

    if (config.mode !== 'replica') {
      strapi.log.debug('[Sync] handleCreateAck called in non-replica mode, skipping');
      return;
    }

    const { shipId, contentType, replicaDocumentId, masterDocumentId } = message;

    // Only process if this ACK is for our ship
    if (shipId !== config.shipId) {
      strapi.log.debug(`[Sync] Ignoring create ACK for different ship: ${shipId}`);
      return;
    }

    if (!contentType || !replicaDocumentId || !masterDocumentId) {
      strapi.log.warn('[Sync] Invalid create ACK: missing required fields');
      return;
    }

    try {
      const documentMapping = strapi.plugin('offline-sync').service('document-mapping');

      // Check if mapping already exists
      const existingMapping = await documentMapping.getMapping(
        config.shipId,
        contentType,
        replicaDocumentId
      );

      if (existingMapping) {
        strapi.log.debug(`[Sync] Mapping already exists for ${contentType}/${replicaDocumentId}`);
        return;
      }

      // Verify the local document exists
      const localDoc = await strapi.documents(contentType).findOne({
        documentId: replicaDocumentId
      });

      if (!localDoc) {
        strapi.log.warn(`[Sync] Local document not found: ${contentType}/${replicaDocumentId}`);
        return;
      }

      // Save the mapping on replica
      // This allows us to find master's document when Master sends updates
      await documentMapping.setMapping(config.shipId, contentType, replicaDocumentId, masterDocumentId);

      strapi.log.info(`[Sync] ✅ Create ACK received: my ${replicaDocumentId} → master's ${masterDocumentId}`);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error(`[Sync] Failed to handle create ACK: ${errorMessage}`);
    }
  },
});

