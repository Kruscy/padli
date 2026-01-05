import express from "express";
import { pool } from "./db.js";

const router = express.Router();

/**
 * GET /api/manga
 * Manga lista
 */
router.get("/manga", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, slug FROM manga ORDER BY title"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/**
 * GET /api/chapters/:slug
 * Fejezetek egy mangához
 */
router.get("/chapters/:slug", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT c.id, c.title, c.folder
      FROM chapter c
      JOIN manga m ON m.id = c.manga_id
      WHERE m.slug = $1
      ORDER BY c.id
      `,
      [req.params.slug]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
