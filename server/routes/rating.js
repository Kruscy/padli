import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* ===== GET RATING ===== */
router.get("/:slug", requireLogin, async (req, res) => {
  const { slug } = req.params;
  const userId = req.session.user.id;

  try {
    // Duplikált slug esetén (két manga-bejegyzés ugyanazzal a slug-gal)
    // ugyanazt a kanonikus bejegyzést válasszuk, mint a GET /api/manga/:slug
    // (a több fejezettel rendelkezőt) — így az értékelés mindig oda íródik
    // és onnan olvasódik, ahonnan a metaadat is jön.
    const { rows } = await pool.query(
      `SELECT
        m.avg_rating,
        m.rating_count,
        mr.rating AS user_rating
       FROM manga m
       LEFT JOIN manga_rating mr ON mr.manga_id = m.id AND mr.user_id = $1
       LEFT JOIN chapter c ON c.manga_id = m.id
       WHERE m.slug = $2
       GROUP BY m.id, mr.rating
       ORDER BY COUNT(DISTINCT c.id) DESC, m.id ASC
       LIMIT 1`,
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
    // Duplikált slug esetén ugyanazt a kanonikus bejegyzést válasszuk,
    // mint a GET rating és a GET /api/manga/:slug (a több fejezettel
    // rendelkezőt).
    const mangaRes = await pool.query(
      `SELECT m.id
       FROM manga m
       LEFT JOIN chapter c ON c.manga_id = m.id
       WHERE m.slug = $1
       GROUP BY m.id
       ORDER BY COUNT(DISTINCT c.id) DESC, m.id ASC
       LIMIT 1`,
      [slug]
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
