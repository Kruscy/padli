// Alternatív címek pótlása a MangaUpdates-ből azoknál a műveknél, amiknek
// egy sincs (alt_titles NULL vagy üres) — ezeknél a mangalapon nem jelenne
// meg semmi, és a feltöltői duplikátum-ellenőrzés is gyengébb.
//
// Futtatás: node server/scripts/backfill-alt-titles-mu.js          (próbafuttatás, nem ír)
//           node server/scripts/backfill-alt-titles-mu.js --apply  (beírja)
import "dotenv/config";
import { pool } from "../db.js";
import { searchSeriesByTitle } from "../lib/mangaupdates.js";
import { mergeAltTitles } from "../lib/manga-duplicates.js";

const APPLY = process.argv.includes("--apply");
const DELAY_MS = 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanTitle(title) {
  return title
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[-_]/g, " ")
    .trim();
}

async function main() {
  const { rows } = await pool.query(`
    SELECT id, title, slug, metadata_source
    FROM manga
    WHERE alt_titles IS NULL OR cardinality(alt_titles) = 0
    ORDER BY id`);
  console.log(`${APPLY ? "ÍRÁS" : "PRÓBAFUTTATÁS"} — ${rows.length} mű alternatív cím nélkül\n`);

  let found = 0, missing = 0, failed = 0;
  for (const m of rows) {
    try {
      const mu = await searchSeriesByTitle(cleanTitle(m.title));
      if (!mu) {
        missing++;
        console.log(`– #${m.id} ${m.title}: nincs pontos találat`);
      } else {
        found++;
        const names = mu.altTitles.filter(n => n !== m.title);
        console.log(`✓ #${m.id} ${m.title} → MU ${mu.id} "${mu.title.romaji}" (${names.length} név)`);
        console.log(`    ${names.join(" · ") || "(csak a fő cím)"}`);
        if (APPLY) await mergeAltTitles(m.id, mu.altTitles);
      }
    } catch (err) {
      failed++;
      console.log(`⚠ #${m.id} ${m.title}: hiba — ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nTalálat: ${found}, nincs: ${missing}, hiba: ${failed}${APPLY ? "" : " — semmi nem lett beírva"}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
