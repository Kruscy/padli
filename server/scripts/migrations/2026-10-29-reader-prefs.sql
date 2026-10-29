-- Olvasó-beállítások felhasználónként és eszközönként (telefon / gép):
-- olvasási mód, irány, méretezés, széles képek felezése, webtoon-felismerés.
-- Lásd public/js/reader-core.js. Ismételten futtatható.
CREATE TABLE IF NOT EXISTS reader_prefs (
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device     text    NOT NULL,
  prefs      jsonb   NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device)
);
