import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* =========================
   GET /api/stats/completion
   ========================= */
router.get("/completion", requireLogin, async (req, res) => {
  try {

    const { rows } = await pool.query(`
      WITH last_chapters AS (
        SELECT
          m.id AS manga_id,
          m.title,
          (
            SELECT c.folder
            FROM chapter c
            WHERE c.manga_id = m.id
            ORDER BY
              CAST(regexp_replace(c.folder, '[^0-9]', '', 'g') AS INT) DESC
            LIMIT 1
          ) AS last_folder
        FROM manga m
      )

      SELECT
        lc.title,

        COUNT(DISTINCT rp.user_id) AS started,

        COUNT(
          DISTINCT CASE
            WHEN rp.chapter = lc.last_folder THEN rp.user_id
          END
        ) AS completed

      FROM last_chapters lc
      LEFT JOIN reading_progress rp
        ON rp.manga_id = lc.manga_id

      GROUP BY lc.title
      ORDER BY started DESC;
    `);

    res.json(rows);

  } catch (err) {
    console.error("STATS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/* =========================
   GET /api/stats/reading
   Napi/heti/havi top mangák
   ========================= */
router.get("/reading", requireLogin, async (req, res) => {
  try {
    const { period = "daily" } = req.query;

    let days;
    if (period === "daily")        days = 1;
    else if (period === "weekly")  days = 7;
    else if (period === "monthly") days = 30;
    else return res.status(400).json({ error: "Érvénytelen időszak" });

    // daily_stats (aggregált előző napok) + mai chapter_reads együtt
    // DATE-alapú szűrő: elkerüli a DATE vs TIMESTAMP összehasonlítási hibát,
    // ami miatt a határnapon lévő daily_stats kiesett (pl. heti: június 11. kiesett)
    const { rows } = await pool.query(`
      SELECT
        m.title,
        m.slug,
        m.cover_url,
        (
          COALESCE((
            SELECT SUM(ds.read_count)::int
            FROM daily_stats ds
            WHERE ds.manga_id = m.id
              AND ds.stat_date >= CURRENT_DATE - ($1 - 1)
              AND ds.stat_date < CURRENT_DATE
          ), 0)
          +
          COALESCE((
            SELECT COUNT(*)::int
            FROM chapter_reads cr
            WHERE cr.manga_id = m.id
              AND cr.read_at >= CURRENT_DATE
          ), 0)
        ) AS total_reads,
        (
          SELECT COUNT(DISTINCT cr.user_id)::int
          FROM chapter_reads cr
          WHERE cr.manga_id = m.id
            AND cr.read_at >= CURRENT_DATE - ($1 - 1)
        ) AS total_unique
      FROM manga m
      WHERE EXISTS (
        SELECT 1 FROM daily_stats ds
        WHERE ds.manga_id = m.id
          AND ds.stat_date >= CURRENT_DATE - ($1 - 1)
          AND ds.stat_date < CURRENT_DATE
        UNION ALL
        SELECT 1 FROM chapter_reads cr
        WHERE cr.manga_id = m.id AND cr.read_at >= CURRENT_DATE - ($1 - 1)
      )
      GROUP BY m.id, m.title, m.slug, m.cover_url
      ORDER BY total_unique DESC
      LIMIT 10
    `, [days]);

    res.json(rows);
  } catch (err) {
    console.error("STATS READING ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
export default router;
