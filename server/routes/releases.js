import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { resolveAdultMode, ADULT_GENRE_EXISTS_SQL } from "../lib/age.js";
import {
  getNewReleasesCache,
  setNewReleasesCache
} from "../cache/new-releases.js";

const router = express.Router();

/* ================= NEW RELEASES ================= */

router.get("/new-releases", requireLogin, async (req, res) => {
  const adultMode = await resolveAdultMode(pool, req);
  const { rows } = await pool.query(`
    SELECT
      m.title,
      m.slug,
      m.cover_url,
      COUNT(c.id)::int AS new_count,
      MAX(c.scanned_at) AS latest_scan
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    WHERE c.scanned_at >= NOW() - INTERVAL '7 days'
      AND ${ADULT_GENRE_EXISTS_SQL} = $1
    GROUP BY m.id
    ORDER BY latest_scan DESC
    LIMIT 50
  `, [adultMode]);

  res.json(rows);
});

export default router;
