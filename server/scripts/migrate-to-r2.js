#!/usr/bin/env node
/**
 * R2 migrációs script
 * Feltölti a helyi manga képeket Cloudflare R2-re.
 * Újraindítható: már feltöltött fájlokat kihagyja.
 *
 * Minden fájlnál feltöltés (vagy ha már fent volt, akkor is) után
 * HeadObjectCommand-dal ellenőrzi, hogy az R2-n lévő objektum mérete
 * pontosan egyezik a helyi fájl méretével — csak ekkor törli a helyi
 * fájlt. Ha nem egyezik (sikertelen/hiányos feltöltés vagy sérült R2
 * objektum), a helyi fájl megmarad, és a következő futás újra megpróbálja.
 * A végén az így kiürült mappákat is eltávolítja.
 *
 * Futtatás: node server/scripts/migrate-to-r2.js
 * Csak megadott könyvtár: node server/scripts/migrate-to-r2.js kavita
 *                         node server/scripts/migrate-to-r2.js padli
 *                         node server/scripts/migrate-to-r2.js uploads
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const pool = new pg.Pool({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const CONCURRENCY = 6; // párhuzamos feltöltések száma (3GB-os konténeren 30 túl sok volt)
const BUCKET = process.env.R2_BUCKET_NAME;

/* ================= LOCK ================= */
// Kizárja, hogy két migrate-to-r2 példány fusson egyszerre, és amíg ez a
// lock él, a fő szerver saját R2 sync sora (uploader.js) sem indít új
// feltöltést — a kettő együtt vitte a memóriát a padlóra.
const LOCK = "/tmp/padlizsanfansub.r2migrate.lock";

if (fs.existsSync(LOCK)) {
  const pid = parseInt(fs.readFileSync(LOCK, "utf8").trim(), 10);
  try {
    process.kill(pid, 0); // létezik-e még a folyamat
    console.log("⏳ migrate-to-r2 már fut, kilépek");
    process.exit(0);
  } catch {
    fs.unlinkSync(LOCK); // stale lock
  }
}

fs.writeFileSync(LOCK, process.pid.toString());

const cleanupLock = () => {
  if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
};
process.on("exit", cleanupLock);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({ requestTimeout: 30000, connectionTimeout: 10000, throwOnRequestTimeout: true }),
});

const SOURCES = {
  kavita:  { local: "/mnt/manga/Kavita",  r2prefix: "manga/kavita" },
  uploads: { local: "/opt/padli/uploads", r2prefix: "uploads" },
};

const filter = process.argv[2]; // opcionális: kavita / padli / uploads
const activeSources = filter
  ? { [filter]: SOURCES[filter] }
  : SOURCES;

if (filter && !SOURCES[filter]) {
  console.error(`Ismeretlen forrás: ${filter}. Válassz: kavita, padli, uploads`);
  process.exit(1);
}

// --- fájl felsorolás ---
function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

// --- R2 key ---
function toKey(localBase, r2prefix, filePath) {
  const rel = filePath.slice(localBase.length + 1);
  return `${r2prefix}/${rel}`;
}

// --- feltöltés ---
async function upload(filePath, key) {
  const body = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
    ".gif": "image/gif", ".avif": "image/avif",
  }[ext] ?? "application/octet-stream";

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

// --- létezik-e, és ha igen mekkora (ellenőrzéshez kell a méret) ---
async function headInfo(key) {
  try {
    const res = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { exists: true, size: res.ContentLength };
  } catch {
    return { exists: false, size: null };
  }
}

// --- védett útvonalak: forrás-gyökér, minden library-mappa, minden manga-mappa ---
// FONTOS: NEM mélység alapján döntjük el, mi védett — a library-mappák
// eltérő mélységben lehetnek a forrás-gyökér alatt (pl. ".../Kavita/Ascyra"
// 1 szint, ".../Kavita/Stukker/Kicsomagolt Manhwa" 2 szint), ezért egy fix
// mélység-küszöb (korábbi próbálkozás) tévesen törölte a mélyebben fekvő
// library-k manga-mappáit. Ehelyett közvetlenül az adatbázisból (library +
// manga tábla) építjük fel a pontos védett útvonal-listát.
async function getProtectedPaths(sourceRoot) {
  const protectedSet = new Set([path.resolve(sourceRoot)]);
  const { rows: libs } = await pool.query(`SELECT path FROM library`);
  for (const l of libs) protectedSet.add(path.resolve(l.path));
  // FONTOS: a manga.library_id csak a manga "otthoni" könyvtárát jelöli —
  // egy manga fejezetei TÖBB különböző library alatt is szétoszthatók (lásd
  // server/routes/uploader.js findMangaForPath megjegyzése, pl. "Tomb Raider
  // King" egyszerre van Ascyra ÉS Stukker alatt is). Ezért a chapter táblából
  // (a TÉNYLEGES library_id-vel fejezetenként) kell összegyűjteni az összes
  // (library_path, manga_folder) kombinációt, nem a manga saját library_id-jéből.
  const { rows: mangas } = await pool.query(
    `SELECT DISTINCT m.folder, l.path AS library_path
     FROM chapter c JOIN manga m ON m.id = c.manga_id JOIN library l ON l.id = c.library_id`
  );
  for (const m of mangas) protectedSet.add(path.resolve(path.join(m.library_path, m.folder)));
  return protectedSet;
}

// --- üres fejezet-mappák eltávolítása (alulról felfelé) ---
// A manga-mappa szintet a feltöltő felület böngészője (server/routes/uploader.js
// GET /files, fs.readdirSync) használja — ha ez eltűnik, a feltöltők nem
// látják a mangát a listában, hiába létezik rendesen az adatbázisban és
// R2-n. Csak azokat a mappákat töröljük, amik NINCSENEK a `protectedPaths`
// halmazban (tehát fejezet-szint és mélyebb), azokra semmi más nem
// hivatkozik, ha üresek.
function removeEmptyDirs(dir, protectedPaths) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name), protectedPaths);
  }
  if (protectedPaths.has(path.resolve(dir))) return;
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // nem üres, vagy közben törölték — nem baj
  }
}

// --- párhuzamos pool ---
async function runPool(tasks, concurrency) {
  const iter = tasks[Symbol.iterator]();
  let running = 0;
  let done = 0;
  const errors = [];

  return new Promise((resolve) => {
    function next() {
      while (running < concurrency) {
        const { value: task, done: iterDone } = iter.next();
        if (iterDone) {
          if (running === 0) resolve({ done, errors });
          return;
        }
        running++;
        task()
          .then(() => { done++; })
          .catch(e => errors.push(e))
          .finally(() => { running--; next(); });
      }
    }
    next();
  });
}

// --- főprogram ---
async function main() {
  let totalFiles = 0;
  let skipped = 0;
  let uploaded = 0;
  let failed = 0;
  let deletedLocal = 0;
  let verifyFailed = 0;
  const startTime = Date.now();

  for (const [name, { local, r2prefix }] of Object.entries(activeSources)) {
    if (!fs.existsSync(local)) {
      console.log(`[SKIP] ${local} nem létezik`);
      continue;
    }

    console.log(`\n=== ${name.toUpperCase()} → ${r2prefix} ===`);
    console.log(`Forrás: ${local}`);

    const files = [...walkFiles(local)];
    console.log(`Fájlok száma: ${files.length}`);
    totalFiles += files.length;

    // Kavitánál nyilvántartjuk az újonnan feltöltött manga könyvtárakat
    const uploadedMangaDirs = new Set();

    let done = 0;
    const tasks = files.map(filePath => async () => {
      const key = toKey(local, r2prefix, filePath);
      try {
        const localSize = fs.statSync(filePath).size;
        let head = await headInfo(key);

        if (!head.exists) {
          await upload(filePath, key);
          uploaded++;
          // manga mappa = a fejezet szülőmappája
          if (name === "kavita") {
            uploadedMangaDirs.add(path.dirname(path.dirname(filePath)));
          }
          // feltöltés után újra lekérjük, hogy TÉNYLEG ez van-e most fent
          head = await headInfo(key);
        } else {
          skipped++;
        }

        // Csak akkor törlünk helyi fájlt, ha az R2-n lévő objektum
        // mérete pontosan egyezik a helyivel — ez a "sikeres feltöltés"
        // igazolása, nem csak az, hogy a PUT nem dobott hibát.
        if (head.exists && head.size === localSize) {
          fs.unlinkSync(filePath);
          deletedLocal++;
        } else {
          verifyFailed++;
          console.error(
            `\n[ELLENŐRZÉS SIKERTELEN, helyi fájl megmarad] ${filePath} — helyi méret: ${localSize}, R2 méret: ${head.size ?? "nincs fent"}`
          );
        }
      } catch (e) {
        failed++;
        console.error(`\n[HIBA] ${filePath}: ${e.message}`);
      }

      done++;
      if (done % 500 === 0 || done === files.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (uploaded + skipped) / elapsed;
        const remaining = (files.length - done) / (rate || 1);
        process.stdout.write(
          `\r  ${done}/${files.length} | feltöltve: ${uploaded} | kihagyva: ${skipped} | törölve (helyi): ${deletedLocal} | ellenőrzés sikertelen: ${verifyFailed} | hiba: ${failed} | ~${Math.round(remaining / 60)}p hátra   `
        );
      }
    });

    await runPool(tasks, CONCURRENCY);
    console.log("");

    // Kiürült manga-/fejezet-mappák eltávolítása — csak kavitánál futtatjuk,
    // mert az "uploads" forrás alatt névvel ellátott, funkcionális mappák
    // (pl. bugs/, blog/) vannak, azokat sosem szabad automatikusan törölni,
    // még akkor sem, ha épp üresek.
    if (name === "kavita") {
      console.log(`🧹 Üres manga-/fejezet-mappák eltávolítása ${local} alól...`);
      const protectedPaths = await getProtectedPaths(local);
      removeEmptyDirs(local, protectedPaths);
    }

    // Kavita: újonnan feltöltött mangák r2_migrated=true beállítása
    if (name === "kavita" && uploadedMangaDirs.size > 0) {
      console.log(`\n📦 r2_migrated frissítése ${uploadedMangaDirs.size} manga mappára...`);
      let updated = 0;
      for (const mangaDir of uploadedMangaDirs) {
        const libraryPath = path.dirname(mangaDir);
        const mangaFolder = path.basename(mangaDir);
        try {
          const res = await pool.query(
            `UPDATE manga SET r2_migrated = true
             FROM library l
             WHERE manga.library_id = l.id
               AND l.path = $1
               AND manga.folder = $2
               AND manga.r2_migrated = false`,
            [libraryPath, mangaFolder]
          );
          updated += res.rowCount;
        } catch (e) {
          console.warn(`[WARN] DB update hiba (${mangaFolder}): ${e.message}`);
        }
      }
      console.log(`✅ r2_migrated=true: ${updated} manga frissítve`);
    }
  }

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n=== KÉSZ ===`);
  console.log(`Összesen: ${totalFiles} fájl`);
  console.log(`Feltöltve: ${uploaded}, Kihagyva (már fent volt): ${skipped}, Törölve (helyi, ellenőrzött): ${deletedLocal}, Ellenőrzés sikertelen: ${verifyFailed}, Hiba: ${failed}`);
  console.log(`Idő: ${Math.floor(totalSec / 3600)}ó ${Math.floor((totalSec % 3600) / 60)}p ${totalSec % 60}s`);

  await pool.end();
  if (failed > 0 || verifyFailed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
