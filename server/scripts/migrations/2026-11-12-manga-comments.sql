-- 2026-11-12: hozzászólások a manga-adatlapon (Részek / Hasonló művek / Hozzászólások fül)
CREATE TABLE IF NOT EXISTS manga_comments (
  id         BIGSERIAL PRIMARY KEY,
  manga_id   INT NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,   -- törölt fióknál „Törölt fiók”
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  spoiler    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at  TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by INT
);
CREATE INDEX IF NOT EXISTS manga_comments_manga_time ON manga_comments (manga_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS manga_comments_user ON manga_comments (user_id, created_at DESC);
