#!/usr/bin/env node
/**
 * Meglévő kívánságlista-tételek kereszt-azonosítóval (mal_id, mangadex_id)
 * való feltöltése cím alapú kereséssel — hogy a duplikáció-ellenőrzés
 * (routes/wishlist.js POST /) forrás-függetlenül is felismerje, ha
 * ugyanazt a művet próbálják meg máshonnan (pl. MangaDex-ről) újra
 * felvenni, ami már AniList-ről fent van.
 *
 * Idempotens: csak a hiányzó (NULL) mezőket tölti ki, meglévő értéket
 * soha nem ír felül. Futtatható többször (pl. ha egy forrás most nem
 * elérhető, a legközelebbi futtatás pótolja).
 *
 * Futtatás: node server/scripts/backfill-wishlist-external-ids.js [--limit N]
 */
import "dotenv/config";
import { pool } from "../db.js";
import { searchMangaByTitle as searchJikan } from "../lib/jikan.js";
import { searchMangaByTitle as searchMangaDex } from "../lib/mangadex.js";
import { titlesMatch } from "../lib/title-match.js";

const DELAY_MS = 500;
const limitArg = process.argv.find(a => a.startsWith("--limit"));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1] || process.argv[process.argv.indexOf(limitArg) + 1], 10) : null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { rows } = await pool.query(`
    SELECT id, title, mal_id, mangadex_id
    FROM wishlist
    WHERE mal_id IS NULL OR mangadex_id IS NULL
    ORDER BY id
    ${LIMIT ? `LIMIT ${LIMIT}` : ""}
  `);

  console.log(`📋 ${rows.length} tétel ellenőrzése...\n`);

  let malFound = 0, mangadexFound = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    let malId = null;
    let mangadexId = null;

    if (row.mal_id == null) {
      try {
        const m = await searchJikan(row.title);
        const matchTitle = m?.title?.english || m?.title?.romaji;
        if (m && titlesMatch(row.title, matchTitle)) malId = m.id;
      } catch (err) {
        console.log(`  ⚠️ Jikan hiba (${row.title}): ${err.message}`);
        errors++;
      }
      await sleep(DELAY_MS);
    }

    if (row.mangadex_id == null) {
      try {
        const m = await searchMangaDex(row.title);
        const matchTitle = m?.title?.english || m?.title?.romaji;
        if (m && titlesMatch(row.title, matchTitle)) mangadexId = m.id;
      } catch (err) {
        console.log(`  ⚠️ MangaDex hiba (${row.title}): ${err.message}`);
        errors++;
      }
      await sleep(DELAY_MS);
    }

    if (malId || mangadexId) {
      await pool.query(
        `UPDATE wishlist SET mal_id = COALESCE(mal_id, $1), mangadex_id = COALESCE(mangadex_id, $2) WHERE id = $3`,
        [malId, mangadexId, row.id]
      );
      if (malId) malFound++;
      if (mangadexId) mangadexFound++;
      console.log(`✅ [${row.id}] ${row.title} → MAL:${malId ?? "-"} MangaDex:${mangadexId ?? "-"}`);
    } else {
      skipped++;
      console.log(`⏭️  [${row.id}] ${row.title} — nincs megbízható találat`);
    }
  }

  console.log(`\n🎉 Kész. MAL találat: ${malFound}, MangaDex találat: ${mangadexFound}, kihagyva: ${skipped}, hiba: ${errors}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
