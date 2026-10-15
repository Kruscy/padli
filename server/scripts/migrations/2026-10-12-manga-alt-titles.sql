-- Művek alternatív nevei (AniList: romaji/angol/eredeti cím + synonyms) —
-- a feltöltő ezek alapján ismeri fel, ha egy művet más néven töltenének fel.
-- NULL = még nincs lekérdezve; üres tömb = lekérdezve, nincs több név.
-- Új, NULL-ozható oszlop, meglévő adatot nem érint.
ALTER TABLE manga ADD COLUMN IF NOT EXISTS alt_titles text[];
