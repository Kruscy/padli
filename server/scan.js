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

    const mangaDirs = fs.readdirSync(lib.path, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const mangaDir of mangaDirs) {
      const mangaTitle = mangaDir.name;
      const mangaSlug = slugify(mangaTitle);
      const mangaPath = path.join(lib.path, mangaTitle);

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

      const mangaId = mangaRes.rows[0].id;

      const chapterDirs = fs.readdirSync(mangaPath, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const ch of chapterDirs) {
        await pool.query(
          `
          INSERT INTO chapter (manga_id, title, folder, library_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (manga_id, folder) DO NOTHING
          `,
          [
            mangaId,
            ch.name,   // title
            ch.name,   // folder
            libraryId
          ]
        );
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
