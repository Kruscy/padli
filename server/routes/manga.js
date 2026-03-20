import express from "express";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();
/* ================= HELPERS ================= */

function extractPageNumber(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const match = base.match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
}
/* ================= MANGA LIST ================= */
router.get("/manga", requireLogin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT title, slug, cover_url FROM manga ORDER BY title"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});
/* ================= MANGA METADATA ================= */
router.get("/manga/:slug", requireLogin, async (req, res) => {
  const { slug } = req.params;

  const { rows } = await pool.query(
    `
    SELECT
      m.title,
      m.slug,
      m.cover_url,
      m.description,
      COALESCE(
        ARRAY_AGG(g.name) FILTER (WHERE g.name IS NOT NULL),
        '{}'
      ) AS tags
    FROM manga m
    LEFT JOIN manga_genre mg ON mg.manga_id = m.id
    LEFT JOIN genre g ON g.id = mg.genre_id
    WHERE m.slug = $1
    GROUP BY m.id
    `,
    [slug]
  );

  if (!rows.length) return res.status(404).end();
  res.json(rows[0]);
});
/* ================= CHAPTER LIST ================= */

router.get("/chapters/:slug", requireLogin, async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      `
      SELECT c.folder, c.title, c.scanned_at
      FROM chapter c
      JOIN manga m ON m.id = c.manga_id
      WHERE m.slug = $1
ORDER BY
  CAST(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 1) AS INT),
  CAST(COALESCE(NULLIF(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 2), ''), '0') AS INT)
      `,
      [slug]
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});

/* ================= PAGE LIST ================= */

router.get("/pages/:slug/:chapter", requireLogin, async (req, res) => {
  const { slug, chapter } = req.params;

  const result = await pool.query(
    `
    SELECT
      l.path AS library_path,
      m.folder AS manga_folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = m.library_id
    WHERE m.slug = $1 AND c.folder = $2
    LIMIT 1
    `,
    [slug, chapter]
  );

  if (!result.rows.length) {
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
        if (a.n !== null && b.n !== null) return a.n - b.n;
        if (a.n !== null) return -1;
        if (b.n !== null) return 1;
        return a.f.localeCompare(b.f, undefined, { numeric: true });
      })
      .map(p => p.f);

    res.json(pages);
  } catch (e) {
    console.error(e);
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
    JOIN library l ON l.id = m.library_id
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

router.get("/chapter-nav/:slug/:chapter", requireLogin, async (req, res) => {
  const { slug, chapter } = req.params;

  const { rows } = await pool.query(
    `
    SELECT c.folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    WHERE m.slug = $1
ORDER BY
  CAST(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 1) AS INT),
  CAST(COALESCE(NULLIF(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 2), ''), '0') AS INT)
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


router.get("/featured", requireLogin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT title, slug, cover_url, description
    FROM manga
    WHERE cover_url IS NOT NULL
      AND description IS NOT NULL
  `);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // egyszerű seedelt random
  function seededRandom(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
    }
    return () => {
      h = Math.imul(48271, h) % 0x7fffffff;
      return (h & 0xfffffff) / 0xfffffff;
    };
  }

  const rand = seededRandom(today);

  const shuffled = [...rows].sort(() => rand() - 0.5);

  res.json(shuffled.slice(0, 5));
});

export default router;
