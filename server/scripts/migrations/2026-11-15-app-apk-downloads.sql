-- Android-app APK letöltések számlálása (2026-11-15)
CREATE TABLE IF NOT EXISTS app_apk_downloads (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id integer,
  file text,
  ip text
);
GRANT SELECT, INSERT ON app_apk_downloads TO padli;
GRANT USAGE, SELECT ON SEQUENCE app_apk_downloads_id_seq TO padli;
