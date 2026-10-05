-- Discord-fiók összekapcsolása (Beállítások → Discord), támogatói rangokhoz.
-- Csak új, NULL-ozható oszlopok + részleges egyedi index: meglévő sorokat nem érint.
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id        text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_linked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_uniq ON users (discord_id) WHERE discord_id IS NOT NULL;
