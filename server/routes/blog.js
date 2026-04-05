// server/routes/blog.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/* ── DB TÁBLA LÉTREHOZÁS (ha még nem létezik) ─────────────
   Futtasd egyszer a szerveren:

   CREATE TABLE IF NOT EXISTS blog_posts (
     id          SERIAL PRIMARY KEY,
     slug        TEXT UNIQUE NOT NULL,
     title       TEXT NOT NULL,
     excerpt     TEXT,
     content     TEXT,
     cover_url   TEXT,
     category    TEXT DEFAULT 'hir',  -- ajanlo | hir | forditas | kozosseg
     tags        TEXT[],
     author      TEXT,
     published   BOOLEAN DEFAULT false,
     created_at  TIMESTAMPTZ DEFAULT NOW(),
     updated_at  TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX IF NOT EXISTS blog_slug_idx    ON blog_posts(slug);
   CREATE INDEX IF NOT EXISTS blog_cat_idx     ON blog_posts(category);
   CREATE INDEX IF NOT EXISTS blog_pub_idx     ON blog_posts(published, created_at DESC);
─────────────────────────────────────────────────────────── */

/* ── GET /api/blog – lista ──────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT id, slug, title, excerpt, cover_url, category, tags, author, created_at, updated_at
      FROM blog_posts
      WHERE published = true
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    params.push(parseInt(limit));
    params.push(parseInt(offset));
    query += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Blog list error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── GET /api/blog/:slug – egyedi bejegyzés ────────────── */
router.get("/:slug", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM blog_posts WHERE slug = $1 AND published = true`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: "Nem található" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Blog post error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── POST /api/blog – új bejegyzés (csak admin) ─────────── */
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { slug, title, excerpt, content, cover_url, category, tags, author, published } = req.body;

    if (!slug || !title) return res.status(400).json({ error: "slug és title kötelező" });

    const { rows } = await pool.query(
      `INSERT INTO blog_posts (slug, title, excerpt, content, cover_url, category, tags, author, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [slug, title, excerpt||null, content||null, cover_url||null,
       category||"hir", tags||null, author||null, published||false]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ez a slug már létezik" });
    console.error("Blog create error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── PUT /api/blog/:slug – szerkesztés (csak admin) ────── */
router.put("/:slug", requireAdmin, async (req, res) => {
  try {
    const { title, excerpt, content, cover_url, category, tags, author, published } = req.body;

    const { rows } = await pool.query(
      `UPDATE blog_posts SET
         title=$1, excerpt=$2, content=$3, cover_url=$4,
         category=$5, tags=$6, author=$7, published=$8,
         updated_at=NOW()
       WHERE slug=$9 RETURNING *`,
      [title, excerpt||null, content||null, cover_url||null,
       category||"hir", tags||null, author||null,
       published !== undefined ? published : false,
       req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: "Nem található" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Blog update error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── DELETE /api/blog/:slug – törlés (csak admin) ──────── */
router.delete("/:slug", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM blog_posts WHERE slug=$1`, [req.params.slug]
    );
    if (!rowCount) return res.status(404).json({ error: "Nem található" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Blog delete error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── ADMIN MIDDLEWARE ────────────────────────────────────── */
function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Nincs jogosultság" });
  }
  next();
}

export default router;
