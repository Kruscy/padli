import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createWriteStream } from "fs";
import path from "path";
import sharp from "sharp";
import pg from "pg";
import https from "https";
import http from "http";

// --- Config ---
const ENV = Object.fromEntries(
  readFileSync("/opt/padli/.env", "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#") && l.trim())
    .map(l => [l.split("=")[0].trim(), l.split("=").slice(1).join("=").trim()])
);

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ENV.R2_ACCESS_KEY_ID,
    secretAccessKey: ENV.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = ENV.R2_BUCKET_NAME;
const PUBLIC_URL = ENV.R2_PUBLIC_URL.replace(/\/$/, "");
const UPLOADS_DIR = "/opt/padli/uploads";
const LOG_FILE = "/opt/padli/logs/r2-migrate.log";

const pool = new pg.Pool({
  host: ENV.PGHOST || "localhost",
  port: parseInt(ENV.PGPORT || "5432"),
  database: ENV.PGDATABASE,
  user: ENV.PGUSER,
  password: ENV.PGPASSWORD,
});

let logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString().slice(11,19)}] ${msg}`;
  console.log(line);
  logLines.push(line);
  writeFileSync(LOG_FILE, logLines.join("\n") + "\n");
}

// --- Download helper ---
function download(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 15000, headers: { "User-Agent": "PadliBot/1.0" } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// --- Compress to WebP ---
async function toWebP(inputBuffer) {
  return sharp(inputBuffer)
    .resize(460, 650, { fit: "cover", position: "top" })
    .webp({ quality: 82 })
    .toBuffer();
}

// --- Upload to R2 ---
async function uploadR2(key, buffer) {
  await R2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "image/webp",
    CacheControl: "public, max-age=31536000",
  }));
  return `${PUBLIC_URL}/${key}`;
}

// --- Main ---
const { rows: mangas } = await pool.query(
  "SELECT id, slug, title, cover_url FROM manga WHERE cover_url IS NOT NULL ORDER BY id"
);

log(`Indulás — ${mangas.length} manga feldolgozása`);
log(`Bucket: ${BUCKET}`);
log("─".repeat(50));

let ok = 0, skip = 0, err = 0;

for (const manga of mangas) {
  const { id, slug, title, cover_url } = manga;
  const r2Key = `covers/${slug || id}.webp`;
  const newUrl = `${PUBLIC_URL}/${r2Key}`;

  // Ha már R2 URL-en van, kihagyjuk
  if (cover_url.startsWith(PUBLIC_URL)) {
    skip++;
    continue;
  }

  try {
    let inputBuffer;

    if (cover_url.startsWith("/uploads/")) {
      // Helyi fájl
      const localPath = path.join(UPLOADS_DIR, path.basename(cover_url));
      if (!existsSync(localPath)) {
        log(`HIÁNYZÓ helyi fájl: ${title} — ${cover_url}`);
        err++;
        continue;
      }
      inputBuffer = readFileSync(localPath);
    } else if (cover_url.startsWith("http")) {
      // Külső URL letöltése
      inputBuffer = await download(cover_url);
    } else {
      log(`ISMERETLEN formátum: ${title} — ${cover_url}`);
      err++;
      continue;
    }

    const webpBuffer = await toWebP(inputBuffer);
    await uploadR2(r2Key, webpBuffer);

    await pool.query("UPDATE manga SET cover_url = $1 WHERE id = $2", [newUrl, id]);

    const origKB = Math.round(inputBuffer.length / 1024);
    const newKB = Math.round(webpBuffer.length / 1024);
    log(`OK  ${title.slice(0,40).padEnd(40)} ${origKB}KB → ${newKB}KB`);
    ok++;

  } catch (e) {
    log(`HIBA  ${title} — ${e.message}`);
    err++;
  }
}

log("─".repeat(50));
log(`Kész: ${ok} feltöltve, ${skip} kihagyva (már R2), ${err} hiba`);

await pool.end();
