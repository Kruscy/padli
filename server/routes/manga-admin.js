import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/* ===== ADMIN GUARD ===== */
router.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

/* ===== MANGA LISTA ===== */
router.get("/mangas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, slug FROM manga ORDER BY title`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ===== CHAPTER LISTA ===== */
router.get("/manga/:slug/chapters", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.folder, c.scanned_at, c.unlocks_at
      FROM chapter c
      JOIN manga m ON m.id = c.manga_id
      WHERE m.slug = $1
      ORDER BY
        CAST(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 1) AS INT),
        CAST(COALESCE(NULLIF(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 2), ''), '0') AS INT)
    `, [req.params.slug]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ===== UNLOCK IDŐ MÓDOSÍTÁS ===== */
router.post("/chapter/:id/unlock", async (req, res) => {
  const { hours } = req.body;
  try {
    await pool.query(
      `UPDATE chapter
       SET unlocks_at = COALESCE(unlocks_at, now()) + ($1 * interval '1 hour')
       WHERE id = $2`,
      [hours, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ===== CHAPTER TÖRLÉS ===== */
router.delete("/chapter/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM chapter WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
