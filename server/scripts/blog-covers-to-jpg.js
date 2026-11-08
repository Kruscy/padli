// server/scripts/blog-covers-to-jpg.js (2026-11-08)
// A meglévő blog-borítók (~3 MB-os PNG) → 1200 px JPEG az R2-n, majd a
// statikus oldalak újragenerálása. A régi URL-ek mentése a backups/-ba;
// a régi fájlokat nem töröljük.   node server/scripts/blog-covers-to-jpg.js [--dry-run]
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../../.env") });
const { pool } = await import("../db.js");
const { storeBlogCover } = await import("../lib/cover-image.js");
const { generateStaticPost } = await import("../blog-static-generator.js");

const DRY = process.argv.includes("--dry-run");
const SITE = (process.env.SITE_URL || "https://padlizsanfansub.hu").replace(/\/$/, "");
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
const { rows } = await pool.query(`SELECT slug, cover_url FROM blog_posts WHERE cover_url LIKE '/uploads/%' ORDER BY created_at`);
console.log(`${rows.length} blog-borító${DRY ? " (próbafuttatás)" : ""}`);
if (!DRY) {
  const dir = path.join(__dirname, "../../backups", `cover-webp-${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "old-blog-cover-urls.json");
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(rows, null, 1));
}
let before = 0, after = 0, ok = 0;
for (const p of rows) {
  try {
    const local = path.join(__dirname, "../..", p.cover_url);
    let buf;
    if (fs.existsSync(local)) buf = fs.readFileSync(local);
    else {
      let r = await fetch(`${R2_PUBLIC}${p.cover_url}`);
      if (!r.ok) r = await fetch(`${SITE}${p.cover_url}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    }
    before += buf.length;
    if (DRY) { ok++; continue; }
    const { url, bytes } = await storeBlogCover(buf, p.slug);
    if (!url.startsWith("http")) throw new Error("R2 nem elérhető");
    after += bytes;
    await pool.query("UPDATE blog_posts SET cover_url=$1 WHERE slug=$2 AND cover_url=$3", [url, p.slug, p.cover_url]);
    await generateStaticPost(p.slug);
    ok++;
  } catch (e) { console.log(`  HIBA ${p.slug}: ${e.message}`); }
}
console.log(`kész: ${ok}/${rows.length} — ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`);
await pool.end();
