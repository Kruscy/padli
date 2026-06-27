-- PadlizsanFanSub – PostgreSQL séma
-- Futtatás: psql -U <user> -d <dbname> -f schema.sql

-- Szükséges extension-ök
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ─────────────────────────────────────────────
-- Trigger függvény: updated_at automatikus frissítés
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────
-- FELHASZNÁLÓK & AUTH
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
    id                          SERIAL PRIMARY KEY,
    username                    TEXT NOT NULL UNIQUE,
    email                       TEXT NOT NULL UNIQUE,
    password_hash               TEXT NOT NULL,
    role                        TEXT NOT NULL DEFAULT 'user',
    avatar                      TEXT,
    birth_date                  DATE,
    email_verified              BOOLEAN DEFAULT false,
    email_verification_token    TEXT,
    email_verification_expires  TIMESTAMPTZ,
    reset_token                 TEXT,
    reset_expires               TIMESTAMPTZ,
    last_seen                   TIMESTAMPTZ DEFAULT NOW(),
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    anilist_token               TEXT,
    anilist_connected           BOOLEAN DEFAULT false,
    stripe_customer_id          VARCHAR(100),
    verified_deadline           TIMESTAMPTZ,
    can_upload                  BOOLEAN NOT NULL DEFAULT false,
    upload_granted              BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.auth_accounts (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    provider_id TEXT,
    email       TEXT,
    password_hash TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (provider, email),
    UNIQUE (provider, provider_id)
);

-- Express session store
CREATE TABLE IF NOT EXISTS public.session (
    sid     VARCHAR NOT NULL PRIMARY KEY,
    sess    JSON NOT NULL,
    expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON public.session (expire);

-- ─────────────────────────────────────────────
-- KÖNYVTÁRAK & MANGA
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.library (
    id      SERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    path    TEXT NOT NULL UNIQUE,
    enabled BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.manga (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    slug            TEXT NOT NULL,
    library_id      INTEGER REFERENCES public.library(id) ON DELETE CASCADE,
    folder          TEXT,
    anilist_id      INTEGER,
    cover_url       TEXT,
    description     TEXT,
    status          TEXT,
    average_score   INTEGER,
    total_chapters  INTEGER,
    avg_rating      NUMERIC(3,1),
    rating_count    INTEGER DEFAULT 0,
    uploaders       TEXT[] DEFAULT '{}',
    r2_migrated     BOOLEAN NOT NULL DEFAULT false,
    anilist_failed  BOOLEAN DEFAULT false,
    anilist_last_try TIMESTAMPTZ,
    UNIQUE (slug, library_id)
);
CREATE INDEX IF NOT EXISTS idx_manga_library  ON public.manga (library_id);
CREATE INDEX IF NOT EXISTS idx_manga_anilist  ON public.manga (anilist_id);

CREATE TABLE IF NOT EXISTS public.chapter (
    id          SERIAL PRIMARY KEY,
    manga_id    INTEGER REFERENCES public.manga(id) ON DELETE CASCADE,
    library_id  INTEGER REFERENCES public.library(id) ON DELETE CASCADE,
    title       TEXT,
    folder      TEXT NOT NULL,
    scanned_at  TIMESTAMPTZ DEFAULT NOW(),
    unlocks_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ,
    UNIQUE (manga_id, folder)
);

CREATE TABLE IF NOT EXISTS public.genre (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.tag (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.manga_genre (
    manga_id INTEGER NOT NULL REFERENCES public.manga(id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES public.genre(id) ON DELETE CASCADE,
    PRIMARY KEY (manga_id, genre_id)
);
CREATE INDEX IF NOT EXISTS idx_manga_genre_genre ON public.manga_genre (genre_id);

CREATE TABLE IF NOT EXISTS public.manga_tag (
    manga_id INTEGER NOT NULL REFERENCES public.manga(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES public.tag(id) ON DELETE CASCADE,
    rank     INTEGER,
    PRIMARY KEY (manga_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.manga_rating (
    id         SERIAL PRIMARY KEY,
    manga_id   INTEGER REFERENCES public.manga(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (manga_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.recommendation (
    id          SERIAL PRIMARY KEY,
    manga_id    INTEGER REFERENCES public.manga(id) ON DELETE CASCADE,
    anilist_id  INTEGER NOT NULL,
    title       TEXT,
    cover_url   TEXT
);

-- ─────────────────────────────────────────────
-- OLVASÁS & HALADÁS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reading_progress (
    user_id    INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id   INTEGER NOT NULL REFERENCES public.manga(id) ON DELETE CASCADE,
    chapter    TEXT NOT NULL,
    page       INTEGER NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, manga_id),
    UNIQUE (user_id, manga_id)
);

CREATE TABLE IF NOT EXISTS public.chapter_reads (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id  INTEGER REFERENCES public.manga(id) ON DELETE CASCADE,
    chapter   TEXT NOT NULL,
    read_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chapter_reads_user_id_manga_id_chapter_idx ON public.chapter_reads (user_id, manga_id, chapter);
CREATE INDEX IF NOT EXISTS chapter_reads_read_at_idx ON public.chapter_reads (read_at);

CREATE TABLE IF NOT EXISTS public.daily_stats (
    id             SERIAL PRIMARY KEY,
    stat_date      DATE NOT NULL,
    manga_id       INTEGER REFERENCES public.manga(id) ON DELETE CASCADE,
    chapter        TEXT NOT NULL,
    read_count     INTEGER DEFAULT 0,
    unique_readers INTEGER DEFAULT 0,
    UNIQUE (stat_date, manga_id, chapter)
);
CREATE INDEX IF NOT EXISTS daily_stats_stat_date_idx ON public.daily_stats (stat_date);
CREATE INDEX IF NOT EXISTS daily_stats_manga_id_idx  ON public.daily_stats (manga_id);

CREATE TABLE IF NOT EXISTS public.favorites (
    user_id    INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id   INTEGER NOT NULL REFERENCES public.manga(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, manga_id)
);

CREATE TABLE IF NOT EXISTS public.want_to_read (
    user_id    INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manga_id   INTEGER NOT NULL REFERENCES public.manga(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, manga_id),
    UNIQUE (user_id, manga_id)
);

-- ─────────────────────────────────────────────
-- HIBAJELENTŐK
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bug_reports (
    id                  SERIAL PRIMARY KEY,
    provider            TEXT NOT NULL,
    manga_slug          TEXT NOT NULL,
    chapter             TEXT NOT NULL,
    image_file          TEXT NOT NULL,
    image_index         INTEGER,
    image_url           TEXT NOT NULL,
    user_id             INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    username            TEXT,
    description         TEXT NOT NULL,
    is_closed           BOOLEAN DEFAULT false,
    closed_at           TIMESTAMPTZ,
    closed_by           INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    close_reason        TEXT,
    closed_without_fix  BOOLEAN DEFAULT false,
    parent_report_id    INTEGER REFERENCES public.bug_reports(id) ON DELETE SET NULL,
    report_count        INTEGER DEFAULT 1,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bug_reports_manga_idx   ON public.bug_reports (manga_slug);
CREATE INDEX IF NOT EXISTS bug_reports_chapter_idx ON public.bug_reports (manga_slug, chapter);
CREATE INDEX IF NOT EXISTS bug_reports_image_idx   ON public.bug_reports (manga_slug, chapter, image_index);
CREATE INDEX IF NOT EXISTS bug_reports_closed_idx  ON public.bug_reports (is_closed);
CREATE INDEX IF NOT EXISTS idx_bug_reports_parent  ON public.bug_reports (parent_report_id);

CREATE TABLE IF NOT EXISTS public.bug_report_comments (
    id            SERIAL PRIMARY KEY,
    bug_report_id INTEGER REFERENCES public.bug_reports(id),
    user_id       INTEGER REFERENCES public.users(id),
    comment       TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bug_comments_report ON public.bug_report_comments (bug_report_id);
CREATE INDEX IF NOT EXISTS idx_bug_comments_user   ON public.bug_report_comments (user_id);

CREATE TABLE IF NOT EXISTS public.bug_fixes (
    id              SERIAL PRIMARY KEY,
    provider        TEXT NOT NULL,
    manga_slug      TEXT NOT NULL,
    chapter         TEXT NOT NULL,
    image_index     INTEGER NOT NULL,
    image_file      TEXT NOT NULL,
    fixed_image_url TEXT,
    fixed_by        INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    fixed_by_name   TEXT,
    fixed_at        TIMESTAMPTZ DEFAULT NOW(),
    likes           INTEGER DEFAULT 0,
    dislikes        INTEGER DEFAULT 0,
    is_applied      BOOLEAN DEFAULT false,
    award_points    BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (manga_slug, chapter, image_index, fixed_by)
);
CREATE INDEX IF NOT EXISTS bug_fixes_image_idx ON public.bug_fixes (manga_slug, chapter, image_index);

CREATE TABLE IF NOT EXISTS public.bug_fix_votes (
    id         SERIAL PRIMARY KEY,
    fix_id     INTEGER REFERENCES public.bug_fixes(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    vote       SMALLINT NOT NULL CHECK (vote = ANY(ARRAY[1, -1])),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (fix_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chapter_bug_reports (
    id               SERIAL PRIMARY KEY,
    manga_slug       TEXT NOT NULL,
    chapter          TEXT NOT NULL,
    provider         TEXT,
    type             TEXT NOT NULL CHECK (type = ANY(ARRAY['english_remained','wrong_chapter','other'])),
    description      TEXT,
    manga_title      TEXT,
    reported_by      INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    reported_by_name TEXT,
    is_fixed         BOOLEAN DEFAULT false,
    fixed_by         INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    fixed_at         TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chapter_bug_reports_slug_ch ON public.chapter_bug_reports (manga_slug, chapter);

-- ─────────────────────────────────────────────
-- PONTOK & TOPLISTÁK
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_points (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES public.users(id),
    fix_id      INTEGER REFERENCES public.bug_fixes(id),
    points      INTEGER DEFAULT 1,
    approved_by INTEGER REFERENCES public.users(id),
    earned_at   TIMESTAMPTZ DEFAULT NOW(),
    spent       BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_user_points_user ON public.user_points (user_id);
CREATE INDEX IF NOT EXISTS idx_user_points_fix  ON public.user_points (fix_id);

-- ─────────────────────────────────────────────
-- KÖZÖSSÉG
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.announcements (
    id         SERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    image_url  TEXT,
    created_by INTEGER REFERENCES public.users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.polls (
    id         SERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    created_by INTEGER REFERENCES public.users(id),
    ends_at    TIMESTAMPTZ NOT NULL,
    active     BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.poll_options (
    id        SERIAL PRIMARY KEY,
    poll_id   INTEGER REFERENCES public.polls(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    image_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id ON public.poll_options (poll_id);

CREATE TABLE IF NOT EXISTS public.poll_votes (
    id        SERIAL PRIMARY KEY,
    poll_id   INTEGER REFERENCES public.polls(id) ON DELETE CASCADE,
    option_id INTEGER REFERENCES public.poll_options(id) ON DELETE CASCADE,
    user_id   INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    voted_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (poll_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON public.poll_votes (poll_id);

CREATE TABLE IF NOT EXISTS public.notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type       VARCHAR(50) NOT NULL,
    message    TEXT NOT NULL,
    link       TEXT,
    is_read    BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications (user_id, is_read);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id         SERIAL PRIMARY KEY,
    source     TEXT NOT NULL,
    author     TEXT NOT NULL,
    author_id  INTEGER,
    avatar     TEXT,
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- WISHLIST
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wishlist (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    anilist_id INTEGER NOT NULL,
    title      TEXT NOT NULL,
    cover_url  TEXT,
    episodes   INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wishlist_likes (
    id          SERIAL PRIMARY KEY,
    wishlist_id INTEGER REFERENCES public.wishlist(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (wishlist_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.wishlist_claims (
    id          SERIAL PRIMARY KEY,
    wishlist_id INTEGER REFERENCES public.wishlist(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    UNIQUE (wishlist_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.wishlist_planned (
    id          SERIAL PRIMARY KEY,
    wishlist_id INTEGER NOT NULL REFERENCES public.wishlist(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (wishlist_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_planned_wishlist ON public.wishlist_planned (wishlist_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_planned_user     ON public.wishlist_planned (user_id);

-- ─────────────────────────────────────────────
-- BLOG
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blog_posts (
    id         SERIAL PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    excerpt    TEXT,
    content    TEXT,
    cover_url  TEXT,
    category   TEXT DEFAULT 'hir',
    tags       TEXT[],
    author     TEXT,
    published  BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS blog_slug_idx ON public.blog_posts (slug);
CREATE INDEX IF NOT EXISTS blog_pub_idx  ON public.blog_posts (published, created_at DESC);
CREATE INDEX IF NOT EXISTS blog_cat_idx  ON public.blog_posts (category);

-- ─────────────────────────────────────────────
-- PATREON & SHOP
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patreon_status (
    patreon_user_id         TEXT NOT NULL PRIMARY KEY,
    user_id                 INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    tier                    TEXT,
    active                  BOOLEAN DEFAULT false,
    last_sync               TIMESTAMPTZ,
    access_token            TEXT,
    uploader_root           VARCHAR(500),
    stripe_subscription_id  VARCHAR(100),
    stripe_period_end       TIMESTAMPTZ,
    payment_source          VARCHAR(20) DEFAULT 'patreon',
    UNIQUE (patreon_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patreon_status_user_id ON public.patreon_status (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.patreon_gifts (
    id              SERIAL PRIMARY KEY,
    gift_code       VARCHAR(100) NOT NULL UNIQUE,
    patreon_link    TEXT NOT NULL,
    duration_months INTEGER DEFAULT 1,
    cost_points     INTEGER DEFAULT 100,
    status          VARCHAR(20) DEFAULT 'available',
    purchased_by    INTEGER REFERENCES public.users(id),
    purchased_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patreon_gifts_status       ON public.patreon_gifts (status);
CREATE INDEX IF NOT EXISTS idx_patreon_gifts_purchased_by ON public.patreon_gifts (purchased_by);

CREATE TABLE IF NOT EXISTS public.shop_orders (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER REFERENCES public.users(id),
    stripe_session_id TEXT UNIQUE,
    package_id        TEXT,
    points            INTEGER,
    amount_huf        INTEGER,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- ANILIST SZINKRON
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anilist_queue (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER,
    anilist_id INTEGER,
    progress   INTEGER,
    processed  BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- FELTÖLTŐK
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.uploader_names (
    id        SERIAL PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    root_path VARCHAR(500)
);

-- ─────────────────────────────────────────────
-- PADLI AI
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.padli_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    label       TEXT,
    description TEXT,
    category    TEXT DEFAULT 'general',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.padli_characters (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    personality TEXT,
    active      BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.padli_stories (
    id           SERIAL PRIMARY KEY,
    character_id INTEGER REFERENCES public.padli_characters(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    content      TEXT NOT NULL,
    active       BOOLEAN DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.padli_replies (
    id         SERIAL PRIMARY KEY,
    type       TEXT NOT NULL,
    text       TEXT NOT NULL,
    active     BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.padli_aliases (
    id         SERIAL PRIMARY KEY,
    alias      TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    note       TEXT,
    active     BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_padli_aliases_alias  ON public.padli_aliases (alias);
CREATE INDEX IF NOT EXISTS idx_padli_aliases_active ON public.padli_aliases (active) WHERE active = true;

CREATE TABLE IF NOT EXISTS public.padli_genre_words (
    genre_name TEXT PRIMARY KEY,
    words      TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.padli_tag_words (
    id         SERIAL PRIMARY KEY,
    tag_name   TEXT NOT NULL UNIQUE,
    words      TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.padli_activations (
    id                 SERIAL PRIMARY KEY,
    email              VARCHAR(255) NOT NULL UNIQUE,
    patreon_user_id    VARCHAR(100),
    activation_key     VARCHAR(64) NOT NULL,
    is_premium         BOOLEAN DEFAULT false,
    device_fingerprint VARCHAR(255),
    activated_at       TIMESTAMPTZ DEFAULT NOW(),
    last_verified      TIMESTAMPTZ DEFAULT NOW(),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_padli_email        ON public.padli_activations (email);
CREATE INDEX IF NOT EXISTS idx_padli_patreon_user ON public.padli_activations (patreon_user_id);

CREATE TABLE IF NOT EXISTS public.padli_usage_stats (
    id                SERIAL PRIMARY KEY,
    email             VARCHAR(255) NOT NULL,
    date              DATE NOT NULL,
    folders_processed INTEGER DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (email, date)
);

-- ─────────────────────────────────────────────
-- FANSUB AI GENERÁTOR
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fansub_characters (
    id                 SERIAL PRIMARY KEY,
    name               TEXT NOT NULL,
    visual_description TEXT NOT NULL,
    active             BOOLEAN DEFAULT true,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fansub_setting (
    id          INTEGER DEFAULT 1 PRIMARY KEY,
    description TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TRIGGEREK
-- ─────────────────────────────────────────────

CREATE TRIGGER update_padli_activations_updated_at
  BEFORE UPDATE ON public.padli_activations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────
-- NÉZET: Padli prémium felhasználók
-- ─────────────────────────────────────────────

CREATE OR REPLACE VIEW public.padli_premium_users AS
SELECT
    pa.email,
    pa.activation_key,
    pa.activated_at,
    ps.active AS patreon_active,
    ps.tier AS patreon_tier,
    ps.last_sync AS patreon_last_sync,
    CASE
        WHEN ps.active = true THEN true
        WHEN u.role = 'admin'  THEN true
        ELSE false
    END AS is_premium
FROM public.padli_activations pa
LEFT JOIN public.patreon_status ps ON pa.patreon_user_id = ps.patreon_user_id
LEFT JOIN public.users u ON ps.user_id = u.id;
