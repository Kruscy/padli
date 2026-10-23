// Visszamenőleges képtömörítés az R2-n (2. fázis) — ugyanazzal a
// compressPageImage-dzsel, mint a feltöltés (JPEG → JPEG, a kulcs/fájlnév
// NEM változik). A korábbi R2-scriptek adatvesztései miatt
// ([[r2-migration-script-saga]]) minden kép külön ellenőrzött:
//
//   1. Az eredeti a /mnt/manga/_eredeti/<kulcs> alá mentve és visszaolvasva
//      (md5) MIELŐTT bármit felülírnánk. Meglévő mentést soha nem írunk felül.
//   2. A tömörített kép ellenőrzött (formátum, méret, ≥15% nyereség).
//   3. Közvetlenül a PUT előtt HEAD, és maga a PUT is If-Match-csel megy
//      (az olvasáskori ETag-re): ha az objektum közben megváltozott (pl.
//      hibajegy-javítás), kimarad — a HEAD és a PUT közti résben sem írjuk felül.
//   3b. A tömörített kép teljes dekódolása + kicsinyített szürke összevetés
//      az eredetivel: túl nagy átlagos eltérésnél kimarad.
//   4. PUT után HEAD: a méret és az md5-ETag egyezzen; ha nem, az eredetit
//      visszatöltjük.
//   5. Csak DB-ben regisztrált fejezet képeihez nyúlunk, és ahhoz sem, ami
//      helyben is megvan (a migrate-to-r2 méret-ellenőrzése elbukna rajta).
//   6. Fejezetenként chapter.updated_at = now() → az olvasó ?v= paramétere
//      változik, a látogatók azonnal az újat kapják (mint hibajegy-javításnál).
//
// Fojtás: 2026-10-22-én egy fojtatlan próbafuttatás (5,8 GB letöltés, 2 szál,
// libvips minden magon) annyira lelassította az R2-képproxyt, hogy a szerver
// hatszor összeomlott, és egy feltöltés utáni scan is megszakadt. Ezért:
//   - sávszél-korlát az R2 felé (le + fel együtt, token-vödör)
//   - 1 kép egyszerre, libvips 1 szálon, a folyamat legalacsonyabb prioritáson
//   - képenként: szünet, ha scan/migráció fut vagy magas a rendszerterhelés
//   - --apply csak éjjel (00:00–07:00) indul, és alapból 07:00-kor leáll
//
// Futtatás (alapból PRÓBAFUTTATÁS, semmit nem ír az R2-re/DB-be):
//   node server/scripts/recompress-r2.js --prefix "manga/kavita/Meriodasu/QUESTISM/"
//     --apply           ténylegesen tömörít
//     --limit N         legfeljebb N kép (próbához)
//     --compare N       az első N tömörített képről előtte|utána kivágás a jelentésbe
//     --until HH:MM     ekkor szabályosan leáll (--apply mellett alapból 07:00)
//     --rate MB/s       sávszél-korlát az R2 felé (alapból 3)
//     --concurrency N   egyszerre feldolgozott képek (alapból 1)
//     --napkozben       --apply nappal is (csak felügyelt, kis --limit-es próbához)
//     --restore         visszaállítás a mentésből (csak amit ez a script írt felül)
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { execSync } from "child_process";
import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { pool } from "../db.js";
import { r2, BUCKET, mangaImageToR2Key } from "../r2.js";
import { compressPageImage } from "../lib/image-compress.js";

const BACKUP_ROOT = "/mnt/manga/_eredeti";
const STATE_FILE = path.join(BACKUP_ROOT, "_allapot.jsonl");
const LOCKS = ["/tmp/padlizsanfansub.r2migrate.lock", "/tmp/padlizsanfansub.scan.lock"];
const MIN_FREE_BACKUP = 50 * 1024 ** 3;
const MIN_FREE_ROOT = 3 * 1024 ** 3;
const MAX_MEAN_DIFF = 4;   // 0–255 skálán, 256 px széles szürke kicsinyítésen

/* ── Argumentumok ── */
const argv = process.argv.slice(2);
const arg = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const PREFIX = arg("--prefix");
const APPLY = argv.includes("--apply");
const RESTORE = argv.includes("--restore");
const LIMIT = Number(arg("--limit")) || Infinity;
const COMPARE = Number(arg("--compare")) || 0;
const RATE = (Number(arg("--rate")) || 3) * 1024 * 1024;           // bájt/s
const CONCURRENCY = Math.max(1, Number(arg("--concurrency")) || 1);
const DAYTIME_OK = argv.includes("--napkozben");
const UNTIL = arg("--until") || (APPLY && !DAYTIME_OK ? "07:00" : null);
const NIGHT_START = 0, NIGHT_END = 7;                                 // óra, helyi idő
const MAX_LOAD = os.cpus().length * 0.7;                              // 1 perces loadavg

if (APPLY && !DAYTIME_OK) {
  const h = new Date().getHours();
  if (h < NIGHT_START || h >= NIGHT_END) {
    console.error(`--apply csak ${NIGHT_START}:00 és ${NIGHT_END}:00 között indul (napközben: --napkozben, kis --limit-tel)`);
    process.exit(1);
  }
}

// CPU: a webszerver és a scan mindig előnyt élvez
try { os.setPriority(19); } catch {}
sharp.concurrency(1);

if (!PREFIX || !PREFIX.startsWith("manga/") || !PREFIX.endsWith("/")) {
  console.error('Kötelező: --prefix "manga/kavita/<könyvtár>/<sorozat>/" (perjellel a végén)');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const md5 = buf => crypto.createHash("md5").update(buf).digest("hex");
const mb = n => (n / 1024 / 1024).toFixed(1) + " MB";

function pastUntil() {
  if (!UNTIL) return false;
  const [h, m] = UNTIL.split(":").map(Number);
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const stop = h * 60 + (m || 0);
  // Este indított, reggelre időzített futás: 22:00-kor indul, --until 07:00
  return startedAfterStop ? mins >= stop && mins < startMins : mins >= stop;
}
const startMins = new Date().getHours() * 60 + new Date().getMinutes();
const startedAfterStop = UNTIL && (() => {
  const [h, m] = UNTIL.split(":").map(Number);
  return startMins > h * 60 + (m || 0);
})();

function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
}

function scanRunning() {
  try {
    execSync("pgrep -f 'server/(scan|scripts/migrate-to-r2)\\.js'", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Scan / migrate-to-r2 alatt, illetve magas rendszerterhelésnél szünetel (ne
// versenyezzen velük és a látogatókkal az R2-n és a CPU-n). Képenként hívjuk.
async function waitForQuiet() {
  let said = null;
  for (;;) {
    let why = null;
    if (LOCKS.some(l => fs.existsSync(l)) || scanRunning()) why = "scan vagy R2-migráció fut";
    else if (os.loadavg()[0] > MAX_LOAD) why = `magas a terhelés (${os.loadavg()[0].toFixed(1)} > ${MAX_LOAD.toFixed(1)})`;
    if (!why) {
      if (said) console.log("▶ folytatás");
      return;
    }
    if (said !== why) console.log(`⏸ ${why} — várakozás...`);
    said = why;
    if (pastUntil()) return;
    await sleep(30_000);
  }
}

// Sávszél-korlát: token-vödör, legfeljebb 1 mp-nyi löket. Egy nagy kép
// "adósságba" viheti a vödröt; ilyenkor a következő átvitel kivárja.
let tokens = RATE;
let lastRefill = Date.now();
async function throttle(bytes) {
  const now = Date.now();
  tokens = Math.min(RATE, tokens + (now - lastRefill) / 1000 * RATE);
  lastRefill = now;
  tokens -= bytes;
  if (tokens < 0) await sleep(-tokens / RATE * 1000);
}

/* ── Állapot (folytathatóság) ── */
function loadState() {
  const state = new Map();
  if (!fs.existsSync(STATE_FILE)) return state;
  for (const line of fs.readFileSync(STATE_FILE, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      state.set(r.key, r);
    } catch {}
  }
  return state;
}

function saveState(rec) {
  fs.appendFileSync(STATE_FILE, JSON.stringify({ ...rec, at: new Date().toISOString() }) + "\n");
}

/* ── R2 ── */
async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const r = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) keys.push({ key: o.Key, size: o.Size, etag: o.ETag });
    token = r.IsTruncated ? r.NextContinuationToken : null;
  } while (token);
  return keys;
}

async function getObject(key) {
  const r = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return {
    body: Buffer.from(await r.Body.transformToByteArray()),
    etag: r.ETag,
    contentType: r.ContentType || "image/jpeg",
    cacheControl: r.CacheControl,
    metadata: r.Metadata,
  };
}

async function head(key) {
  try {
    const r = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { etag: r.ETag, size: r.ContentLength };
  } catch {
    return null;
  }
}

async function putVerified(key, body, obj, ifMatch) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body,
    ContentType: obj.contentType, CacheControl: obj.cacheControl, Metadata: obj.metadata,
    ...(ifMatch ? { IfMatch: ifMatch } : {}),
  }));
  const h = await head(key);
  return h && h.size === body.length && h.etag === `"${md5(body)}"` ? h : null;
}

// Teljes dekódolás + a kicsinyített szürke képek átlagos eltérése (0–255)
// Mindkettő pontosan ugyanarra a rácsra kerül: kicsinyítésnél (2400 → 1600 px)
// a 256 px-es magasság különben 1 px-lel eltérhet, és a sorok elcsúsznak.
async function meanDiff(a, b) {
  const [ma, mb2] = await Promise.all([a, b].map(buf => sharp(buf, { limitInputPixels: false }).metadata()));
  const dims = m => ((m.orientation || 1) >= 5 ? [m.height, m.width] : [m.width, m.height]);
  const [wa, ha] = dims(ma);
  const [wb, hb] = dims(mb2);
  if (Math.abs(ha / wa - hb / wb) * wa > 2) return Infinity;   // más a képarány
  const width = 256;
  const height = Math.max(1, Math.round(ha * width / wa));
  const small = buf => sharp(buf, { limitInputPixels: false })
    .rotate().resize({ width, height, fit: "fill", fastShrinkOnLoad: false }).greyscale().raw().toBuffer();
  const [x, y] = await Promise.all([small(a), small(b)]);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

/* ── DB: kulcs → fejezet ── */
async function loadChapters() {
  const { rows } = await pool.query(`
    SELECT c.id, c.folder, m.folder AS manga_folder, l.path AS library_path
    FROM chapter c JOIN manga m ON m.id = c.manga_id JOIN library l ON l.id = c.library_id`);
  const byPrefix = new Map();
  for (const r of rows) {
    try {
      const key = mangaImageToR2Key(r.library_path, r.manga_folder, r.folder, "x");
      // ".../Ch1/x" → ".../Ch1": a kulcsokból is perjel nélkül számoljuk a mappát
      byPrefix.set(key.slice(0, -2), { id: r.id, localDir: path.join(r.library_path, r.manga_folder, r.folder) });
    } catch {}
  }
  return byPrefix;
}

async function bumpChapter(chapterId) {
  await pool.query(`UPDATE chapter SET updated_at = NOW() WHERE id = $1`, [chapterId]);
}

/* ── Összehasonlító kép (előtte | utána, 1:1 kivágás) ── */
async function writeCompare(dir, key, before, after) {
  const m = await sharp(after, { limitInputPixels: false }).metadata();
  const w = Math.min(m.width, 700);
  const h = Math.min(m.height, 700);
  const crop = { left: 0, top: Math.max(0, Math.floor(m.height / 3) - h / 2) | 0, width: w, height: h };
  const scaledBefore = await sharp(before, { limitInputPixels: false }).rotate().resize({ width: m.width }).toBuffer();
  const a = await sharp(scaledBefore, { limitInputPixels: false }).extract(crop).png().toBuffer();
  const b = await sharp(after, { limitInputPixels: false }).extract(crop).png().toBuffer();
  const name = key.split("/").slice(-2).join("_").replace(/[^\w.-]+/g, "_") + ".png";
  await sharp({ create: { width: w * 2 + 8, height: h, channels: 3, background: "#ff0000" } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: w + 8, top: 0 }])
    .png().toFile(path.join(dir, name));
}

/* ── Egy kép ── */
async function processKey(item, chapter, ctx) {
  const { key } = item;
  const prev = ctx.state.get(key);
  if (prev?.result === "kész" && prev.newEtag === item.etag) return { result: "már kész" };
  // Kihagyott, de azóta nem változott → nem töltjük le újra
  if (prev?.result?.startsWith("kihagyva") && prev.oldEtag === item.etag) return { result: prev.result };

  if (!/\.jpe?g$/i.test(key)) return { result: "kihagyva: nem JPEG" };
  if (fs.existsSync(path.join(chapter.localDir, path.basename(key)))) return { result: "kihagyva: helyben is megvan" };

  await throttle(item.size);
  const obj = await getObject(key);
  const r = await compressPageImage(obj.body, key);
  if (!r.changed) {
    const rec = { key, result: `kihagyva: ${r.reason}`, oldEtag: obj.etag, before: obj.body.length };
    if (APPLY) saveState(rec);
    return rec;
  }

  const diff = await meanDiff(obj.body, r.buffer);
  if (!(diff <= MAX_MEAN_DIFF)) {
    const rec = { key, result: `kihagyva: képi eltérés ${diff.toFixed(2)}`, oldEtag: obj.etag, before: obj.body.length };
    if (APPLY) saveState(rec);
    return rec;
  }
  ctx.maxDiff = Math.max(ctx.maxDiff || 0, diff);

  if (ctx.compared < COMPARE) {
    ctx.compared++;
    await writeCompare(ctx.reportDir, key, obj.body, r.buffer).catch(e => console.warn("összehasonlító kép hiba:", e.message));
  }

  if (!APPLY) return { result: "tömörítené", before: obj.body.length, after: r.buffer.length };

  // 1. Mentés + visszaolvasás
  const backupPath = path.join(BACKUP_ROOT, key);
  if (fs.existsSync(backupPath)) {
    const existing = fs.readFileSync(backupPath);
    if (md5(existing) !== md5(obj.body)) {
      // Lehet, hogy már egyszer felülírtuk, de az állapot elveszett — az
      // eredetit őrző mentést semmiképp nem írjuk felül.
      return { key, result: "HIBA: van eltérő mentés — kézi ellenőrzés kell", oldEtag: obj.etag };
    }
  } else {
    if (freeBytes(BACKUP_ROOT) < MIN_FREE_BACKUP) throw new Error("Kevés hely a mentésnek (/mnt/manga)");
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    const fd = fs.openSync(backupPath, "wx");
    fs.writeSync(fd, obj.body);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    if (md5(fs.readFileSync(backupPath)) !== md5(obj.body)) {
      fs.unlinkSync(backupPath);
      return { key, result: "HIBA: a mentés visszaolvasása nem egyezik", oldEtag: obj.etag };
    }
  }

  // 2. Változott-e közben?
  const h = await head(key);
  if (!h || h.etag !== obj.etag) {
    const rec = { key, result: "kihagyva: közben megváltozott", oldEtag: obj.etag };
    saveState(rec);
    return rec;
  }

  // 3. Felülírás + ellenőrzés; sikertelen ellenőrzésnél az eredeti vissza
  let ok;
  try {
    await throttle(r.buffer.length);
    ok = await putVerified(key, r.buffer, obj, obj.etag);
  } catch (err) {
    if (err.name !== "PreconditionFailed" && err.$metadata?.httpStatusCode !== 412) throw err;
    const rec = { key, result: "kihagyva: közben megváltozott", oldEtag: obj.etag };
    saveState(rec);
    return rec;
  }
  if (!ok) {
    const restored = await putVerified(key, obj.body, obj);
    const rec = { key, result: restored ? "HIBA: ellenőrzés sikertelen, eredeti visszaállítva" : "HIBA: ellenőrzés ÉS visszaállítás sikertelen", oldEtag: obj.etag };
    saveState(rec);
    return rec;
  }

  const rec = { key, result: "kész", oldEtag: obj.etag, newEtag: ok.etag, before: obj.body.length, after: r.buffer.length };
  saveState(rec);
  return rec;
}

/* ── Visszaállítás a mentésből ── */
async function restoreKey(item, chapter, ctx) {
  const prev = ctx.state.get(item.key);
  if (prev?.result !== "kész") return { result: "nincs mit visszaállítani" };
  if (prev.newEtag !== item.etag) return { result: "HIBA: azóta megváltozott (pl. javítás) — nem írjuk felül" };
  const backupPath = path.join(BACKUP_ROOT, item.key);
  if (!fs.existsSync(backupPath)) return { result: "HIBA: nincs mentés" };
  const original = fs.readFileSync(backupPath);
  if (!APPLY) return { result: "visszaállítaná", before: item.size, after: original.length };
  await throttle(original.length);
  const obj = await getObject(item.key);
  const ok = await putVerified(item.key, original, obj);
  if (!ok) return { result: "HIBA: visszaállítás ellenőrzése sikertelen" };
  saveState({ key: item.key, result: "visszaállítva", oldEtag: item.etag, newEtag: ok.etag });
  return { result: "visszaállítva" };
}

/* ── Fő ciklus ── */
async function main() {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  if (APPLY && freeBytes("/") < MIN_FREE_ROOT) throw new Error("Kevés hely a / lemezen");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportDir = path.join(BACKUP_ROOT, "_jelentes", stamp);
  if (COMPARE) fs.mkdirSync(reportDir, { recursive: true });

  const mode = RESTORE ? "VISSZAÁLLÍTÁS" : "TÖMÖRÍTÉS";
  console.log(`${mode} — ${APPLY ? "ÉLES" : "PRÓBAFUTTATÁS (nem ír semmit)"} — ${PREFIX}`);
  console.log(`fojtás: ${mb(RATE)}/s, ${CONCURRENCY} kép egyszerre, szünet ha load > ${MAX_LOAD.toFixed(1)}${UNTIL ? `, leáll: ${UNTIL}` : ""}`);

  const chapters = await loadChapters();
  const keys = await listKeys(PREFIX);
  const ctx = { state: loadState(), compared: 0, reportDir };

  // Fejezetenként csoportosítva (kulcs szerinti sorrendben)
  const groups = new Map();
  let unregistered = 0;
  for (const k of keys.sort((a, b) => a.key.localeCompare(b.key))) {
    const dir = k.key.slice(0, k.key.lastIndexOf("/"));
    const ch = chapters.get(dir);
    if (!ch) { unregistered++; continue; }
    if (!groups.has(dir)) groups.set(dir, { chapter: ch, items: [] });
    groups.get(dir).items.push(k);
  }
  console.log(`${keys.length} objektum, ${groups.size} fejezet${unregistered ? `, ${unregistered} DB-ben nem regisztrált fejezethez tartozik (kihagyva)` : ""}\n`);

  const totals = { n: 0, before: 0, after: 0, counts: {} };
  let processed = 0;
  let stopped = null;

  for (const [dir, { chapter, items }] of groups) {
    if (processed >= LIMIT) { stopped = "--limit elérve"; break; }
    if (pastUntil()) { stopped = `--until ${UNTIL}`; break; }

    const queue = items.slice(0, LIMIT - processed);
    processed += queue.length;
    let changedInChapter = 0;

    const worker = async () => {
      while (queue.length) {
        await waitForQuiet();
        if (pastUntil()) { stopped = `--until ${UNTIL}`; return; }
        const item = queue.shift();
        let rec;
        try {
          rec = RESTORE ? await restoreKey(item, chapter, ctx) : await processKey(item, chapter, ctx);
        } catch (err) {
          rec = { result: `HIBA: ${err.message}` };
          if (/Kevés hely/.test(err.message)) throw err;
        }
        const label = rec.result.startsWith("kihagyva") ? rec.result : rec.result.replace(/:.*/, "");
        totals.counts[label] = (totals.counts[label] || 0) + 1;
        if (rec.result.startsWith("HIBA")) console.log(`  ⚠ ${item.key}: ${rec.result}`);
        if (["kész", "tömörítené", "visszaállítva", "visszaállítaná"].includes(rec.result)) {
          totals.n++;
          totals.before += rec.before || 0;
          totals.after += rec.after || 0;
          if (rec.result === "kész" || rec.result === "visszaállítva") changedInChapter++;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (APPLY && changedInChapter) await bumpChapter(chapter.id);
    console.log(`✓ ${dir.slice(PREFIX.length) || dir}: ${items.length} kép, ${changedInChapter} módosítva | eddig: ${mb(totals.before)} → ${mb(totals.after)}`);
  }

  console.log(`\n${stopped ? `Megállt (${stopped}). ` : ""}Összesítés:`, totals.counts);
  if (totals.n) {
    const saved = totals.before - totals.after;
    console.log(`${totals.n} kép: ${mb(totals.before)} → ${mb(totals.after)} (${saved >= 0 ? "−" : "+"}${mb(Math.abs(saved))}, ${(saved / totals.before * 100).toFixed(0)}%)`);
  }
  if (ctx.maxDiff) console.log(`Legnagyobb képi eltérés: ${ctx.maxDiff.toFixed(2)} (küszöb ${MAX_MEAN_DIFF})`);
  if (COMPARE) console.log(`Összehasonlító képek: ${reportDir}`);
  if (!APPLY) console.log("PRÓBAFUTTATÁS — az R2-n és a DB-ben semmi nem változott.");
}

main()
  .catch(err => {
    console.error("LEÁLLT:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
