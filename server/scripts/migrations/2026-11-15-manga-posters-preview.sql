-- Péntek esti Discord-előnézet (2026-11-15)
-- status: pending (előnézet kint) | approved | skipped | replaced | posted | failed
ALTER TABLE manga_posters ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE manga_posters ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE manga_posters ADD COLUMN IF NOT EXISTS discord_message_id text;
ALTER TABLE manga_posters ADD COLUMN IF NOT EXISTS decided_by text;
UPDATE manga_posters SET status = CASE WHEN fb_post_id IS NOT NULL THEN 'posted' WHEN error IS NOT NULL THEN 'failed' END
 WHERE status IS NULL;
