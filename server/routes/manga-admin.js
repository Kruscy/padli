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
        CAST(COALESCE(NULLIF(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 1), ''), '0') AS INT),
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
    const { rows } = await pool.query(`
      SELECT c.id, c.folder, c.manga_id, m.title AS manga_title, m.slug AS manga_slug
      FROM chapter c
      JOIN manga m ON m.id = c.manga_id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Fejezet nem található" });
    const chapter = rows[0];

    await pool.query(`DELETE FROM chapter WHERE id = $1`, [req.params.id]);

    await pool.query(
      `INSERT INTO admin_delete_log (admin_id, admin_username, target_type, target_id, target_title, details)
       VALUES ($1, $2, 'chapter', $3, $4, $5)`,
      [
        req.session.user.id,
        req.session.user.username,
        chapter.id,
        `${chapter.manga_title} – ${chapter.folder}`,
        JSON.stringify({ mangaId: chapter.manga_id, mangaSlug: chapter.manga_slug, mangaTitle: chapter.manga_title, folder: chapter.folder }),
      ]
    );

    console.log(`[chapter-delete] Törölve: "${chapter.manga_title}" – ${chapter.folder} (chapter id: ${chapter.id}) – admin: ${req.session.user.username}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ===== MANGA TÖRLÉS ===== */
router.delete("/manga/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    // Duplikált slug esetén (két manga-bejegyzés ugyanazzal a slug-gal)
    // MINDEGYIKET töröljük — különben a meg nem törölt duplikátum
    // "feltámasztja" a címet a következő oldalbetöltéskor.
    const { rows } = await pool.query(`SELECT id, title FROM manga WHERE slug = $1`, [slug]);
    if (!rows.length) return res.status(404).json({ error: "Manga nem található" });

    const ids = rows.map(r => r.id);
    const title = rows[0].title;

    const { rows: chapterRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM chapter WHERE manga_id = ANY($1)`,
      [ids]
    );
    const chapterCount = chapterRows[0].n;

    await pool.query(`DELETE FROM chapter WHERE manga_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM manga WHERE id = ANY($1)`, [ids]);

    await pool.query(
      `INSERT INTO admin_delete_log (admin_id, admin_username, target_type, target_id, target_title, details)
       VALUES ($1, $2, 'manga', $3, $4, $5)`,
      [
        req.session.user.id,
        req.session.user.username,
        ids[0],
        title,
        JSON.stringify({ slug, allIds: ids, chapterCount }),
      ]
    );

    console.log(`[manga-delete] Törölve: "${title}" (slug: ${slug}, id-k: ${ids.join(",")}) – admin: ${req.session.user.username}`);
    res.json({ ok: true, deleted: title, deletedCount: ids.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ===== TÖRLÉSI NAPLÓ (manga + fejezet) ===== */
router.get("/manga-delete-log", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, admin_id, admin_username, target_type, target_title, details, created_at
      FROM admin_delete_log
      WHERE target_type IN ('manga', 'chapter')
      ORDER BY created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
