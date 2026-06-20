#!/usr/bin/env node
/**
 * R2 migrációs script
 * Feltölti a helyi manga képeket Cloudflare R2-re.
 * Újraindítható: már feltöltött fájlokat kihagyja.
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

const CONCURRENCY = 30; // párhuzamos feltöltések száma
const BUCKET = process.env.R2_BUCKET_NAME;
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
  kavita:  { local: "/mnt/manga/Kavita",        r2prefix: "manga/kavita" },
  padli:   { local: "/mnt/manga2/padli_manga",  r2prefix: "manga/padli_manga" },
  uploads: { local: "/opt/padli/uploads",        r2prefix: "uploads" },
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

// --- már létezik-e? ---
async function exists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
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
        if (await exists(key)) {
          skipped++;
        } else {
          await upload(filePath, key);
          uploaded++;
          // manga mappa = a fejezet szülőmappája
          if (name === "kavita") {
            uploadedMangaDirs.add(path.dirname(path.dirname(filePath)));
          }
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
          `\r  ${done}/${files.length} | feltöltve: ${uploaded} | kihagyva: ${skipped} | hiba: ${failed} | ~${Math.round(remaining / 60)}p hátra   `
        );
      }
    });

    await runPool(tasks, CONCURRENCY);
    console.log("");

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
  console.log(`Feltöltve: ${uploaded}, Kihagyva: ${skipped}, Hiba: ${failed}`);
  console.log(`Idő: ${Math.floor(totalSec / 3600)}ó ${Math.floor((totalSec % 3600) / 60)}p ${totalSec % 60}s`);

  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
