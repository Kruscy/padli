-- Heti manga-poszter nyilvántartás (2026-11-15)
CREATE TABLE IF NOT EXISTS manga_posters (
  id          bigserial PRIMARY KEY,
  manga_id    integer REFERENCES manga(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  fb_post_id  text,
  panels      text[],
  caption     text,
  error       text
);
CREATE INDEX IF NOT EXISTS manga_posters_manga_idx ON manga_posters (manga_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON manga_posters TO padli;
GRANT USAGE, SELECT ON SEQUENCE manga_posters_id_seq TO padli;
