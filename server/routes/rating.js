import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* ===== GET RATING ===== */
router.get("/:slug", requireLogin, async (req, res) => {
  const { slug } = req.params;
  const userId = req.session.user.id;

  try {
    const { rows } = await pool.query(
      `SELECT
        m.avg_rating,
        m.rating_count,
        mr.rating AS user_rating
       FROM manga m
       LEFT JOIN manga_rating mr ON mr.manga_id = m.id AND mr.user_id = $1
       WHERE m.slug = $2`,
      [userId, slug]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== SET RATING ===== */
router.post("/:slug", requireLogin, async (req, res) => {
  const { slug } = req.params;
  const { rating } = req.body;
  const userId = req.session.user.id;

  if (!rating || rating < 1 || rating > 10) {
    return res.status(400).json({ error: "Invalid rating" });
  }

  try {
    const mangaRes = await pool.query(
      "SELECT id FROM manga WHERE slug = $1", [slug]
    );
    if (!mangaRes.rows.length) return res.status(404).json({ error: "Not found" });
    const mangaId = mangaRes.rows[0].id;

    await pool.query(
      `INSERT INTO manga_rating (manga_id, user_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (manga_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()`,
      [mangaId, userId, rating]
    );

    // avg és count frissítés
    const stats = await pool.query(
      `SELECT ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*) AS cnt
       FROM manga_rating WHERE manga_id = $1`,
      [mangaId]
    );

    await pool.query(
      `UPDATE manga SET avg_rating = $1, rating_count = $2 WHERE id = $3`,
      [stats.rows[0].avg, stats.rows[0].cnt, mangaId]
    );

    res.json({
      ok: true,
      avg_rating: stats.rows[0].avg,
      rating_count: stats.rows[0].cnt,
      user_rating: rating
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
