-- Step 1: Backup
CREATE TABLE IF NOT EXISTS files_backup_oss_migration AS 
SELECT * FROM files WHERE provider = 'local' OR formats::text LIKE '%/uploads/%';
 
-- Step 2: Update main URL field
UPDATE files
SET url = CONCAT(
    'https://cms-strapi-data-cs-np.oss-me-central-1.aliyuncs.com/uploads/',
    SUBSTRING(url FROM '/uploads/(.*)')
)
WHERE url LIKE '/uploads/%';
 
-- Step 3: Update preview_url field
UPDATE files
SET preview_url = CONCAT(
    'https://cms-strapi-data-cs-np.oss-me-central-1.aliyuncs.com/uploads/',
    SUBSTRING(preview_url FROM '/uploads/(.*)')
)
WHERE preview_url IS NOT NULL 
AND preview_url LIKE '/uploads/%';
 
-- Step 4: Update formats JSONB (all format types)
UPDATE files
SET formats = (
    SELECT jsonb_object_agg(
        key,
        CASE 
            WHEN value->>'url' LIKE '/uploads/%' THEN
                jsonb_set(
                    value,
                    '{url}',
                    to_jsonb(CONCAT('https://cms-strapi-data-cs-np.oss-me-central-1.aliyuncs.com/uploads/', SUBSTRING(value->>'url' FROM '/uploads/(.*)')))
                )
            ELSE value
        END
    )
    FROM jsonb_each(formats)
)
WHERE formats IS NOT NULL
AND formats::text LIKE '%/uploads/%';
 
-- Step 5: Update provider
UPDATE files
SET provider = 'strapi-provider-upload-oss'
WHERE provider = 'local';
 
-- Step 6: Update provider_metadata
UPDATE files
SET provider_metadata = jsonb_build_object(
    'provider', 'oss',
    'region', 'oss-me-central-1',
    'bucket', 'cms-strapi-data-cs-np'
)
WHERE provider = 'strapi-provider-upload-oss'
AND (provider_metadata IS NULL OR provider_metadata::text = 'null');
 
-- Step 7: Verify
SELECT 
    COUNT(*) as total_files,
    COUNT(CASE WHEN url LIKE 'https://cms-strapi-data-cs-np%' THEN 1 END) as oss_urls,
    COUNT(CASE WHEN formats::text LIKE '%https://cms-strapi-data-cs-np%' THEN 1 END) as oss_format_urls,
    COUNT(CASE WHEN provider = 'strapi-provider-upload-oss' THEN 1 END) as oss_provider_files,
    COUNT(CASE WHEN formats::text LIKE '%/uploads/%' THEN 1 END) as remaining_local_format_urls
FROM files;