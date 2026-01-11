-- ============================================================================
-- Offline Sync Plugin - Database Migration Script
-- ============================================================================
-- This script creates the required tables for the offline-sync plugin.
-- Run this script on BOTH Master and Replica databases before starting Strapi.
-- ============================================================================

-- ============================================================================
-- TABLE: sync_queue (Replica Only - but safe to create on Master too)
-- Purpose: Stores pending sync operations when replica is offline
-- ============================================================================
-- 
-- STATUS VALUES:
--   pending           = Waiting to be pushed to master
--   syncing           = Currently being sent to master
--   pushed            = Sent to Kafka, awaiting confirmation
--   synced            = Successfully synced with master
--   failed            = Failed to sync (network error, etc.)
--   conflict_pending  = Conflict detected, waiting for admin resolution on master
--   conflict_resolved = Admin resolved the conflict (may or may not have applied ship's changes)
--   conflict_rejected = Ship's changes were rejected (master version kept)
--   conflict_accepted = Ship's changes were accepted (master updated with ship data)
--   conflict_merged   = Changes were merged (partial application)
--
CREATE TABLE IF NOT EXISTS sync_queue (
    id SERIAL PRIMARY KEY,
    ship_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    content_id VARCHAR(255) NOT NULL,
    operation VARCHAR(50) NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    local_version INTEGER DEFAULT 0,
    data JSONB,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
        'pending', 
        'syncing', 
        'pushed', 
        'synced', 
        'failed', 
        'conflict_pending',
        'conflict_resolved',
        'conflict_rejected',
        'conflict_accepted',
        'conflict_merged'
    )),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    kafka_offset BIGINT,
    
    -- Conflict tracking fields (for replica to see what happened)
    conflict_id INTEGER,                                    -- Reference to conflict_logs.id on master
    conflict_reason TEXT,                                   -- Why there was a conflict
    conflict_resolved_at TIMESTAMP WITH TIME ZONE,          -- When conflict was resolved
    conflict_resolution VARCHAR(50) CHECK (conflict_resolution IN ('keep-ship', 'keep-master', 'merge')),
    
    synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for sync_queue
CREATE INDEX IF NOT EXISTS idx_sync_queue_ship_status ON sync_queue(ship_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_content ON sync_queue(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_conflicts ON sync_queue(ship_id) WHERE status LIKE 'conflict_%';

-- ============================================================================
-- MIGRATION: Update existing sync_queue table with new conflict columns
-- (Safe to run multiple times - uses IF NOT EXISTS / conditional checks)
-- ============================================================================
DO $$
BEGIN
    -- Add conflict_id column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_queue' AND column_name = 'conflict_id') THEN
        ALTER TABLE sync_queue ADD COLUMN conflict_id INTEGER;
        RAISE NOTICE '[OK] Added conflict_id column to sync_queue';
    END IF;

    -- Add conflict_reason column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_queue' AND column_name = 'conflict_reason') THEN
        ALTER TABLE sync_queue ADD COLUMN conflict_reason TEXT;
        RAISE NOTICE '[OK] Added conflict_reason column to sync_queue';
    END IF;

    -- Add conflict_resolved_at column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_queue' AND column_name = 'conflict_resolved_at') THEN
        ALTER TABLE sync_queue ADD COLUMN conflict_resolved_at TIMESTAMP WITH TIME ZONE;
        RAISE NOTICE '[OK] Added conflict_resolved_at column to sync_queue';
    END IF;

    -- Add conflict_resolution column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_queue' AND column_name = 'conflict_resolution') THEN
        ALTER TABLE sync_queue ADD COLUMN conflict_resolution VARCHAR(50);
        RAISE NOTICE '[OK] Added conflict_resolution column to sync_queue';
    END IF;

    -- Update status check constraint to include new conflict statuses
    -- First drop old constraint, then add new one
    IF EXISTS (SELECT 1 FROM information_schema.check_constraints 
               WHERE constraint_name = 'sync_queue_status_check') THEN
        ALTER TABLE sync_queue DROP CONSTRAINT sync_queue_status_check;
        RAISE NOTICE '[OK] Dropped old status constraint';
    END IF;

    -- Add new constraint with all statuses
    ALTER TABLE sync_queue ADD CONSTRAINT sync_queue_status_check 
    CHECK (status IN (
        'pending', 
        'syncing', 
        'pushed', 
        'synced', 
        'failed', 
        'conflict',
        'conflict_pending',
        'conflict_resolved',
        'conflict_rejected',
        'conflict_accepted',
        'conflict_merged'
    ));
    RAISE NOTICE '[OK] Added new status constraint with conflict statuses';

EXCEPTION
    WHEN others THEN
        RAISE NOTICE '[INFO] sync_queue migration: %', SQLERRM;
END $$;


-- ============================================================================
-- TABLE: conflict_logs (Master Only - but safe to create on Replica too)
-- Purpose: Stores detected conflicts for admin resolution
-- ============================================================================
CREATE TABLE IF NOT EXISTS conflict_logs (
    id SERIAL PRIMARY KEY,
    content_type VARCHAR(255) NOT NULL,
    content_id VARCHAR(255) NOT NULL,
    ship_id VARCHAR(255) NOT NULL,
    ship_version INTEGER,
    master_version INTEGER,
    ship_data JSONB,
    master_data JSONB,
    conflict_type VARCHAR(100) DEFAULT 'concurrent-edit',
    resolution_strategy VARCHAR(50) CHECK (resolution_strategy IN ('keep-ship', 'keep-master', 'merge')),
    resolution_data JSONB,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for conflict_logs
CREATE INDEX IF NOT EXISTS idx_conflict_logs_unresolved ON conflict_logs(content_type, content_id, ship_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conflict_logs_ship ON conflict_logs(ship_id);
CREATE INDEX IF NOT EXISTS idx_conflict_logs_created_at ON conflict_logs(created_at);


-- ============================================================================
-- TRIGGER: Auto-update updated_at timestamp
-- ============================================================================

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for sync_queue
DROP TRIGGER IF EXISTS update_sync_queue_updated_at ON sync_queue;
CREATE TRIGGER update_sync_queue_updated_at
    BEFORE UPDATE ON sync_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for conflict_logs
DROP TRIGGER IF EXISTS update_conflict_logs_updated_at ON conflict_logs;
CREATE TRIGGER update_conflict_logs_updated_at
    BEFORE UPDATE ON conflict_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- TABLE: document_mappings (Auto-created by Strapi, but we add unique constraint)
-- Purpose: Maps replica documentIds to master documentIds to prevent duplicates
-- Note: Strapi creates this table automatically, but we add a unique constraint
-- ============================================================================

-- Add unique constraint to prevent duplicate mappings (safe to run multiple times)
-- This prevents race conditions where two concurrent requests could create duplicates
DO $$
BEGIN
    -- Check if the table exists (Strapi must have created it)
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'document_mappings') THEN
        -- Check if unique constraint already exists
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'uq_document_mapping_ship_content_replica'
        ) THEN
            ALTER TABLE document_mappings 
            ADD CONSTRAINT uq_document_mapping_ship_content_replica 
            UNIQUE (ship_id, content_type, replica_document_id);
            RAISE NOTICE '[OK] Added unique constraint to document_mappings';
        ELSE
            RAISE NOTICE '[OK] Unique constraint already exists on document_mappings';
        END IF;
    ELSE
        RAISE NOTICE '[INFO] document_mappings table not yet created (Strapi will create it on startup)';
    END IF;
END $$;

-- Also add index for faster lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_document_mappings_lookup 
ON document_mappings(ship_id, content_type, replica_document_id);

CREATE INDEX IF NOT EXISTS idx_document_mappings_reverse_lookup 
ON document_mappings(ship_id, content_type, master_document_id);


-- ============================================================================
-- VERIFICATION: Check tables were created
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sync_queue') THEN
        RAISE NOTICE '[OK] sync_queue table created successfully';
    ELSE
        RAISE WARNING '[ERROR] sync_queue table was NOT created';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'conflict_logs') THEN
        RAISE NOTICE '[OK] conflict_logs table created successfully';
    ELSE
        RAISE WARNING '[ERROR] conflict_logs table was NOT created';
    END IF;

    -- Note: document_mappings is created by Strapi, not this script
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'document_mappings') THEN
        RAISE NOTICE '[OK] document_mappings table exists (created by Strapi)';
        
        -- Check if unique constraint exists
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_document_mapping_ship_content_replica') THEN
            RAISE NOTICE '[OK] document_mappings unique constraint exists';
        ELSE
            RAISE WARNING '[INFO] document_mappings unique constraint will be added after Strapi creates the table';
        END IF;
    ELSE
        RAISE NOTICE '[INFO] document_mappings will be created by Strapi on first startup';
    END IF;
END $$;

-- ============================================================================
-- Done!
-- ============================================================================

