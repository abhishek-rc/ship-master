-- ============================================================================
-- Master Sync Queue - Database Migration Script
-- ============================================================================
-- This script creates the master_sync_queue table for queueing Master changes
-- when Kafka is offline. Run this on the MASTER database.
-- ============================================================================

-- ============================================================================
-- TABLE: master_sync_queue (Master Only)
-- Purpose: Stores pending sync operations when Master's Kafka is offline
-- ============================================================================
-- 
-- STATUS VALUES:
--   pending  = Waiting to be sent to ships via Kafka
--   sending  = Currently being sent to Kafka
--   sent     = Successfully sent to Kafka
--   failed   = Failed to send (will retry)
--
CREATE TABLE IF NOT EXISTS master_sync_queue (
    id SERIAL PRIMARY KEY,
    content_type VARCHAR(255) NOT NULL,
    content_id VARCHAR(255) NOT NULL,
    operation VARCHAR(50) NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    data JSONB,
    locale VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
        'pending', 
        'sending', 
        'sent', 
        'failed'
    )),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for master_sync_queue
CREATE INDEX IF NOT EXISTS idx_master_sync_queue_status ON master_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_master_sync_queue_created_at ON master_sync_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_master_sync_queue_content ON master_sync_queue(content_type, content_id);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_master_sync_queue_updated_at ON master_sync_queue;
CREATE TRIGGER update_master_sync_queue_updated_at
    BEFORE UPDATE ON master_sync_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- TABLE: master_edit_log (Master Only)
-- Purpose: Tracks direct Master edits for conflict detection
-- This helps distinguish between:
--   1. Master edited by admin (should trigger conflict with ship updates)
--   2. Master edited by ship sync (should NOT trigger conflict with same ship)
-- ============================================================================
CREATE TABLE IF NOT EXISTS master_edit_log (
    id SERIAL PRIMARY KEY,
    content_type VARCHAR(255) NOT NULL,
    document_id VARCHAR(255) NOT NULL,
    operation VARCHAR(50) NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    edited_by VARCHAR(255) NOT NULL,  -- 'master-admin' or 'ship-{shipId}'
    locale VARCHAR(50),
    edited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint: only keep latest edit per document
    CONSTRAINT uq_master_edit_log_document UNIQUE (content_type, document_id)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_master_edit_log_lookup ON master_edit_log(content_type, document_id);
CREATE INDEX IF NOT EXISTS idx_master_edit_log_edited_at ON master_edit_log(edited_at);


-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'master_sync_queue') THEN
        RAISE NOTICE '[OK] master_sync_queue table created successfully';
    ELSE
        RAISE WARNING '[ERROR] master_sync_queue table was NOT created';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'master_edit_log') THEN
        RAISE NOTICE '[OK] master_edit_log table created successfully';
    ELSE
        RAISE WARNING '[ERROR] master_edit_log table was NOT created';
    END IF;
END $$;

-- ============================================================================
-- Done!
-- ============================================================================

