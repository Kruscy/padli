-- Hírek készülékhez kötése (2026-11-15): all | desktop | android | mobile
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'all';
-- (a user kérésére a hero-ban minden hír minden eszközön látszik; a mező későbbi célzott hírekhez van)
