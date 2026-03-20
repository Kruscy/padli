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

export default router;
