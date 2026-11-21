/* ── Fejezet(ek) átnevezése (2026-11-21, Eleceed CHnnn → „nnn - Episode nnn”) ──
   Használat:
     node server/scripts/rename-chapters.js <slug> "RÉGI=>ÚJ" ["RÉGI=>ÚJ" ...]          (dry-run)
     node server/scripts/rename-chapters.js <slug> "RÉGI=>ÚJ" ... --apply
   Lépések fejezetenként:
     1. ellenőrzés: a régi megvan a DB-ben, az új név még nem foglalt (DB + R2)
     2. R2: minden objektum ÁTMÁSOLÁSA az új mappába, majd méret-egyezés ellenőrzése
        (a régi objektumokat NEM töröljük — azt külön, ellenőrzés után)
     3. DB, egy tranzakcióban: chapter.folder/title + minden hivatkozás
        (chapter_reads, daily_stats, reading_progress, app_downloads, bug_*).
   Csak R2-re költözött (r2_migrated) műre, helyi mappát nem kezel. */
import { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { pool } from "../db.js";
import { r2, BUCKET, localPathToR2Key } from "../r2.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [slug, ...pairsRaw] = args.filter(a => a !== "--apply");
const pairs = pairsRaw.map(p => p.split("=>").map(s => s.trim()));
if (!slug || !pairs.length || pairs.some(p => p.length !== 2 || !p[0] || !p[1] || /[\/\\]/.test(p[1]))) {
  console.error('Használat: rename-chapters.js <slug> "RÉGI=>ÚJ" ... [--apply]');
  process.exit(1);
}

async function listAll(prefix) {
  const out = []; let token;
  do {
    const r = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) out.push({ key: o.Key, size: o.Size });
    token = r.NextContinuationToken;
  } while (token);
  return out;
}

const encKey = k => k.split("/").map(encodeURIComponent).join("/");

let failed = 0;
for (const [oldName, newName] of pairs) {
  const tag = `${oldName} → ${newName}`;
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.manga_id, c.folder, c.library_id, m.folder AS mf, m.r2_migrated, l.path AS lp
         FROM chapter c JOIN manga m ON m.id = c.manga_id JOIN library l ON l.id = c.library_id
        WHERE m.slug = $1 AND c.folder = $2`, [slug, oldName]);
    if (rows.length !== 1) throw new Error(`a régi fejezet ${rows.length} sorban szerepel (1 kell)`);
    const ch = rows[0];
    if (!ch.r2_migrated) throw new Error("a mű nincs R2-n, ezt a szkript nem kezeli");
    const taken = await pool.query(
      `SELECT 1 FROM chapter c JOIN manga m ON m.id = c.manga_id WHERE m.slug = $1 AND c.folder = $2`, [slug, newName]);
    if (taken.rows.length) throw new Error("az új név már foglalt a DB-ben");

    const oldPrefix = localPathToR2Key(`${ch.lp}/${ch.mf}/${oldName}/`.replace(/\/+/g, "/"));
    const newPrefix = localPathToR2Key(`${ch.lp}/${ch.mf}/${newName}/`.replace(/\/+/g, "/"));
    const src = await listAll(oldPrefix);
    if (!src.length) throw new Error(`nincs fájl az R2-n: ${oldPrefix}`);
    const dst = await listAll(newPrefix);
    if (dst.length) throw new Error(`az új R2-mappa nem üres (${dst.length} fájl): ${newPrefix}`);
    const bytes = src.reduce((s, o) => s + o.size, 0);
    console.log(`\n${tag}: ${src.length} fájl, ${(bytes / 1048576).toFixed(1)} MB\n  ${oldPrefix}\n  → ${newPrefix}`);

    const refs = {};
    for (const [t, where] of [
      ["chapter_reads", "manga_id = $1 AND chapter = $2"],
      ["daily_stats", "manga_id = $1 AND chapter = $2"],
      ["reading_progress", "manga_id = $1 AND chapter = $2"],
      ["reading_progress#highest", "manga_id = $1 AND highest_chapter = $2"],
    ]) refs[t] = (await pool.query(`SELECT count(*)::int n FROM ${t.split("#")[0]} WHERE ${where}`, [ch.manga_id, oldName])).rows[0].n;
    for (const t of ["app_downloads", "bug_fixes", "bug_reports", "chapter_bug_reports"])
      refs[t] = (await pool.query(`SELECT count(*)::int n FROM ${t} WHERE manga_slug = $1 AND chapter = $2`, [slug, oldName])).rows[0].n;
    console.log("  DB-hivatkozások:", JSON.stringify(refs));
    if (!apply) continue;

    // 2. R2 másolás + ellenőrzés
    for (const o of src) {
      const newKey = newPrefix + o.key.slice(oldPrefix.length);
      await r2.send(new CopyObjectCommand({ Bucket: BUCKET, CopySource: `${BUCKET}/${encKey(o.key)}`, Key: newKey }));
      const h = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: newKey }));
      if (h.ContentLength !== o.size) throw new Error(`méret-eltérés: ${newKey} (${h.ContentLength} ≠ ${o.size})`);
    }
    const check = await listAll(newPrefix);
    if (check.length !== src.length) throw new Error(`másolás után ${check.length} fájl, ${src.length} kellene`);
    console.log(`  R2: ${check.length} fájl átmásolva, méretek egyeznek`);

    // 3. DB
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const u = await db.query(`UPDATE chapter SET folder = $1, title = $1, updated_at = now() WHERE id = $2 AND folder = $3`, [newName, ch.id, oldName]);
      if (u.rowCount !== 1) throw new Error("chapter UPDATE nem 1 sort érintett");
      await db.query(`UPDATE chapter_reads SET chapter = $3 WHERE manga_id = $1 AND chapter = $2`, [ch.manga_id, oldName, newName]);
      await db.query(`UPDATE daily_stats SET chapter = $3 WHERE manga_id = $1 AND chapter = $2`, [ch.manga_id, oldName, newName]);
      await db.query(`UPDATE reading_progress SET chapter = $3 WHERE manga_id = $1 AND chapter = $2`, [ch.manga_id, oldName, newName]);
      await db.query(`UPDATE reading_progress SET highest_chapter = $3 WHERE manga_id = $1 AND highest_chapter = $2`, [ch.manga_id, oldName, newName]);
      for (const t of ["app_downloads", "bug_fixes", "bug_reports", "chapter_bug_reports"])
        await db.query(`UPDATE ${t} SET chapter = $3 WHERE manga_slug = $1 AND chapter = $2`, [slug, oldName, newName]);
      await db.query("COMMIT");
      console.log("  DB frissítve (régi R2-fájlok megmaradtak)");
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  } catch (e) {
    failed++;
    console.error(`  ❌ ${tag}: ${e.message}`);
  }
}
console.log(apply ? `\nKész, hibás: ${failed}` : `\nDRY-RUN — semmi nem változott (hibás: ${failed}). Élesítés: --apply`);
await pool.end();
process.exit(failed ? 2 : 0);
