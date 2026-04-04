import express from "express";
import { pool } from "../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.avatar,
        ps.tier,
        ps.active
      FROM patreon_status ps
      JOIN users u ON u.id = ps.user_id
      WHERE ps.active = TRUE
      ORDER BY ps.tier DESC NULLS LAST, u.username ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("SUPPORTERS ERROR:", err);
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
