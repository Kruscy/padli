#!/usr/bin/env node
// Napi R2 monitor: összehasonlítja a mai és tegnapi objektumlistát,
// ha törlés észlelhető → notification a 5-ös usernek (Ascyra)

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = "/opt/padli/logs/r2-snapshots";
const NOTIFY_USER_ID = 5;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const pool = new pg.Pool({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function listAllR2Keys(prefix = "manga/") {
  const keys = [];
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    const res = await r2.send(cmd);
    for (const obj of res.Contents || []) {
      keys.push(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
  } while (continuationToken);
  return keys;
}

function snapshotPath(date) {
  return path.join(SNAPSHOT_DIR, `${date}.txt`);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function sendNotification(message, link = null) {
  await pool.query(
    `INSERT INTO notifications (user_id, type, message, link)
     VALUES ($1, 'r2_deletion', $2, $3)`,
    [NOTIFY_USER_ID, message, link]
  );
  console.log("Notification elküldve:", message);
}

async function main() {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const today = todayStr();
  const yesterday = yesterdayStr();
  const todayFile = snapshotPath(today);
  const yesterdayFile = snapshotPath(yesterday);

  console.log(`[${today}] R2 monitor indulás...`);

  // Mai snapshot lekérése
  console.log("R2 objektumok listázása...");
  const todayKeys = await listAllR2Keys();
  fs.writeFileSync(todayFile, todayKeys.join("\n"), "utf8");
  console.log(`Mai objektumok: ${todayKeys.length}`);

  // Ha nincs tegnapi snapshot → első futás, nincs mihez hasonlítani
  if (!fs.existsSync(yesterdayFile)) {
    console.log("Nincs tegnapi snapshot, első futás – baseline mentve.");
    await pool.end();
    return;
  }

  const yesterdayKeys = new Set(
    fs.readFileSync(yesterdayFile, "utf8").split("\n").filter(Boolean)
  );
  const todaySet = new Set(todayKeys);

  // Törölt kulcsok (tegnap megvolt, ma nincs)
  const deleted = [...yesterdayKeys].filter(k => !todaySet.has(k));

  if (deleted.length === 0) {
    console.log("Nincs törlés.");
    await pool.end();
    return;
  }

  console.log(`⚠️ ${deleted.length} törölt R2 objektum!`);

  // Fejezetek szerint csoportosítva (manga/kavita/{user}/{manga}/{chapter}/...)
  const deletedChapters = new Map();
  for (const key of deleted) {
    const parts = key.split("/");
    // manga/kavita/{user}/{manga}/{chapter}/{file}
    if (parts.length >= 5) {
      const chapterKey = parts.slice(0, 5).join("/");
      if (!deletedChapters.has(chapterKey)) deletedChapters.set(chapterKey, 0);
      deletedChapters.set(chapterKey, deletedChapters.get(chapterKey) + 1);
    }
  }

  if (deletedChapters.size > 0) {
    const chapterList = [...deletedChapters.entries()]
      .map(([ch, cnt]) => `${ch} (${cnt} fájl)`)
      .join("\n");

    const shortList = [...deletedChapters.keys()].slice(0, 5)
      .map(k => k.split("/").slice(3).join("/"))
      .join(", ");
    const extra = deletedChapters.size > 5 ? ` és még ${deletedChapters.size - 5} fejezet` : "";

    await sendNotification(
      `⚠️ R2 törlés észlelve (${today}): ${deletedChapters.size} fejezet érintett — ${shortList}${extra}`,
      "/admin.html"
    );

    // Log fájlba is
    const logPath = path.join(SNAPSHOT_DIR, `deletions-${today}.txt`);
    fs.writeFileSync(logPath, chapterList, "utf8");
    console.log(`Részletes lista: ${logPath}`);
  } else if (deleted.length > 0) {
    // Nem fejezet struktúra (pl. borítók, uploads)
    await sendNotification(
      `⚠️ R2 törlés észlelve (${today}): ${deleted.length} fájl törlődött`,
      "/admin.html"
    );
  }

  // Régi snapshotok törlése (30 napnál régebbiek)
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.txt$/));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    for (const f of files) {
      const fileDate = new Date(f.replace(".txt", ""));
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(SNAPSHOT_DIR, f));
        console.log(`Régi snapshot törölve: ${f}`);
      }
    }
  } catch {}

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
