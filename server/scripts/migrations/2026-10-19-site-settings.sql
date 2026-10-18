-- Oldal-beállítások (név, cím, tulajdonos…) — lásd server/lib/site-config.js.
-- A telepítő varázsló és az admin felület írja; a környezeti változókat
-- (SITE_NAME, SITE_URL, OWNER_USER_ID…) felülírja. Ismételten futtatható.
CREATE TABLE IF NOT EXISTS site_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A meglévő (eredeti) telepítés tulajdonosa eddig kódba írva az 5-ös
-- azonosítójú admin volt. Friss telepítésen ez a migráció még üres
-- adatbázison fut (nincs ilyen felhasználó), ott a varázsló állítja be.
INSERT INTO site_settings (key, value)
SELECT 'ownerUserId', '5' FROM users WHERE id = 5 AND role = 'admin'
ON CONFLICT (key) DO NOTHING;
