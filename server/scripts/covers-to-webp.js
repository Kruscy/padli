// server/scripts/covers-to-webp.js (2026-11-08)
// A feltöltött (uploads/, PNG/JPG, akár 3 MB) és a külső oldalakra
// hivatkozó borítók átalakítása WebP-re + R2-re töltése, hogy a böngésző
// közvetlenül az R2-ről kapja (nem a szerverünkön keresztül), kis méretben.
// Az AniList-borítókat nem bántjuk (az AniList CDN-je szolgálja ki).
// A régi URL-ek mentése: backups/cover-webp-<dátum>/old-cover-urls.json
// A régi fájlokat NEM töröljük → visszaállítható.
//
//   node server/scripts/covers-to-webp.js --dry-run
//   node server/scripts/covers-to-webp.js
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../../.env") });

const { pool } = await import("../db.js");
const { storeCover } = await import("../lib/cover-image.js");

const DRY = process.argv.includes("--dry-run");
const SITE = (process.env.SITE_URL || "https://padlizsanfansub.hu").replace(/\/$/, "");
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

const { rows } = await pool.query(`
  SELECT id, slug, title, cover_url FROM manga
   WHERE cover_url IS NOT NULL AND cover_url <> ''
     AND cover_url NOT LIKE $1 AND cover_url NOT ILIKE '%anilist%'
   ORDER BY id`, [R2_PUBLIC + "/%"]);

console.log(`${rows.length} borító átalakítandó${DRY ? " (próbafuttatás)" : ""}`);

const backupDir = path.join(__dirname, "../../backups", `cover-webp-${new Date().toISOString().slice(0, 10)}`);
if (!DRY) {
  fs.mkdirSync(backupDir, { recursive: true });
  const f = path.join(backupDir, "old-cover-urls.json");
  // ha már van mentés (újrafuttatás), nem írjuk felül az eredetit
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(rows.map(r => ({ id: r.id, cover_url: r.cover_url })), null, 1));
}

async function fetchBuf(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 PadliCoverBot" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

let ok = 0, fail = 0, before = 0, after = 0;
for (const m of rows) {
  try {
    let buf;
    if (m.cover_url.startsWith("/uploads/")) {
      const local = path.join(__dirname, "../..", m.cover_url);
      if (fs.existsSync(local)) buf = fs.readFileSync(local);
      else {
        // a migrate-to-r2.js már felvitte (uploads/<név> kulcs), helyben nincs meg
        try { buf = await fetchBuf(`${R2_PUBLIC}${m.cover_url}`); }
        catch { buf = await fetchBuf(`${SITE}${m.cover_url}`); }
      }
    } else {
      buf = await fetchBuf(m.cover_url);
    }
    before += buf.length;
    if (DRY) {
      const { coverToWebp } = await import("../lib/cover-image.js");
      const w = await coverToWebp(buf);
      after += w.length;
      ok++;
      continue;
    }
    const { url, bytes } = await storeCover(buf, m.slug || String(m.id));
    if (!url.startsWith("http")) throw new Error("R2-feltöltés nem sikerült (helyi mentés lett) — kihagyva");
    after += bytes;
    // csak akkor írjuk át, ha közben senki nem cserélte le
    const u = await pool.query("UPDATE manga SET cover_url=$1 WHERE id=$2 AND cover_url=$3", [url, m.id, m.cover_url]);
    if (u.rowCount) ok++; else console.log(`  közben módosult, kihagyva: ${m.title}`);
  } catch (err) {
    fail++;
    console.log(`  HIBA ${m.title} (${m.cover_url}): ${err.message}`);
  }
}
console.log(`kész: ${ok} OK, ${fail} hiba — ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`);
await pool.end();
