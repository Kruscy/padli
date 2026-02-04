import fs from "fs";
import path from "path";
import { pool } from "./db.js";

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
          await pool.query(
            `
            INSERT INTO chapter (manga_id, title, folder, library_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (manga_id, folder) DO NOTHING
            `,
            [
              mangaId,
              ch.name,
              ch.name,
              libraryId
            ]
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
  .catch(err => {
    console.error("❌ Scan failed:", err);
    process.exit(1);
  })
  .finally(() => {
    cleanup();
    pool.end();
  });
