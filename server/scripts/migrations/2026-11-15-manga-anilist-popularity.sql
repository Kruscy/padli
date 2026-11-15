-- AniList népszerűség (hányan vették fel a listájukra) a közösségi posztok mű-választásához (2026-11-15)
ALTER TABLE manga ADD COLUMN IF NOT EXISTS anilist_popularity integer;
