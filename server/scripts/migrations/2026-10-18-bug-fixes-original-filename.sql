-- A szerkesztőből (/api/bug-reports/fix/upload) beküldött, még NEM
-- alkalmazott javításoknál az image_file mezőbe a staging-fájl neve
-- ("<index>_<userId>.jpg") került az eredeti oldal fájlneve helyett, így a
-- jóváhagyás új, plusz oldalt hozott volna létre. Ezeknél a soroknál a
-- képhez tartozó hibajegy fájlnevére javítjuk. Ismételten futtatható.
--
-- A MÁR alkalmazott ilyen javítások plusz fájlt hagytak a fejezetmappában
-- (pl. 0_65.jpg a 001.jpg mellett) — ezeket a lekérdezés a végén listázza,
-- kézi ellenőrzés után törölhetők; automatikusan nem nyúlunk hozzájuk.
--
-- Futtatás: psql -d padli -f server/scripts/migrations/2026-10-18-bug-fixes-original-filename.sql

UPDATE bug_fixes bf
SET image_file = (
  SELECT split_part(r.image_file, '?', 1) FROM bug_reports r
  WHERE r.manga_slug = bf.manga_slug AND r.chapter = bf.chapter
    AND r.image_index = bf.image_index AND r.image_file IS NOT NULL
  ORDER BY r.is_closed, r.id DESC
  LIMIT 1
)
WHERE bf.is_applied = false
  AND bf.image_file = bf.image_index || '_' || bf.fixed_by || '.jpg'
  AND EXISTS (SELECT 1 FROM bug_reports r
              WHERE r.manga_slug = bf.manga_slug AND r.chapter = bf.chapter
                AND r.image_index = bf.image_index AND r.image_file IS NOT NULL);

-- Már alkalmazott, hibás nevű javítások (kézi takarításhoz)
SELECT id, manga_slug, chapter, image_index, image_file, fixed_image_url AS written_to
FROM bug_fixes
WHERE is_applied = true
  AND image_file = image_index || '_' || fixed_by || '.jpg';
