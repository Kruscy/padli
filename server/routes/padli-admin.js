// server/routes/padli-admin.js
// Bekötés a routes.js-be:
//   import padliAdminRoutes from "./routes/padli-admin.js";
//   app.use("/api/admin/padli", padliAdminRoutes);

import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// Admin guard
router.use((req, res, next) => {
  if (!req.session?.user || req.session.user.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  next();
});

/* ── CONFIG ─────────────────────────────────────────────── */

router.get("/config", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value, label, description, category FROM padli_config ORDER BY category, key`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/config/:key", async (req, res) => {
  try {
    const { value } = req.body;
    await pool.query(
      `UPDATE padli_config SET value=$1, updated_at=NOW() WHERE key=$2`,
      [JSON.stringify(value), req.params.key]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── VÁLASZ VARIÁCIÓK ───────────────────────────────────── */

router.get("/replies", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM padli_replies ORDER BY type, id`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/replies", async (req, res) => {
  try {
    const { type, text } = req.body;
    if (!type || !text) return res.status(400).json({ error: "type és text kötelező" });
    const { rows } = await pool.query(
      `INSERT INTO padli_replies (type, text) VALUES ($1,$2) RETURNING *`,
      [type, text]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/replies/:id", async (req, res) => {
  try {
    const { text, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE padli_replies SET text=COALESCE($1,text), active=COALESCE($2,active) WHERE id=$3 RETURNING *`,
      [text ?? null, active ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/replies/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM padli_replies WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── TAG SZAVAK ─────────────────────────────────────────── */

// Összes tag lekérése a DB-ből (tag táblából) + hozzájuk rendelt szavak
router.get("/tag-words", async (req, res) => {
  try {
    const { rows: dbTags } = await pool.query(
      `SELECT DISTINCT t.name FROM tag t ORDER BY t.name`
    );
    const { rows: mapped } = await pool.query(
      `SELECT tag_name, words FROM padli_tag_words ORDER BY tag_name`
    );
    const wordMap = Object.fromEntries(mapped.map(r => [r.tag_name, r.words]));

    const result = dbTags.map(t => ({
      tag_name: t.name,
      words: wordMap[t.name] || []
    }));

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/tag-words/:tagName", async (req, res) => {
  try {
    const { words } = req.body;
    const tagName = decodeURIComponent(req.params.tagName);
    await pool.query(
      `INSERT INTO padli_tag_words (tag_name, words, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (tag_name) DO UPDATE SET words=$2, updated_at=NOW()`,
      [tagName, words]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── GENRE SZAVAK ───────────────────────────────────────── */

router.get("/genre-words", async (req, res) => {
  try {
    const { rows: dbGenres } = await pool.query(
      `SELECT DISTINCT name FROM genre ORDER BY name`
    );
    const { rows: mapped } = await pool.query(
      `SELECT genre_name, words FROM padli_genre_words ORDER BY genre_name`
    );
    const wordMap = Object.fromEntries(mapped.map(r => [r.genre_name, r.words]));
    const result = dbGenres.map(g => ({
      genre_name: g.name,
      words: wordMap[g.name] || []
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/genre-words/:genreName", async (req, res) => {
  try {
    const { words } = req.body;
    const genreName = decodeURIComponent(req.params.genreName);
    await pool.query(
      `INSERT INTO padli_genre_words (genre_name, words, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (genre_name) DO UPDATE SET words=$2, updated_at=NOW()`,
      [genreName, words]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
/* ── KARAKTEREK ─────────────────────────────────────────── */

router.get("/characters", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, 
        COALESCE(json_agg(s ORDER BY s.id) FILTER (WHERE s.id IS NOT NULL), '[]') AS stories
       FROM padli_characters c
       LEFT JOIN padli_stories s ON s.character_id = c.id
       GROUP BY c.id ORDER BY c.id`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/characters", async (req, res) => {
  try {
    const { name, description, personality } = req.body;
    if (!name) return res.status(400).json({ error: "name kötelező" });
    const { rows } = await pool.query(
      `INSERT INTO padli_characters (name, description, personality) VALUES ($1,$2,$3) RETURNING *`,
      [name, description || null, personality || null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/characters/:id", async (req, res) => {
  try {
    const { name, description, personality, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE padli_characters SET
        name=COALESCE($1,name), description=COALESCE($2,description),
        personality=COALESCE($3,personality), active=COALESCE($4,active),
        updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [name||null, description||null, personality||null, active??null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/characters/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM padli_characters WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── TÖRTÉNETEK ─────────────────────────────────────────── */

router.post("/characters/:id/stories", async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "title és content kötelező" });
    const { rows } = await pool.query(
      `INSERT INTO padli_stories (character_id, title, content) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, title, content]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/stories/:id", async (req, res) => {
  try {
    const { title, content, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE padli_stories SET
        title=COALESCE($1,title), content=COALESCE($2,content), active=COALESCE($3,active)
       WHERE id=$4 RETURNING *`,
      [title||null, content||null, active??null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/stories/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM padli_stories WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── PADLI AI ÚJRAINDÍTÁS (config reload) ───────────────── */
router.post("/reload", async (req, res) => {
  try {
    // Jelzés a padli-ai.js-nek hogy töltse újra a DB-ből a configot
    process.emit("padli-config-reload");
    res.json({ ok: true, message: "Config újratöltve" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
