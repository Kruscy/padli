-- Biztonsági eseménynapló (támadási próbálkozások, gyanús minták) + IP-tiltólista.
-- Új táblák, meglévő adatot nem érint. Az események 90 nap után törlődnek
-- (server/lib/security-log.js napi takarítás) — az IP személyes adat.
CREATE TABLE IF NOT EXISTS security_events (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  type        text NOT NULL,
  severity    text NOT NULL DEFAULT 'info',   -- info | warn | high
  ip          text,
  country     text,
  user_id     integer,
  username    text,
  method      text,
  path        text,
  user_agent  text,
  details     jsonb
);
CREATE INDEX IF NOT EXISTS security_events_created_idx ON security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_ip_idx      ON security_events (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_idx    ON security_events (type, created_at DESC);

CREATE TABLE IF NOT EXISTS ip_blocks (
  ip          text PRIMARY KEY,
  reason      text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz            -- NULL = végleges
);
