-- 2026-11-12: minden API-kulcsos (/api/pc/v1) kérés naplója, az ingyeneseké is
-- (a fizetősek részletei továbbra is a pc_*_usage táblákban).
CREATE TABLE IF NOT EXISTS pc_key_requests (
  id         BIGSERIAL PRIMARY KEY,
  key_id     INT REFERENCES api_keys(id) ON DELETE SET NULL,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  method     TEXT NOT NULL,
  path       TEXT NOT NULL,
  status     INT,
  ms         INT,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_key_requests_user_time ON pc_key_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pc_key_requests_time ON pc_key_requests (created_at);
