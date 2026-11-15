import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { deviceOf, platformMatches } from "../lib/device.js";

const router = express.Router();

/* ===== GET aktív kiírások ===== */
router.get("/", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, body, image_url, expires_at, click_count, cta_label, cta_url, platform
      FROM announcements
      WHERE expires_at > now()
      ORDER BY created_at DESC
    `);
    // Készülék szerint: a Windows-os Studio csak gépen, az Android-app csak Androidon (2026-11-15)
    const dev = deviceOf(req);
    res.setHeader("Vary", "User-Agent");
    res.json(rows.filter(r => platformMatches(r.platform, dev)));
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

/* ===== PUT szerkesztés (admin) ===== */
router.put("/:id", requireLogin, async (req, res) => {
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
      UPDATE announcements
      SET title = $1, body = $2, image_url = $3, expires_at = $4
      WHERE id = $5
      RETURNING *
    `, [title, body, image_url || null, expires_at, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: "Nem található" });
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

/* ===== POST kattintás-számláló (a kiírásban lévő linkre kattintva) ===== */
router.post("/:id/click", requireLogin, async (req, res) => {
  await pool.query(
    `UPDATE announcements SET click_count = click_count + 1 WHERE id = $1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

export default router;
