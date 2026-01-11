-- ============================================
-- OFFLINE SYNC PLUGIN - IMAGE TABLES
-- ============================================
-- Migration: 002_create_image_tables.sql
-- Purpose: Create tables for offline image sync with MinIO
-- Run: psql -U postgres -d your_database -f 002_create_image_tables.sql
-- ============================================

-- ============================================
-- IMAGE REGISTRY TABLE
-- ============================================
-- Tracks all images and their sync status between local MinIO and master storage

CREATE TABLE IF NOT EXISTS image_registry (
    id SERIAL PRIMARY KEY,
    
    -- File identification
    file_id VARCHAR(255) UNIQUE NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64),
    file_size BIGINT,
    mime_type VARCHAR(100),
    file_ext VARCHAR(20),
    
    -- Storage locations
    local_path VARCHAR(500),
    master_path VARCHAR(500),
    
    -- URLs for access
    local_url VARCHAR(500),
    master_url VARCHAR(500),
    
    -- Sync status
    -- Values: local_only, synced, master_only, pending_delete, deleted
    sync_status VARCHAR(50) DEFAULT 'local_only',
    
    -- Origin tracking
    -- Values: master, ship-001, ship-002, etc.
    created_by VARCHAR(100),
    
    -- Strapi file reference (links to files table)
    strapi_file_id INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    synced_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for image_registry
CREATE INDEX IF NOT EXISTS idx_image_registry_file_hash ON image_registry(file_hash);
CREATE INDEX IF NOT EXISTS idx_image_registry_sync_status ON image_registry(sync_status);
CREATE INDEX IF NOT EXISTS idx_image_registry_created_by ON image_registry(created_by);
CREATE INDEX IF NOT EXISTS idx_image_registry_created_at ON image_registry(created_at);
CREATE INDEX IF NOT EXISTS idx_image_registry_strapi_file_id ON image_registry(strapi_file_id);

-- ============================================
-- IMAGE SYNC QUEUE TABLE
-- ============================================
-- Queue for pending image sync operations (upload, download, delete)

CREATE TABLE IF NOT EXISTS image_sync_queue (
    id SERIAL PRIMARY KEY,
    
    -- Operation details
    file_id VARCHAR(255) NOT NULL,
    -- Values: upload, download, delete
    operation VARCHAR(50) NOT NULL,
    
    -- Status tracking
    -- Values: pending, syncing, completed, failed
    status VARCHAR(50) DEFAULT 'pending',
    
    -- Source and destination URLs
    source_url VARCHAR(500),
    destination_url VARCHAR(500),
    
    -- Retry logic
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    last_error TEXT,
    
    -- Priority (higher = process first)
    priority INT DEFAULT 0,
    
    -- File metadata
    file_size BIGINT,
    mime_type VARCHAR(100),
    
    -- Additional metadata (JSON)
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Indexes for image_sync_queue
CREATE INDEX IF NOT EXISTS idx_image_sync_queue_status ON image_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_image_sync_queue_priority ON image_sync_queue(priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_image_sync_queue_file_id ON image_sync_queue(file_id);
CREATE INDEX IF NOT EXISTS idx_image_sync_queue_operation ON image_sync_queue(operation);

-- ============================================
-- TRIGGER: Auto-update updated_at timestamp
-- ============================================

CREATE OR REPLACE FUNCTION update_image_registry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_image_registry_updated_at ON image_registry;
CREATE TRIGGER trigger_image_registry_updated_at
    BEFORE UPDATE ON image_registry
    FOR EACH ROW
    EXECUTE FUNCTION update_image_registry_timestamp();

-- ============================================
-- VERIFICATION
-- ============================================

DO $$
BEGIN
    -- Verify image_registry table
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'image_registry') THEN
        RAISE NOTICE '[OK] Table image_registry created successfully';
    ELSE
        RAISE EXCEPTION '[ERROR] Failed to create image_registry table';
    END IF;
    
    -- Verify image_sync_queue table
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'image_sync_queue') THEN
        RAISE NOTICE '[OK] Table image_sync_queue created successfully';
    ELSE
        RAISE EXCEPTION '[ERROR] Failed to create image_sync_queue table';
    END IF;
    
    RAISE NOTICE '[OK] All image tables created successfully!';
END $$;

-- ============================================
-- SAMPLE QUERIES (for reference)
-- ============================================

-- Get images pending sync:
-- SELECT * FROM image_registry WHERE sync_status = 'local_only';

-- Get pending sync operations:
-- SELECT * FROM image_sync_queue WHERE status = 'pending' ORDER BY priority DESC, created_at ASC;

-- Get sync statistics:
-- SELECT sync_status, COUNT(*) FROM image_registry GROUP BY sync_status;

-- Get queue statistics:
-- SELECT status, COUNT(*) FROM image_sync_queue GROUP BY status;

