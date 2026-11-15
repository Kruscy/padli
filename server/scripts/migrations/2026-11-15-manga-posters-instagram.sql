-- Heti manga-poszter Instagramra is (2026-11-15)
ALTER TABLE manga_posters ADD COLUMN IF NOT EXISTS ig_media_id text;
ALTER TABLE manga_posters ADD COLUMN IF NOT EXISTS ig_permalink text;
