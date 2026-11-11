/* ── Javítás feltöltése egy már fent lévő részhez (2026-11-11) ──────────
   Ha a feltöltő egy olyan részt tölt fel, ami már fent van az oldalon
   (ugyanaz a mű és ugyanaz a rész-mappanév), rákérdezünk, hogy javítás-e.
   Ha igen, a képek előbb egy átmeneti (staging) mappába mennek, és amikor
   a rész minden képe felért, a régi képeket LECSERÉLJÜK az újakra — azokat
   is töröljük, amelyeknek más a fájlneve (különben a régi és az új oldalak
   keverednének, mert az olvasó a mappa összes képét mutatja).

   Biztonság (lásd az R2-migrációs törlési incidenseket):
   - csak a saját könyvtárában lévő vagy a fordítóként megjelölt mű része;
   - csere előtt a régi képekről mentés: backups/chapter-fix/... (helyi + R2);
   - először az új képek íródnak ki (R2-re is), csak utána törlünk régit;
   - törölni csak a közvetlenül a csere előtt listázott, a fejezet saját
     mappájában lévő, NEM új nevű képfájlt szabad;
   - hiba esetén visszaállítás a mentésből.
   ───────────────────────────────────────────────────────────────────── */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { pool } from "../db.js";
import { r2, BUCKET, r2Fetch, listFiles, localPathToR2Key } from "../r2.js";
import { purgeChapterImages } from "./cf-purge.js";

export const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|avif)$/i;
const READER_IMAGE_RE = /\.(jpg|jpeg|png|webp)$/i; // ezeket listázza az olvasó
const STAGING_DIR = path.resolve("fix-staging");
const BACKUP_DIR = path.resolve("backups/chapter-fix");
const TOKEN_TTL = 24 * 3600e3;

const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const CONTENT_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };

/* A rész, ahogy az olvasó látja (routes/manga.js: az első jelölt, amelyiknél
   van kép). Több képes jelöltnél (duplikált manga-sor) nem döntünk helyette. */
export async function resolveChapterTarget(mangaFolder, chapterFolder) {
  const slug = slugify(mangaFolder);
  if (!slug || !chapterFolder) return null;
  const { rows } = await pool.query(
    `SELECT m.id AS manga_id, m.slug, m.title, m.folder AS manga_folder, m.uploaders, m.r2_migrated,
            c.id AS chapter_id, c.folder AS chapter_folder,
            l.id AS library_id, l.name AS library_name, l.path AS library_path
     FROM chapter c
     JOIN manga m ON m.id = c.manga_id
     JOIN library l ON l.id = c.library_id
     WHERE m.slug = $1 AND c.folder = $2
     ORDER BY c.id`,
    [slug, chapterFolder]
  );
  const withFiles = [];
  for (const r of rows) {
    const t = await describeTarget(r);
    if (t.currentPages.length) withFiles.push(t);
  }
  if (withFiles.length > 1) return { ambiguous: true, title: rows[0].title };
  return withFiles[0] || null;
}

async function describeTarget(r) {
  const localDir = path.join(r.library_path, r.manga_folder, r.chapter_folder);
  const localFiles = fs.existsSync(localDir)
    ? fs.readdirSync(localDir, { withFileTypes: true }).filter(e => e.isFile() && IMAGE_RE.test(e.name)).map(e => e.name)
    : [];
  let r2Prefix = null, r2Files = [];
  if (r.r2_migrated) {
    r2Prefix = localPathToR2Key(`${r.library_path}/${r.manga_folder}/${r.chapter_folder}/`.replace(/\/+/g, "/"));
    r2Files = (await listFiles(r2Prefix)).filter(f => IMAGE_RE.test(f));
  }
  // Ugyanaz a logika, mint az olvasóban
  let currentPages = r.r2_migrated ? r2Files.filter(f => READER_IMAGE_RE.test(f)) : [];
  if (!currentPages.length) currentPages = localFiles.filter(f => READER_IMAGE_RE.test(f));
  return { ...r, localDir, localExists: fs.existsSync(localDir), localFiles, r2Prefix, r2Files, currentPages };
}

/* ── Staging-tokenek ─────────────────────────────────────────────── */
function tokenDir(token) {
  if (!/^[a-f0-9]{32}$/.test(String(token))) return null;
  return path.join(STAGING_DIR, token);
}

// Az olvasó is így rendez: a fájlnév UTOLSÓ száma az oldalszám (routes/manga.js)
export function extractPageNumber(filename) {
  const m = String(filename).replace(/\.[^.]+$/, "").match(/(\d+)(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}

/* mode: "full"  — a teljes rész cseréje: minden régi kép törlődik, ami nincs az újak között;
         "pages" — csak a feltöltött oldalak cseréje: a régiek közül az azonos nevű
                   ÉS az azonos oldalszámú (más nevű) képek cserélődnek, a többi marad. */
export function createFixToken({ userId, mangaFolder, chapterFolder, chapterId, mode }) {
  const token = crypto.randomBytes(16).toString("hex");
  const dir = tokenDir(token);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".meta.json"),
    JSON.stringify({ userId, mangaFolder, chapterFolder, chapterId, mode: mode === "pages" ? "pages" : "full", createdAt: Date.now() }));
  return token;
}

export function loadFixToken(token, userId) {
  const dir = tokenDir(token);
  if (!dir) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, ".meta.json"), "utf8"));
    if (meta.userId !== userId || Date.now() - meta.createdAt > TOKEN_TTL) return null;
    return { ...meta, dir };
  } catch { return null; }
}

export function stagedFilePath(fix, filename) {
  const name = path.basename(String(filename || ""));
  if (!name || name.startsWith(".") || name !== filename || !IMAGE_RE.test(name)) return null;
  return path.join(fix.dir, name);
}

function removeStaging(dir) {
  // Csak a staging-mappán belüli, token-alakú mappát töröljük
  if (path.dirname(dir) !== STAGING_DIR || !/^[a-f0-9]{32}$/.test(path.basename(dir))) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

// Elhagyott (24 óránál régebbi) staging-mappák takarítása
export function cleanupStaging() {
  if (!fs.existsSync(STAGING_DIR)) return;
  for (const e of fs.readdirSync(STAGING_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^[a-f0-9]{32}$/.test(e.name)) continue;
    const dir = path.join(STAGING_DIR, e.name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > TOKEN_TTL) removeStaging(dir);
    } catch {}
  }
}

/* ── A csere ─────────────────────────────────────────────────────── */
const committing = new Set();

async function r2Put(key, buffer, name) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer,
    ContentType: CONTENT_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream",
  }));
}

async function r2Delete(keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    const res = await r2.send(new DeleteObjectsCommand({
      Bucket: BUCKET, Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })) },
    }));
    if (res.Errors?.length) throw new Error(`R2 törlési hiba: ${res.Errors[0].Key} ${res.Errors[0].Message}`);
  }
}

/* checkAccess(target) → true, ha a felhasználó javíthatja a részt.
   Visszaad: { replaced, added, removed, pages, backup, title, chapter } */
export async function commitFix(fix, { checkAccess }) {
  const staged = fs.readdirSync(fix.dir).filter(n => !n.startsWith(".") && IMAGE_RE.test(n));
  if (!staged.length) throw Object.assign(new Error("A javításhoz nem érkezett kép"), { status: 400 });

  const target = await resolveChapterTarget(fix.mangaFolder, fix.chapterFolder);
  if (!target) throw Object.assign(new Error("A rész már nincs fent az oldalon"), { status: 404 });
  if (target.ambiguous) throw Object.assign(new Error("A rész több helyen is fent van — szólj egy adminnak"), { status: 409 });
  if (target.chapter_id !== fix.chapterId) throw Object.assign(new Error("A rész időközben megváltozott, kezdd újra a feltöltést"), { status: 409 });
  if (!(await checkAccess(target))) throw Object.assign(new Error("Ehhez a részhez nincs jogod javítást feltölteni"), { status: 403 });

  const lockKey = String(target.chapter_id);
  if (committing.has(lockKey)) throw Object.assign(new Error("Erre a részre már fut egy csere"), { status: 409 });
  committing.add(lockKey);
  try {
    return await doCommit(fix, target, staged);
  } finally {
    committing.delete(lockKey);
  }
}

async function doCommit(fix, target, staged) {
  const useLocal = target.localExists || !target.r2_migrated;
  const useR2 = !!target.r2_migrated;
  const newSet = new Set(staged);
  const mode = fix.mode === "pages" ? "pages" : "full";
  const newPageNums = new Set(staged.map(extractPageNumber).filter(n => n !== null));
  // Törölhető-e egy régi (a mentésben is meglévő), nem új nevű kép
  const shouldRemove = f => mode === "full" || (extractPageNumber(f) !== null && newPageNums.has(extractPageNumber(f)));

  // 1) Mentés a régi képekről (helyi + R2), ellenőrzött méretekkel
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(BACKUP_DIR, `${target.slug}__${slugify(target.chapter_folder) || "resz"}__${stamp}`);
  fs.mkdirSync(path.join(backup, "local"), { recursive: true });
  fs.mkdirSync(path.join(backup, "r2"), { recursive: true });
  for (const f of target.localFiles) {
    fs.copyFileSync(path.join(target.localDir, f), path.join(backup, "local", f));
  }
  for (const f of target.r2Files) {
    const res = await r2Fetch(target.r2Prefix + f);
    if (!res.ok) throw new Error(`Mentés sikertelen (R2 ${res.status}): ${f}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error(`Mentés sikertelen (üres R2 fájl): ${f}`);
    fs.writeFileSync(path.join(backup, "r2", f), buf);
  }
  fs.writeFileSync(path.join(backup, "manifest.json"), JSON.stringify({
    at: new Date().toISOString(), userId: fix.userId, mangaId: target.manga_id, slug: target.slug,
    chapterId: target.chapter_id, chapter: target.chapter_folder, library: target.library_name,
    localDir: useLocal ? target.localDir : null, r2Prefix: target.r2Prefix,
    mode, oldLocal: target.localFiles, oldR2: target.r2Files, newFiles: staged,
  }, null, 2));

  // 2) Új képek kiírása (felülírás a mentett régire) — törlés még semmi
  const writtenLocal = [], writtenR2 = [];
  try {
    if (useLocal) fs.mkdirSync(target.localDir, { recursive: true });
    for (const f of staged) {
      const buf = fs.readFileSync(path.join(fix.dir, f));
      if (useLocal) {
        fs.writeFileSync(path.join(target.localDir, f), buf);
        writtenLocal.push(f);
      }
      if (useR2) {
        await r2Put(target.r2Prefix + f, buf, f);
        writtenR2.push(f);
      }
    }
    // Ellenőrzés: minden új kép ott van
    if (useLocal) {
      for (const f of staged) {
        if (!fs.existsSync(path.join(target.localDir, f))) throw new Error(`Kiírás ellenőrzése sikertelen: ${f}`);
      }
    }
    if (useR2) {
      const nowOnR2 = new Set(await listFiles(target.r2Prefix));
      const missing = staged.filter(f => !nowOnR2.has(f));
      if (missing.length) throw new Error(`R2 feltöltés ellenőrzése sikertelen: ${missing.slice(0, 3).join(", ")}`);
    }
  } catch (err) {
    await rollback(target, backup, writtenLocal, writtenR2).catch(e => console.error("[javítás] visszaállítási hiba:", e.message));
    throw err;
  }

  // 3) Régi, más nevű képek törlése — a közvetlenül most listázott tartalomból
  const removedLocal = [], removedR2 = [];
  if (useLocal && fs.existsSync(target.localDir)) {
    const nowLocal = fs.readdirSync(target.localDir, { withFileTypes: true })
      .filter(e => e.isFile() && IMAGE_RE.test(e.name)).map(e => e.name);
    for (const f of nowLocal) {
      // csak ami a mentésben is megvan (tehát a csere előtt is ott volt)
      if (newSet.has(f) || !shouldRemove(f) || !fs.existsSync(path.join(backup, "local", f))) continue;
      fs.unlinkSync(path.join(target.localDir, f));
      removedLocal.push(f);
    }
  }
  if (useR2) {
    const nowR2 = (await listFiles(target.r2Prefix)).filter(f => IMAGE_RE.test(f));
    const toDelete = nowR2.filter(f => !newSet.has(f) && shouldRemove(f) && fs.existsSync(path.join(backup, "r2", f)));
    if (toDelete.length) {
      await r2Delete(toDelete.map(f => target.r2Prefix + f));
      removedR2.push(...toDelete);
    }
  }

  // 4) Cloudflare-gyorsítótár: a régi és az új nevek is
  const allNames = [...new Set([...target.currentPages, ...staged])];
  purgeChapterImages({
    libraryName: target.library_name, libraryPath: target.library_path, mangaSlug: target.slug,
    mangaFolder: target.manga_folder, chapterFolder: target.chapter_folder, files: allNames,
  }).catch(err => console.warn("[javítás] CF purge hiba:", err.message));

  removeStaging(fix.dir);

  const oldSet = new Set(target.currentPages);
  const removedSet = new Set([...removedLocal, ...removedR2]);
  return {
    mode,
    pagesAfter: mode === "full" ? staged.length
      : new Set([...target.currentPages.filter(f => !removedSet.has(f)), ...staged.filter(f => READER_IMAGE_RE.test(f))]).size,
    title: target.title,
    chapter: target.chapter_folder,
    library: target.library_name,
    mangaId: target.manga_id,
    chapterId: target.chapter_id,
    pages: staged.length,
    oldPages: target.currentPages.length,
    replaced: staged.filter(f => oldSet.has(f)).length,
    added: staged.filter(f => !oldSet.has(f)).length,
    removed: [...new Set([...removedLocal, ...removedR2])].length,
    backup: path.relative(process.cwd(), backup),
  };
}

// Hiba a kiírás közben: a felülírt régi képek vissza a mentésből, az új nevűek törlése
async function rollback(target, backup, writtenLocal, writtenR2) {
  for (const f of writtenLocal) {
    const saved = path.join(backup, "local", f);
    if (fs.existsSync(saved)) fs.copyFileSync(saved, path.join(target.localDir, f));
    else fs.rmSync(path.join(target.localDir, f), { force: true });
  }
  const r2Remove = [];
  for (const f of writtenR2) {
    const saved = path.join(backup, "r2", f);
    if (fs.existsSync(saved)) await r2Put(target.r2Prefix + f, fs.readFileSync(saved), f);
    else r2Remove.push(target.r2Prefix + f);
  }
  if (r2Remove.length) await r2Delete(r2Remove);
}
