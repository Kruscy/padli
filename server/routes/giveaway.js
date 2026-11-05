import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* ===== GET aktív nyereményjáték ===== */
router.get("/active", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.id, g.title, g.description, g.image_url, g.ends_at,
        (SELECT count(*) FROM giveaway_entries ge WHERE ge.giveaway_id = g.id)::int AS entry_count,
        EXISTS(SELECT 1 FROM giveaway_entries ge WHERE ge.giveaway_id = g.id AND ge.user_id = $1) AS entered_by_me
      FROM giveaways g
      WHERE g.ends_at > now() AND g.winner_user_id IS NULL
      ORDER BY g.created_at DESC
      LIMIT 1
    `, [req.session.user.id]);
    res.json(rows[0] || null);
  } catch (err) {
    console.error("GIVEAWAY ACTIVE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== POST jelentkezés ===== */
router.post("/:id/enter", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM giveaways WHERE id = $1 AND ends_at > now() AND winner_user_id IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "A nyereményjáték már nem aktív" });

    await pool.query(
      `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.session.user.id]
    );

    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS n FROM giveaway_entries WHERE giveaway_id = $1`,
      [req.params.id]
    );
    res.json({ ok: true, entryCount: countRows[0].n });
  } catch (err) {
    console.error("GIVEAWAY ENTER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== GET összes nyereményjáték jelentkező-számmal (admin) ===== */
router.get("/admin", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  try {
    const { rows } = await pool.query(`
      SELECT g.id, g.title, g.ends_at, g.winner_user_id, g.drawn_at,
        (SELECT count(*) FROM giveaway_entries ge WHERE ge.giveaway_id = g.id)::int AS entry_count,
        u.username AS winner_username
      FROM giveaways g
      LEFT JOIN users u ON u.id = g.winner_user_id
      ORDER BY g.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("GIVEAWAY ADMIN LIST ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== POST új nyereményjáték (admin) ===== */
router.post("/", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  const { title, description, image_url, prize_link, days } = req.body;
  if (!title || !prize_link || !days) {
    return res.status(400).json({ error: "Hiányzó mezők" });
  }
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + Number(days));
  try {
    const { rows } = await pool.query(`
      INSERT INTO giveaways (title, description, image_url, prize_link, ends_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, ends_at
    `, [title, description || null, image_url || null, prize_link, endsAt, req.session.user.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error("GIVEAWAY CREATE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
