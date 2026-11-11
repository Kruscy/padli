-- Studio/PadliCrome használati naplók: a felhasználónév is tárolódik, hogy
-- fióktörlés után (user_id → NULL) is látszódjon, ki használta (2026-11-11).
BEGIN;
ALTER TABLE pc_torii_usage ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE pc_llm_usage   ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE pc_text_usage  ADD COLUMN IF NOT EXISTS username text;

-- 1) Meglévő felhasználók
UPDATE pc_torii_usage t SET username = u.username FROM users u WHERE t.user_id = u.id AND t.username IS NULL;
UPDATE pc_llm_usage   t SET username = u.username FROM users u WHERE t.user_id = u.id AND t.username IS NULL;
UPDATE pc_text_usage  t SET username = u.username FROM users u WHERE t.user_id = u.id AND t.username IS NULL;

-- 2) Törölt fiókok: az API-kulcs létrehozásának biztonsági naplójából
WITH k AS (
  SELECT DISTINCT ON ((details->>'keyId')::int) (details->>'keyId')::int AS key_id, username
  FROM security_events
  WHERE type = 'api_key_created' AND details ? 'keyId' AND username IS NOT NULL
  ORDER BY (details->>'keyId')::int, id
)
UPDATE pc_torii_usage t SET username = k.username FROM k WHERE t.user_id IS NULL AND t.username IS NULL AND t.api_key_id = k.key_id;
WITH k AS (
  SELECT DISTINCT ON ((details->>'keyId')::int) (details->>'keyId')::int AS key_id, username
  FROM security_events
  WHERE type = 'api_key_created' AND details ? 'keyId' AND username IS NOT NULL
  ORDER BY (details->>'keyId')::int, id
)
UPDATE pc_llm_usage t SET username = k.username FROM k WHERE t.user_id IS NULL AND t.username IS NULL AND t.api_key_id = k.key_id;
WITH k AS (
  SELECT DISTINCT ON ((details->>'keyId')::int) (details->>'keyId')::int AS key_id, username
  FROM security_events
  WHERE type = 'api_key_created' AND details ? 'keyId' AND username IS NOT NULL
  ORDER BY (details->>'keyId')::int, id
)
UPDATE pc_text_usage t SET username = k.username FROM k WHERE t.user_id IS NULL AND t.username IS NULL AND t.api_key_id = k.key_id;
COMMIT;
