/**
 * Document Mapping Service
 * Maps replica documentIds to master documentIds for proper sync
 */

const CONTENT_TYPE = 'plugin::offline-sync.document-mapping';

interface DocumentMapping {
    id: number;
    documentId: string;
    shipId: string;
    contentType: string;
    replicaDocumentId: string;
    masterDocumentId: string;
    createdAt: Date;
    updatedAt: Date;
}

export default ({ strapi }: { strapi: any }) => ({
    /**
     * Get the full mapping record (includes timestamps for conflict detection)
     */
    async getMapping(
        shipId: string,
        contentType: string,
        replicaDocumentId: string
    ): Promise<DocumentMapping | null> {
        try {
            const mapping = await strapi.documents(CONTENT_TYPE).findFirst({
                filters: {
                    shipId: { $eq: shipId },
                    contentType: { $eq: contentType },
                    replicaDocumentId: { $eq: replicaDocumentId },
                },
            });
            return mapping as DocumentMapping | null;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            strapi.log.error(`[DocumentMapping] Failed to get mapping: ${message}`);
            return null;
        }
    },

    /**
     * Get master documentId for a replica documentId
     */
    async getMasterDocumentId(
        shipId: string,
        contentType: string,
        replicaDocumentId: string
    ): Promise<string | null> {
        const mapping = await this.getMapping(shipId, contentType, replicaDocumentId);
        return mapping?.masterDocumentId || null;
    },

    /**
     * Create or update a document mapping
     */
    async setMapping(
        shipId: string,
        contentType: string,
        replicaDocumentId: string,
        masterDocumentId: string
    ): Promise<DocumentMapping | null> {
        try {
            // Check if mapping exists
            const existing = await strapi.documents(CONTENT_TYPE).findFirst({
                filters: {
                    shipId: { $eq: shipId },
                    contentType: { $eq: contentType },
                    replicaDocumentId: { $eq: replicaDocumentId },
                },
            });

            if (existing) {
                // Update existing mapping
                const updated = await strapi.documents(CONTENT_TYPE).update({
                    documentId: existing.documentId,
                    data: { masterDocumentId },
                });
                return updated as DocumentMapping;
            }

            // Create new mapping
            const created = await strapi.documents(CONTENT_TYPE).create({
                data: {
                    shipId,
                    contentType,
                    replicaDocumentId,
                    masterDocumentId,
                },
            });

            strapi.log.debug(`[DocumentMapping] Created mapping: ${replicaDocumentId} -> ${masterDocumentId}`);
            return created as DocumentMapping;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            strapi.log.error(`[DocumentMapping] Failed to set mapping: ${message}`);
            return null;
        }
    },

    /**
     * Delete a document mapping
     */
    async deleteMapping(
        shipId: string,
        contentType: string,
        replicaDocumentId: string
    ): Promise<boolean> {
        try {
            const existing = await strapi.documents(CONTENT_TYPE).findFirst({
                filters: {
                    shipId: { $eq: shipId },
                    contentType: { $eq: contentType },
                    replicaDocumentId: { $eq: replicaDocumentId },
                },
            });

            if (existing) {
                await strapi.documents(CONTENT_TYPE).delete({
                    documentId: existing.documentId,
                });
                return true;
            }

            return false;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            strapi.log.error(`[DocumentMapping] Failed to delete mapping: ${message}`);
            return false;
        }
    },

    /**
     * Get all mappings for a ship
     */
    async getMappingsForShip(shipId: string): Promise<DocumentMapping[]> {
        try {
            const mappings = await strapi.documents(CONTENT_TYPE).findMany({
                filters: { shipId: { $eq: shipId } },
            });
            return mappings as DocumentMapping[];
        } catch (error: unknown) {
            return [];
        }
    },

    /**
     * Find mapping by master documentId (reverse lookup)
     * Used when replica receives updates from master
     */
    async findByMasterDocumentId(
        shipId: string,
        contentType: string,
        masterDocumentId: string
    ): Promise<DocumentMapping | null> {
        try {
            const mapping = await strapi.documents(CONTENT_TYPE).findFirst({
                filters: {
                    shipId: { $eq: shipId },
                    contentType: { $eq: contentType },
                    masterDocumentId: { $eq: masterDocumentId },
                },
            });
            return mapping as DocumentMapping | null;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            strapi.log.error(`[DocumentMapping] Failed to find by master ID: ${message}`);
            return null;
        }
    },
});

