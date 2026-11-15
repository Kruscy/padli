-- Lapozós részlet TikTokra is (Publer) (2026-11-15)
ALTER TABLE ig_snippets ADD COLUMN IF NOT EXISTS tiktok_paths text[];
ALTER TABLE ig_snippets ADD COLUMN IF NOT EXISTS tiktok_post_id text;
ALTER TABLE ig_snippets ADD COLUMN IF NOT EXISTS tiktok_error text;
