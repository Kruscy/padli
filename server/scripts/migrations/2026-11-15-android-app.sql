-- Android-app: belépés (egyszer használatos kód → hosszú életű app-token) és letöltési napló/keret (2026-11-15)
CREATE TABLE IF NOT EXISTS app_auth_codes (
  code_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state text NOT NULL,
  device text,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS app_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS app_downloads (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manga_slug text NOT NULL,
  chapter text NOT NULL,
  pages integer,
  status text NOT NULL DEFAULT 'issued',   -- issued | done | failed
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  bytes bigint
);
CREATE INDEX IF NOT EXISTS app_downloads_user_idx ON app_downloads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_downloads_status_idx ON app_downloads (status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON app_auth_codes, app_tokens, app_downloads TO padli;
GRANT USAGE, SELECT ON SEQUENCE app_tokens_id_seq, app_downloads_id_seq TO padli;
