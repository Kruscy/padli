-- Padlizsan Studio hibajelentés / használati események (2026-11-15)
CREATE TABLE IF NOT EXISTS studio_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  install_id text,
  user_id integer,
  username text,
  version text,
  os text,
  event text NOT NULL,
  data jsonb,
  ip text
);
CREATE INDEX IF NOT EXISTS studio_events_created_idx ON studio_events (created_at DESC);
CREATE INDEX IF NOT EXISTS studio_events_install_idx ON studio_events (install_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON studio_events TO padli;
GRANT USAGE, SELECT ON SEQUENCE studio_events_id_seq TO padli;
