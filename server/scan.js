import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import dotenv from "dotenv";
dotenv.config();

/* ================= LOCK ================= */

const LOCK = "/tmp/padlizsanfansub.scan.lock";

if (fs.existsSync(LOCK)) {
  console.log("⏳ Scan already running, exiting");
  process.exit(0);
}

fs.writeFileSync(LOCK, process.pid.toString());

const cleanup = () => {
  if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

/* ================= HELPERS ================= */

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isImage(file) {
  return /\.(jpg|jpeg|png|webp)$/i.test(file);
}
function getChapterNumber(title) {
  const match = title.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}
/* ================= UNLOCK TIMES ================= */
const lockHours = parseInt(process.env.LOCK_HOURS || "24", 10);
async function setUnlockTimes() {
  console.log("⏰ Setting unlock times (skip first 15)...");

  const mangaRes = await pool.query(`SELECT id, slug FROM manga`);

  for (const manga of mangaRes.rows) {
    const res = await pool.query(
      `SELECT id, title, unlocks_at
       FROM chapter
       WHERE manga_id = $1`,
      [manga.id]
    );

    if (!res.rows.length) continue;

    // 🔢 szám kiszedése (utolsó szám + tizedes)
    function getChapterNumber(title) {
      const matches = title.match(/\d+(\.\d+)?/g);
      if (!matches) return 0;

      const last = matches[matches.length - 1];
      return parseFloat(last);
    }

    // 📊 rendezés
    const chapters = res.rows.sort(
      (a, b) => getChapterNumber(a.title) - getChapterNumber(b.title)
    );

    let lastUnlock = null;
    let updated = 0;

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];

      // 🟢 első 15 → mindig unlock
      if (i < 15) {
        if (!ch.unlocks_at || new Date(ch.unlocks_at) > new Date()) {
          await pool.query(
            `UPDATE chapter SET unlocks_at = now() - interval '1 second' WHERE id = $1`,
            [ch.id]
          );
        }

        lastUnlock = new Date(); // hogy a lánc innen induljon
        continue;
      }

      let newUnlock;

      if (ch.unlocks_at) {
        lastUnlock = new Date(ch.unlocks_at);
        continue;
      }

      if (!lastUnlock) {
        newUnlock = new Date(Date.now() + lockHours * 3600000);
      } else {
        newUnlock = new Date(lastUnlock.getTime() + lockHours * 3600000);
      }

      await pool.query(
        `UPDATE chapter SET unlocks_at = $1 WHERE id = $2`,
        [newUnlock, ch.id]
      );

      lastUnlock = newUnlock;
      updated++;
    }

    console.log(`✅ ${manga.slug} – ${updated} chapter lockolva (15 free)`);
  }

  console.log("✅ Unlock times set!");
}

/* ================= LOAD LIBRARIES ================= */

const LIB_FILE = path.join(process.cwd(), "libraries.json");

if (!fs.existsSync(LIB_FILE)) {
  console.error("❌ libraries.json not found");
  process.exit(1);
}

const libraries = JSON.parse(fs.readFileSync(LIB_FILE, "utf8"))
  .filter(l => l.enabled && fs.existsSync(l.path));

/* ================= SCAN ================= */

async function scan() {
  console.log("📚 Starting scan\n");

  for (const lib of libraries) {
    console.log(`📂 Library: ${lib.name}`);
    console.log(`   Path: ${lib.path}`);

    const libRes = await pool.query(
      `
      INSERT INTO library (name, path, enabled)
      VALUES ($1, $2, true)
      ON CONFLICT (path) DO UPDATE SET enabled = true
      RETURNING id
      `,
      [lib.name, lib.path]
    );

    const libraryId = libRes.rows[0].id;

    let mangaDirs;
    try {
      mangaDirs = fs.readdirSync(lib.path, { withFileTypes: true })
        .filter(d => d.isDirectory());
    } catch (err) {
      console.error(`❌ Failed to read library dir: ${lib.path}`, err.message);
      continue;
    }

    for (const mangaDir of mangaDirs) {
      const mangaTitle = mangaDir.name;
      const mangaSlug = slugify(mangaTitle);
      const mangaPath = path.join(lib.path, mangaTitle);

      let mangaId;
      try {
        const mangaRes = await pool.query(
          `
          INSERT INTO manga (title, slug, folder, library_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (slug, library_id) DO UPDATE
            SET title = EXCLUDED.title
          RETURNING id
          `,
          [mangaTitle, mangaSlug, mangaTitle, libraryId]
        );
        mangaId = mangaRes.rows[0].id;
      } catch (err) {
        console.error(`❌ DB error (manga): ${mangaTitle}`, err.message);
        continue;
      }

      let chapterDirs;
      try {
        chapterDirs = fs.readdirSync(mangaPath, { withFileTypes: true })
          .filter(d => d.isDirectory());
      } catch (err) {
        console.error(`⚠️ Cannot read manga folder, skipping: ${mangaPath}`);
        continue;
      }

      for (const ch of chapterDirs) {
        const chapterPath = path.join(mangaPath, ch.name);

        let files;
        try {
          files = fs.readdirSync(chapterPath);
        } catch (err) {
          console.warn(`⚠️ Cannot read chapter folder: ${chapterPath}`);
          continue;
        }

        const imageCount = files.filter(isImage).length;

        // 👉 CSAK AKKOR SKIP, HA 0 KÉP VAN
        if (imageCount === 0) {
          console.warn(`⚠️ No images, skipping chapter: ${chapterPath}`);
          continue;
        }

        try {


let folderMtime = new Date();
try {
  folderMtime = fs.statSync(chapterPath).mtime;
} catch {}

await pool.query(
  `INSERT INTO chapter (manga_id, title, folder, library_id, scanned_at)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (manga_id, folder) DO NOTHING`,
  [mangaId, ch.name, ch.name, libraryId, folderMtime]
);
        } catch (err) {
          console.error(
            `❌ DB error (chapter): ${mangaTitle} / ${ch.name}`,
            err.message
          );
        }
      }
    }

    console.log("   ✔ Library scan done\n");
  }

  console.log("✅ Scan finished successfully");
}

/* ================= RUN ================= */

scan()
  .then(() => setUnlockTimes())
  .catch(err => {
    console.error("❌ Scan failed:", err);
    process.exit(1);
  })
  .finally(() => {
    cleanup();
    pool.end();
  });
