-- ============================================================================
-- PRODUCTION FIX: Populate Cache Race Condition
-- ============================================================================
-- 
-- Problem:
--   Strapi's populate_cache table has a unique constraint on 'hash'.
--   When concurrent operations happen (Admin UI + Kafka sync), 
--   duplicate INSERT errors occur.
--
-- Solution:
--   A BEFORE INSERT trigger that checks for existing hash and either:
--   - Allows the INSERT if hash doesn't exist
--   - Updates the existing row if hash exists (upsert behavior)
--
-- Why this is production-safe:
--   1. Does NOT modify Strapi's constraints or indexes
--   2. Trigger runs BEFORE the constraint check
--   3. Only affects duplicate inserts (normal operations unaffected)
--   4. Database-level fix (works regardless of application code)
--
-- ============================================================================

-- Step 1: Create the upsert function
CREATE OR REPLACE FUNCTION fn_populate_cache_handle_duplicate()
RETURNS TRIGGER AS $$
BEGIN
    -- Try to find existing entry with same hash
    PERFORM 1 FROM populate_cache WHERE hash = NEW.hash LIMIT 1;
    
    IF FOUND THEN
        -- Hash exists - update the existing row instead of inserting
        UPDATE populate_cache 
        SET 
            updated_at = COALESCE(NEW.updated_at, NOW()),
            dependencies = NEW.dependencies,
            params = NEW.params,
            populate = NEW.populate,
            document_id = NEW.document_id
        WHERE hash = NEW.hash;
        
        -- Return NULL to skip the original INSERT
        RETURN NULL;
    END IF;
    
    -- Hash doesn't exist - allow the INSERT
    RETURN NEW;
    
EXCEPTION
    WHEN unique_violation THEN
        -- Race condition: another transaction inserted between our check and insert
        -- Just ignore this insert - the other transaction's data is equivalent
        RETURN NULL;
    WHEN OTHERS THEN
        -- For any other error, log and allow original behavior
        RAISE WARNING 'populate_cache trigger error: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create the trigger (drop first if exists)
DROP TRIGGER IF EXISTS trg_populate_cache_handle_duplicate ON populate_cache;

CREATE TRIGGER trg_populate_cache_handle_duplicate
    BEFORE INSERT ON populate_cache
    FOR EACH ROW
    EXECUTE FUNCTION fn_populate_cache_handle_duplicate();

-- Step 3: Verify installation
DO $$
DECLARE
    trigger_exists BOOLEAN;
    function_exists BOOLEAN;
BEGIN
    -- Check trigger
    SELECT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'trg_populate_cache_handle_duplicate'
        AND tgrelid = 'populate_cache'::regclass
    ) INTO trigger_exists;
    
    -- Check function
    SELECT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'fn_populate_cache_handle_duplicate'
    ) INTO function_exists;
    
    IF trigger_exists AND function_exists THEN
        RAISE NOTICE '============================================';
        RAISE NOTICE '[SUCCESS] Populate cache fix installed!';
        RAISE NOTICE '  - Trigger: trg_populate_cache_handle_duplicate';
        RAISE NOTICE '  - Function: fn_populate_cache_handle_duplicate';
        RAISE NOTICE '============================================';
    ELSE
        RAISE WARNING '[WARNING] Installation incomplete!';
        RAISE WARNING '  Trigger exists: %', trigger_exists;
        RAISE WARNING '  Function exists: %', function_exists;
    END IF;
END $$;

-- Optional: Clean up any existing duplicates (safe to run multiple times)
-- This deletes older duplicates, keeping the newest entry for each hash
DELETE FROM populate_cache a
USING populate_cache b
WHERE a.id < b.id 
AND a.hash = b.hash;

