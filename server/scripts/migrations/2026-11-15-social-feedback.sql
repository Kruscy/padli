-- Admin-visszajelzések a #media csatornából (2026-11-15): az AI a következő válogatásoknál is figyelembe veszi
CREATE TABLE IF NOT EXISTS social_feedback (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,            -- 'snippet' | 'poster'
  target_id integer,
  author text,
  message text NOT NULL,
  instruction text               -- az AI által kiszűrt, általánosítható szabály (ha van)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON social_feedback TO padli;
GRANT USAGE, SELECT ON SEQUENCE social_feedback_id_seq TO padli;
