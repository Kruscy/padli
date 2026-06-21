import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import fs from "fs";
import path from "path";

const router = express.Router();

// ✅ Chapter számok természetes rendezése
function parseChapterNumber(str) {
  const m = str.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : Infinity;
}

/* ===== SAVE PROGRESS ===== */
router.post("/", async (req, res) => {
  const userId = req.session.user?.id;
  const { slug, chapter, page } = req.body;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  const manga = await pool.query("SELECT id FROM manga WHERE slug = $1", [slug]);
  if (!manga.rows.length) return res.status(404).json({ error: "Manga not found" });

  const mangaId = manga.rows[0].id;

  // Lekérjük az előző fejezetet
  const prev = await pool.query(
    `SELECT chapter FROM reading_progress WHERE user_id = $1 AND manga_id = $2`,
    [userId, mangaId]
  );
  const prevChapter = prev.rows[0]?.chapter || null;

  await pool.query(
    `INSERT INTO reading_progress (user_id, manga_id, chapter, page)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, manga_id)
     DO UPDATE SET chapter = EXCLUDED.chapter, page = EXCLUDED.page, updated_at = now()`,
    [userId, mangaId, chapter, page]
  );

  // Chapter read log - csak ha fejezet változott (vagy első olvasás)
  if (prevChapter !== chapter) {
    await pool.query(
      `INSERT INTO chapter_reads (user_id, manga_id, chapter)
       VALUES ($1, $2, $3)`,
      [userId, mangaId, chapter]
    ).catch(() => {}); // ha a tábla még nem létezik, nem dob hibát
  }

  res.json({ ok: true });
});

/* ===== now reading ===== */
router.get("/recent-reading", async (req, res) => {
  try {
    if (!req.session?.user) return res.json([]);

    const userId = req.session.user.id;

    // Progress + az összes fejezet DB-ből egy lekérdezésben
    const { rows } = await pool.query(`
      SELECT
        rp.chapter,
        rp.page,
        rp.updated_at,
        m.slug AS manga_slug,
        m.title,
        m.cover_url,
        l.name AS library_name,
        ARRAY(
          SELECT c.folder FROM chapter c
          WHERE c.manga_id = m.id
        ) AS chapters
      FROM reading_progress rp
      INNER JOIN manga m ON m.id = rp.manga_id
      LEFT JOIN library l ON l.id = m.library_id
      WHERE rp.user_id = $1
      ORDER BY rp.updated_at DESC
    `, [userId]);

    if (!rows.length) return res.json([]);

    const results = rows.map(p => {
      if (!p.chapters?.length) return null;

      // Természetes rendezés (számszerű)
      const folders = [...p.chapters].sort(
        (a, b) => parseChapterNumber(a) - parseChapterNumber(b)
      );

      const lastChapter = folders[folders.length - 1];
      if (p.chapter === lastChapter) return null; // felzárkózott

      const currentIndex = folders.indexOf(p.chapter);
      if (currentIndex === -1) return null;

      const hasNewChapter = currentIndex < folders.length - 1;
      const nextChapter = hasNewChapter ? folders[currentIndex + 1] : null;

      return {
        slug: p.manga_slug,
        title: p.title,
        cover_url: p.cover_url,
        library: p.library_name,
        chapter: p.chapter,
        page: p.page,
        updated_at: p.updated_at,
        lastChapter,
        hasNewChapter,
        nextChapter,
        totalChapters: folders.length,
        currentIndex,
      };
    }).filter(Boolean);

    // Prioritás rendezés: majdnem kész → legutóbb olvasott
    results.sort((a, b) => {
      const aAlmost = a.hasNewChapter && a.currentIndex === a.totalChapters - 2;
      const bAlmost = b.hasNewChapter && b.currentIndex === b.totalChapters - 2;
      if (aAlmost && !bAlmost) return -1;
      if (!aAlmost && bAlmost) return 1;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });

    res.json(results);
  } catch (err) {
    console.error("[ERROR] Recent reading:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== LOAD PROGRESS ===== */
router.get("/:slug?", requireLogin, async (req, res) => {
  if (!req.session.user) return res.json(null);

  const slug = req.params.slug || req.query.slug;
  if (!slug) return res.json(null);
  const userId = req.session.user.id;

  const { rows } = await pool.query(
    `SELECT rp.chapter, rp.page, rp.updated_at
     FROM reading_progress rp
     JOIN manga m ON m.id = rp.manga_id
     WHERE rp.user_id = $1 AND m.slug = $2
     LIMIT 1`,
    [userId, slug]
  );

  res.json(rows[0] || null);
});

/* ===== DELETE PROGRESS ===== */
router.delete("/:slug", requireLogin, async (req, res) => {
  const userId = req.session.user?.id;
  const { slug } = req.params;

  try {
    const manga = await pool.query("SELECT id FROM manga WHERE slug = $1", [slug]);
    if (!manga.rows.length) return res.status(404).json({ error: "Manga not found" });

    const mangaId = manga.rows[0].id;

    await pool.query(
      `DELETE FROM reading_progress WHERE user_id = $1 AND manga_id = $2`,
      [userId, mangaId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE PROGRESS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
