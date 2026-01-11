-- ============================================================================
-- Migration: Add lastSyncedBy column to document_mappings
-- ============================================================================
-- Purpose: Track which ship last synced each document for accurate conflict detection
-- This prevents false conflicts when same ship does CREATE then UPDATE in sequence
-- ============================================================================

-- Add lastSyncedBy column if it doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'document_mappings') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'document_mappings' AND column_name = 'last_synced_by') THEN
            ALTER TABLE document_mappings ADD COLUMN last_synced_by VARCHAR(100);
            RAISE NOTICE '[OK] Added last_synced_by column to document_mappings';
        ELSE
            RAISE NOTICE '[OK] last_synced_by column already exists in document_mappings';
        END IF;
    ELSE
        RAISE NOTICE '[INFO] document_mappings table not yet created (Strapi will create it on startup)';
    END IF;
END $$;

-- Create index for faster lookups by lastSyncedBy
CREATE INDEX IF NOT EXISTS idx_document_mappings_last_synced_by 
ON document_mappings(last_synced_by);

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'document_mappings' AND column_name = 'last_synced_by') THEN
        RAISE NOTICE '[OK] last_synced_by column verified in document_mappings';
    ELSE
        RAISE WARNING '[WARNING] last_synced_by column not found - Strapi will add it on restart';
    END IF;
END $$;

