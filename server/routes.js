import express from "express";
import fs from "fs";
import path from "path";
import { pool } from "./db.js";

const router = express.Router();

/* ================= HELPERS ================= */

function extractPageNumber(filename) {
  const base = filename.replace(/\.[^.]+$/, ""); // .jpg levágása
  const match = base.match(/(\d+)(?!.*\d)/);     // UTOLSÓ szám
  return match ? parseInt(match[1], 10) : null;
}

/* ================= MANGA LIST ================= */

router.get("/manga", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT title, slug, cover_url FROM manga ORDER BY title"
  );
  res.json(rows);
});

/* ================= CHAPTER LIST ================= */

router.get("/chapters/:slug", async (req, res) => {
  const { slug } = req.params;

  const { rows } = await pool.query(
    `
    SELECT c.folder, c.title
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    WHERE m.slug = $1
    ORDER BY
      CAST(
        REGEXP_REPLACE(c.folder, '[^0-9]', '', 'g')
        AS INTEGER
      )
    `,
    [slug]
  );

  res.json(rows);
});


/* ================= PAGE LIST ================= */

router.get("/pages/:slug/:chapter", async (req, res) => {
  const { slug, chapter } = req.params;

  const result = await pool.query(
    `
    SELECT
      l.path AS library_path,
      m.folder AS manga_folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = c.library_id
    WHERE m.slug = $1 AND c.folder = $2
    LIMIT 1
    `,
    [slug, chapter]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Chapter not found" });
  }

  const { library_path, manga_folder } = result.rows[0];
  const dir = path.join(library_path, manga_folder, chapter);

  try {
const files = fs
  .readdirSync(dir)
  .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

const pages = files
  .map(f => ({ f, n: extractPageNumber(f) }))
  .sort((a, b) => {
    // ha mindkettő számozott → szám szerint
    if (a.n !== null && b.n !== null) return a.n - b.n;
    // ha csak egyik számozott → az menjen előre
    if (a.n !== null) return -1;
    if (b.n !== null) return 1;
    // egyik sem → természetes ABC
    return a.f.localeCompare(b.f, undefined, { numeric: true });
  })
  .map(p => p.f);

    res.json(pages);
  } catch {
    res.status(404).json({ error: "Pages not found" });
  }
});

/* ================= IMAGE ================= */

router.get("/image/:slug/:chapter/:file", async (req, res) => {
  const { slug, chapter, file } = req.params;

  const result = await pool.query(
    `
    SELECT
      l.path AS library_path,
      m.folder AS manga_folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = c.library_id
    WHERE m.slug = $1 AND c.folder = $2
    LIMIT 1
    `,
    [slug, chapter]
  );

  if (!result.rows.length) return res.status(404).end();

  const { library_path, manga_folder } = result.rows[0];
  const imgPath = path.join(library_path, manga_folder, chapter, file);

  if (!fs.existsSync(imgPath)) return res.status(404).end();

  res.sendFile(imgPath);
});

/* ================= NEXT / PREV ================= */

router.get("/chapter-nav/:slug/:chapter", async (req, res) => {
  const { slug, chapter } = req.params;

  const { rows } = await pool.query(
    `
    SELECT c.folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    WHERE m.slug = $1
    ORDER BY c.folder
    `,
    [slug]
  );

  const list = rows.map(r => r.folder);
  const idx = list.indexOf(chapter);

  res.json({
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  });
});

export default router;
