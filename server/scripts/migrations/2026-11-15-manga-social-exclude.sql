-- Közösségi posztokból (FB-ajánló, Instagram/TikTok részlet) kizárás (2026-11-15)
--   social_exclude: kézi kizárás oka (pl. magyarul hivatalosan megjelent), NULL = mehet
--   anilist_is_adult / anilist_gore / anilist_nudity: AniList 18+ jelző és a Gore/Nudity címke erőssége (0–100)
ALTER TABLE manga ADD COLUMN IF NOT EXISTS social_exclude text;
ALTER TABLE manga ADD COLUMN IF NOT EXISTS anilist_is_adult boolean;
ALTER TABLE manga ADD COLUMN IF NOT EXISTS anilist_gore integer;
ALTER TABLE manga ADD COLUMN IF NOT EXISTS anilist_nudity integer;
