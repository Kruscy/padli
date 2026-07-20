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

    // total_reads = EGYEDI (felhasználó, fejezet) párosok száma az időszakban —
    // így ha valaki visszalapoz egy már elolvasott fejezethez, az nem számít
    // újra. A nyers chapter_reads 30 napig visszamenőleg megbízható (lásd
    // daily-stats.js retenció), ezért közvetlenül abból számolunk, nem a
    // daily_stats napi aggregátumból (ami napi bontásban nem tudná kiszűrni
    // a napok közötti ismétlődő olvasásokat).
    const { rows } = await pool.query(`
      SELECT
        m.title,
        m.slug,
        m.cover_url,
        COUNT(DISTINCT (cr.user_id, cr.chapter))::int AS total_reads,
        COUNT(DISTINCT cr.user_id)::int AS total_unique
      FROM manga m
      JOIN chapter_reads cr ON cr.manga_id = m.id
      WHERE cr.read_at >= CURRENT_DATE - ($1 - 1)
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
