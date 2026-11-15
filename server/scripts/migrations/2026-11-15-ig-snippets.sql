-- Instagram lapozós történetrészlet (2026-11-15)
CREATE TABLE IF NOT EXISTS ig_snippets (
  id serial PRIMARY KEY,
  manga_id integer REFERENCES manga(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  panels text[],
  caption text,
  image_paths text[],
  discord_message_id text,
  decided_by text,
  ig_media_id text,
  ig_permalink text,
  error text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON ig_snippets TO padli;
GRANT USAGE, SELECT ON SEQUENCE ig_snippets_id_seq TO padli;
