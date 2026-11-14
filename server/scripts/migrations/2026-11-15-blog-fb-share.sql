-- Blogposzt Facebook-megosztás nyilvántartása (2026-11-15)
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS fb_post_id text;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS fb_shared_at timestamptz;
-- A funkció előtti posztokat nem osztjuk meg utólag
UPDATE blog_posts SET fb_post_id = 'skip' WHERE fb_post_id IS NULL;
