/* ── Duplikált részek összevonása (2026-11-21) ──
   Egy műn belül ugyanaz a rész két néven: a „remove” sort megszüntetjük, minden
   hivatkozását (olvasás, napi statisztika, haladás, letöltés, hibajegy) a „keep”-re
   írjuk át, a fájljait (R2 + helyi) töröljük.
   kind:
     empty     — a „remove” mögött EGYETLEN fájl sincs (se R2, se helyi)
     identical — a „remove” fájljai név + méret (+ R2 ETag) szerint PONTOSAN egyeznek a „keep”-ével
     different — eltérő tartalom, a feltöltő döntése alapján („reason” kötelező); mentés készül
   Minden ellenőrzés közvetlenül a módosítás előtt fut; ha bármi nem stimmel, az
   adott tétel kimarad. Törlés előtt mentés: backups/dup-chapters/<dátum>/...
   Használat: node server/scripts/merge-duplicate-chapters.js <lista.json> [--apply]
     lista.json: [{ "slug": "...", "keep": "CH127", "remove": "Chapter 127", "kind": "identical" }, ...] */
import fs from "fs";
import path from "path";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { pool } from "../db.js";
import { r2, BUCKET, r2Fetch, localPathToR2Key } from "../r2.js";

const apply = process.argv.includes("--apply");
const listFile = process.argv.slice(2).find(a => !a.startsWith("--"));
if (!listFile) { console.error("Használat: merge-duplicate-chapters.js <lista.json> [--apply]"); process.exit(1); }
const items = JSON.parse(fs.readFileSync(listFile, "utf8"));
const BACKUP = path.resolve("backups/dup-chapters", new Date().toISOString().replace(/[:.]/g, "-"));

async function listR2(prefix) {
  const out = new Map(); out.etags = new Map(); let token;
  do {
    const r = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) { out.set(o.Key.slice(prefix.length), o.Size); out.etags.set(o.Key.slice(prefix.length), o.ETag); }
    token = r.NextContinuationToken;
  } while (token);
  return out;
}
function listLocal(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    out.set(e.isDirectory() ? e.name + "/" : e.name, e.isDirectory() ? -1 : fs.statSync(path.join(dir, e.name)).size);
  }
  return out;
}
async function describe(slug, folder) {
  const { rows } = await pool.query(
    `SELECT c.id, c.manga_id, c.folder, m.title, m.folder AS mf, m.r2_migrated, l.path AS lp
       FROM chapter c JOIN manga m ON m.id = c.manga_id JOIN library l ON l.id = c.library_id
      WHERE m.slug = $1 AND c.folder = $2`, [slug, folder]);
  if (rows.length !== 1) throw new Error(`„${folder}”: ${rows.length} DB-sor (1 kell)`);
  const c = rows[0];
  const localDir = path.join(c.lp, c.mf, c.folder);
  const r2Prefix = localPathToR2Key(`${c.lp}/${c.mf}/${c.folder}/`.replace(/\/+/g, "/"));
  return { ...c, localDir, r2Prefix, r2: await listR2(r2Prefix), local: listLocal(localDir) };
}
const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
const fmt = m => `${m.size} fájl`;

let failed = 0;
for (const it of items) {
  const tag = `${it.slug}: „${it.remove}” → „${it.keep}” (${it.kind})`;
  try {
    const keep = await describe(it.slug, it.keep);
    const rem = await describe(it.slug, it.remove);
    if (keep.manga_id !== rem.manga_id) throw new Error("a két rész más manga-sorhoz tartozik");
    if (keep.id === rem.id) throw new Error("ugyanaz a sor");
    const keepFiles = keep.r2.size ? keep.r2 : keep.local;
    if (!keepFiles.size) throw new Error("a megtartandó részben nincs fájl");
    if (it.kind === "empty") {
      if (rem.r2.size || rem.local.size) throw new Error(`a törlendőben van fájl (R2 ${fmt(rem.r2)}, helyi ${fmt(rem.local)})`);
    } else if (it.kind === "identical") {
      for (const [where, m] of [["R2", rem.r2], ["helyi", rem.local]]) {
        if (m.size && !same(m, keepFiles)) throw new Error(`a törlendő ${where} fájljai nem egyeznek a megtartandóéval`);
      }
      // Tartalom (MD5-ETag) egyezés is, ha mindkettő R2-n van
      if (rem.r2.size && keep.r2.size && ![...rem.r2.etags].every(([k, e]) => keep.r2.etags.get(k) === e))
        throw new Error("a törlendő R2-fájlok tartalma (ETag) eltér a megtartandóétól");
      if ([...rem.local.keys()].some(k => k.endsWith("/")) || [...rem.r2.keys()].some(k => k.includes("/")))
        throw new Error("a törlendőben almappa van");
    } else if (it.kind === "different") {
      // Eltérő tartalom, a feltöltő kifejezett döntése alapján (it.reason) — a régi mentésbe kerül
      if (!it.reason) throw new Error("different: kell reason (ki döntött)");
      if (!rem.r2.size && !rem.local.size) throw new Error("a törlendőben nincs fájl — ez empty, nem different");
      if ([...rem.local.keys()].some(k => k.endsWith("/")) || [...rem.r2.keys()].some(k => k.includes("/")))
        throw new Error("a törlendőben almappa van");
    } else throw new Error("ismeretlen kind");

    const refs = {};
    const q1 = (sql, p) => pool.query(sql, p).then(r => r.rows[0].n);
    refs.chapter_reads = await q1(`SELECT count(*)::int n FROM chapter_reads WHERE manga_id=$1 AND chapter=$2`, [rem.manga_id, rem.folder]);
    refs.daily_stats = await q1(`SELECT count(*)::int n FROM daily_stats WHERE manga_id=$1 AND chapter=$2`, [rem.manga_id, rem.folder]);
    refs.reading_progress = await q1(`SELECT count(*)::int n FROM reading_progress WHERE manga_id=$1 AND (chapter=$2 OR highest_chapter=$2)`, [rem.manga_id, rem.folder]);
    for (const t of ["app_downloads", "bug_fixes", "bug_reports", "chapter_bug_reports"])
      refs[t] = await q1(`SELECT count(*)::int n FROM ${t} WHERE manga_slug=$1 AND chapter=$2`, [it.slug, rem.folder]);
    const fixClash = await q1(
      `SELECT count(*)::int n FROM bug_fixes a JOIN bug_fixes b ON b.manga_slug=a.manga_slug AND b.image_index IS NOT DISTINCT FROM a.image_index
         AND b.fixed_by IS NOT DISTINCT FROM a.fixed_by WHERE a.manga_slug=$1 AND a.chapter=$2 AND b.chapter=$3`, [it.slug, rem.folder, keep.folder]);
    if (fixClash) throw new Error(`${fixClash} bug_fixes ütközés — kézzel kell rendezni`);
    console.log(`\n${tag}\n  megtartott: R2 ${fmt(keep.r2)}, helyi ${fmt(keep.local)} | törlendő: R2 ${fmt(rem.r2)}, helyi ${fmt(rem.local)}\n  hivatkozások: ${JSON.stringify(refs)}`);
    if (!apply) continue;

    // Mentés a törlendő fájlokról
    const bdir = path.join(BACKUP, it.slug, rem.folder.replace(/[\/\\]/g, "_"));
    if (rem.r2.size || rem.local.size) {
      fs.mkdirSync(path.join(bdir, "r2"), { recursive: true });
      fs.mkdirSync(path.join(bdir, "local"), { recursive: true });
      for (const [f, size] of rem.r2) {
        const res = await r2Fetch(rem.r2Prefix + f);
        if (!res.ok) throw new Error(`mentés: R2 ${res.status} ${f}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== size) throw new Error(`mentés: méret-eltérés ${f}`);
        fs.writeFileSync(path.join(bdir, "r2", f), buf);
      }
      for (const [f] of rem.local) fs.copyFileSync(path.join(rem.localDir, f), path.join(bdir, "local", f));
      fs.writeFileSync(path.join(bdir, "manifest.json"), JSON.stringify({ ...it, r2Prefix: rem.r2Prefix, localDir: rem.localDir, r2: [...rem.r2], local: [...rem.local] }, null, 1));
    }

    // DB egy tranzakcióban
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const p = [rem.manga_id, rem.folder, keep.folder];
      await db.query(`UPDATE chapter_reads SET chapter=$3 WHERE manga_id=$1 AND chapter=$2`, p);
      await db.query(`INSERT INTO daily_stats (stat_date, manga_id, chapter, read_count, unique_readers)
                        SELECT stat_date, manga_id, $3, read_count, unique_readers FROM daily_stats WHERE manga_id=$1 AND chapter=$2
                      ON CONFLICT (stat_date, manga_id, chapter) DO UPDATE
                        SET read_count = daily_stats.read_count + EXCLUDED.read_count,
                            unique_readers = GREATEST(daily_stats.unique_readers, EXCLUDED.unique_readers)`, p);
      await db.query(`DELETE FROM daily_stats WHERE manga_id=$1 AND chapter=$2`, p.slice(0, 2));
      await db.query(`UPDATE reading_progress SET chapter=$3 WHERE manga_id=$1 AND chapter=$2`, p);
      await db.query(`UPDATE reading_progress SET highest_chapter=$3 WHERE manga_id=$1 AND highest_chapter=$2`, p);
      for (const t of ["app_downloads", "bug_fixes", "bug_reports", "chapter_bug_reports"])
        await db.query(`UPDATE ${t} SET chapter=$3 WHERE manga_slug=$1 AND chapter=$2`, [it.slug, rem.folder, keep.folder]);
      const d = await db.query(`DELETE FROM chapter WHERE id=$1 AND folder=$2`, [rem.id, rem.folder]);
      if (d.rowCount !== 1) throw new Error("chapter DELETE nem 1 sor");
      await db.query(`INSERT INTO admin_delete_log (admin_username, target_type, target_id, target_title, details, created_at)
                      VALUES ('rendszer (duplikált rész összevonás)', 'chapter', $1, $2, $3, now())`,
        [rem.id, `${rem.title} / ${rem.folder}`, JSON.stringify({ ...it, refs, backup: rem.r2.size || rem.local.size ? bdir : null })]);
      await db.query("COMMIT");
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }

    // Fájlok törlése: csak a fent listázott, ellenőrzött fájlok
    if (rem.r2.size) {
      const keys = [...rem.r2.keys()].map(f => rem.r2Prefix + f);
      const r = await r2.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.map(Key => ({ Key })) } }));
      if (r.Errors?.length) throw new Error(`R2 törlés: ${r.Errors[0].Key} ${r.Errors[0].Message}`);
    }
    for (const [f] of rem.local) fs.unlinkSync(path.join(rem.localDir, f));
    if (fs.existsSync(rem.localDir) && !fs.readdirSync(rem.localDir).length) fs.rmdirSync(rem.localDir);
    const after = await describe(it.slug, keep.folder);
    console.log(`  ✔ kész — megtartott rész most: R2 ${fmt(after.r2)}, helyi ${fmt(after.local)}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${tag}: ${e.message}`);
  }
}
console.log(apply ? `\nKész, hibás: ${failed}` : `\nDRY-RUN — semmi nem változott (hibás: ${failed}). Élesítés: --apply`);
await pool.end();
process.exit(failed ? 2 : 0);
