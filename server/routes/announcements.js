import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* ===== GET aktív kiírások ===== */
router.get("/", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, body, image_url, expires_at
      FROM announcements
      WHERE expires_at > now()
      ORDER BY created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== POST új kiírás (admin) ===== */
router.post("/", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const { title, body, image_url, days } = req.body;

  if (!title || !body || !days) {
    return res.status(400).json({ error: "Hiányzó mezők" });
  }

  const expires_at = new Date();
  expires_at.setDate(expires_at.getDate() + Number(days));

  try {
    const { rows } = await pool.query(`
      INSERT INTO announcements (title, body, image_url, created_by, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [title, body, image_url || null, req.session.user.id, expires_at]);

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== DELETE kiírás (admin) ===== */
router.delete("/:id", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  await pool.query(`DELETE FROM announcements WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;
