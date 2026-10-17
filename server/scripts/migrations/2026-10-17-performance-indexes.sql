-- Teljesítmény-indexek (2026-10-17 audit, 5. pont).
-- Csak új indexek: adatot nem módosít. CONCURRENTLY → élesben sem zárolja
-- a táblákat írásra; ezért NEM futhat tranzakcióban (psql -f-fel, egyenként
-- fut, BEGIN nélkül). Ha egy CONCURRENTLY index félbeszakad, "INVALID"
-- állapotban marad: DROP INDEX CONCURRENTLY <név>; majd újra lefuttatható.
--
-- Futtatás: psql -d padli -f server/scripts/migrations/2026-10-17-performance-indexes.sql

-- Fejezetlista megnyitásszámai (routes/manga.js /chapters): a meglévő
-- (user_id, manga_id, chapter) index user_id-vel kezdődik, mangára szűrve
-- nem használható → minden fejezetlistánál teljes táblaolvasás volt.
CREATE INDEX CONCURRENTLY IF NOT EXISTS chapter_reads_manga_chapter_idx
  ON chapter_reads (manga_id, chapter);

-- Belépés / regisztráció / jelszó-visszaállítás kis-/nagybetűtől független
-- keresése (lib/auth-security.js, routes.js, settings.js, patreon-sync.js)
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_lower_username_idx ON users (lower(username));
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_lower_email_idx    ON users (lower(email));

-- /api/online-count (utolsó 5 perc aktív userei)
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_last_seen_idx ON users (last_seen);

-- /api/new-releases (utolsó 7 nap fejezetei, minden kezdőlap-betöltésnél)
CREATE INDEX CONCURRENTLY IF NOT EXISTS chapter_scanned_at_idx ON chapter (scanned_at);

-- /api/chat/history (utolsó 50 üzenet)
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_messages_created_at_idx ON chat_messages (created_at DESC);

-- Feltöltő: manga keresése mappanév alapján (routes/uploader.js)
CREATE INDEX CONCURRENTLY IF NOT EXISTS manga_folder_idx ON manga (folder);

-- Címke → manga irányú join (Padli AI ajánló); a PK (manga_id, tag_id) csak
-- a másik irányt fedi
CREATE INDEX CONCURRENTLY IF NOT EXISTS manga_tag_tag_idx ON manga_tag (tag_id);

-- Egy user összes sessionjének törlése jelszócserénél (destroyUserSessions)
CREATE INDEX CONCURRENTLY IF NOT EXISTS session_user_id_idx ON session ((sess->'user'->>'id'));

-- Megjegyzés: a reading_progress és a want_to_read táblán a PRIMARY KEY
-- mellett egy azonos oszlopú UNIQUE megkötés is van (dupla index, dupla
-- írási költség). Ezt itt szándékosan nem töröljük — a megkötés nevének
-- ellenőrzése után kézzel érdemes: \d reading_progress
