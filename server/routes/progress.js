import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* ===== SAVE PROGRESS ===== */
router.post("/", async (req, res) => {
  const userId = req.session.user?.id;
  const { slug, chapter, page } = req.body;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  const manga = await pool.query("SELECT id FROM manga WHERE slug = $1", [slug]);
  if (!manga.rows.length) return res.status(404).json({ error: "Manga not found" });

  const mangaId = manga.rows[0].id;

  await pool.query(
    `INSERT INTO reading_progress (user_id, manga_id, chapter, page)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, manga_id)
     DO UPDATE SET chapter = EXCLUDED.chapter, page = EXCLUDED.page, updated_at = now()`,
    [userId, mangaId, chapter, page]
  );

  res.json({ ok: true });
});

/* ===== LOAD PROGRESS ===== */
router.get("/:slug", requireLogin, async (req, res) => {
  if (!req.session.user) return res.json(null);

  const { slug } = req.params;
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
