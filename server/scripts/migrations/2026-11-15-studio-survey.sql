-- Padlizsan Studio körkérdés a letöltőknek, kitöltésért +20 pont (2026-11-15)
CREATE TABLE IF NOT EXISTS studio_survey (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  sent_at timestamptz,
  answered_at timestamptz,
  answers jsonb,
  points integer
);
GRANT SELECT, INSERT, UPDATE, DELETE ON studio_survey TO padli;
GRANT USAGE, SELECT ON SEQUENCE studio_survey_id_seq TO padli;
