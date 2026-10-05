-- Admin-műveleti napló (ki, mikor, mit állított át) — elsőként a fejezetek
-- feloldási idejének módosításai. Új tábla, meglévő adatot nem érint.
CREATE TABLE IF NOT EXISTS admin_action_log (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  admin_id      integer,
  admin_username text,
  action        text NOT NULL,
  target_type   text,
  target_id     bigint,
  target_title  text,
  details       jsonb
);
CREATE INDEX IF NOT EXISTS admin_action_log_created_idx ON admin_action_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_action_log_admin_idx   ON admin_action_log (admin_id, created_at DESC);
