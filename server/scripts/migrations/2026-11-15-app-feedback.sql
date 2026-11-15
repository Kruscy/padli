-- Android-app visszajelzés / kérdőív (2026-11-15)
CREATE TABLE IF NOT EXISTS app_feedback (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id integer,
  username text,
  install text,          -- sikerült-e telepíteni
  device text,           -- telefon típusa (szabad szöveg)
  rating integer,        -- 1–5
  wishes text[],         -- kiválasztott funkció-ötletek
  wish_text text,        -- mit szeretnének még
  bug_text text,         -- hibák
  helper boolean,        -- segítene-e a fejlesztésben (tesztelés)
  contact text,          -- elérhetőség (Discord-név / e-mail), ha segítene
  ip text
);
GRANT SELECT, INSERT ON app_feedback TO padli;
GRANT USAGE, SELECT ON SEQUENCE app_feedback_id_seq TO padli;
