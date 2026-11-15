-- App-biztonság (2026-11-15): kulcs csak a végével jelenik meg, PKCE a belépéshez, eszközlista IP-vel
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS suffix text;            -- a kulcs utolsó 4 karaktere (megjelenítéshez)
ALTER TABLE app_auth_codes ADD COLUMN IF NOT EXISTS code_challenge text; -- PKCE (S256)
ALTER TABLE app_tokens ADD COLUMN IF NOT EXISTS last_ip text;
