import express from "express";
import { spawn } from "child_process";
import { pool } from "../db.js";
import { sendMail } from "../mail.js";
import { clearNewReleasesCache } from "../cache/new-releases.js";
import multer from "multer";
import { refreshMetadataForManga } from "../refresh-metadata.js";
import fs from "fs";
import path from "path";

const router = express.Router();
/* ================= ADMIN GUARD ================= */

router.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

/* ================= SCAN LIBRARY ================= */

router.post("/scan", (req, res) => {
  try {
    // 🔥 CACHE TÖRLÉS – AMINT SCAN INDUL
	clearNewReleasesCache();
    // AZONNAL válaszolunk a frontendnek
    res.json({ ok: true });

    // háttérben elindítjuk a scan-t
    const scan = spawn(
      "node",
      ["./server/scan.js"],
      {
        cwd: "/opt/padli",
        detached: true,
        stdio: "ignore"
      }
    );

    scan.unref();

    console.log("🔄 Admin scan started");
  } catch (err) {
    console.error("❌ Scan spawn failed", err);
  }
});


/* ================= UPDATE MANGA META ================= */
router.post("/manga/:slug", async (req, res) => {
  const { slug } = req.params;
  const { cover_url, description, title, genres, tags, uploaders, anilist_id } = req.body;

  try {
    const mangaRes = await pool.query(
      `SELECT id FROM manga WHERE slug = $1`, [slug]
    );
    if (!mangaRes.rows.length) return res.status(404).json({ error: "Not found" });
    const mangaId = mangaRes.rows[0].id;
await pool.query(
  `UPDATE manga SET
    cover_url = COALESCE($1, cover_url),
    description = COALESCE($2, description),
    title = COALESCE($3, title),
    uploaders = $4::text[],
    anilist_id = CASE WHEN $5::int IS NOT NULL THEN $5::int ELSE anilist_id END
   WHERE id = $6`,
  [cover_url || null, description || null, title || null,
   uploaders || [], anilist_id || null, mangaId]
);
    if (genres) {
      await pool.query(`DELETE FROM manga_genre WHERE manga_id = $1`, [mangaId]);
      for (const g of genres) {
        const gRes = await pool.query(
          `INSERT INTO genre (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`, [g]
        );
        await pool.query(
          `INSERT INTO manga_genre (manga_id, genre_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [mangaId, gRes.rows[0].id]
        );
      }
    }

    if (tags) {
      await pool.query(`DELETE FROM manga_tag WHERE manga_id = $1`, [mangaId]);
      for (const t of tags) {
        const tRes = await pool.query(
          `INSERT INTO tag (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`, [t]
        );
        await pool.query(
          `INSERT INTO manga_tag (manga_id, tag_id, rank) VALUES ($1, $2, 0)
           ON CONFLICT DO NOTHING`,
          [mangaId, tRes.rows[0].id]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN EDIT ERROR:", err);
    res.status(500).json({ error: "DB error", detail: err.message });
  }
});
/* ================= Users ================= */
router.get("/users", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, username, email, role, created_at, ps.tier, ps.active, u.anilist_connected
      FROM users u
      LEFT JOIN patreon_status ps
        ON ps.user_id = u.id
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("ADMIN USERS ERROR:", err);
    res.status(500).json({ error: "DB error" });
  }
});
/* ================= UPLOADERS ================= */
router.get("/uploaders", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name FROM uploader_names ORDER BY name`
    );
    res.json(rows.map(r => r.name));
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.post("/uploaders", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Hiányzó név" });
  try {
    await pool.query(
      `INSERT INTO uploader_names (name) VALUES ($1) ON CONFLICT DO NOTHING`,
      [name.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

/* ================= MANGA LIST ADMIN ================= */
router.get("/mangas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, slug FROM manga ORDER BY title`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

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
    res.status(500).json({ error: "DB error" });
  }
});

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
    res.status(500).json({ error: "DB error" });
  }
});

router.delete("/chapter/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM chapter WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = file.mimetype.split("/")[1].toLowerCase();
    cb(null, `cover-${Date.now()}.${ext}`);
  }
});
const coverUpload = multer({ storage: coverStorage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post("/manga/:slug/cover", coverUpload.single("cover"), async (req, res) => {
  const { slug } = req.params;
  if (!req.file) return res.status(400).json({ error: "Nincs fájl" });
  const filePath = `/uploads/${req.file.filename}`;
  try {
    await pool.query(`UPDATE manga SET cover_url = $1 WHERE slug = $2`, [filePath, slug]);
    res.json({ ok: true, cover_url: filePath });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.post("/manga/:slug/refresh-metadata", async (req, res) => {
  const { slug } = req.params;
  const { anilist_id } = req.body;
 
  try {
    const mangaRes = await pool.query(
      `SELECT id FROM manga WHERE slug = $1`, [slug]
    );
    if (!mangaRes.rows.length) return res.status(404).json({ error: "Not found" });
    const mangaId = mangaRes.rows[0].id;
 
if (anilist_id) {
      await pool.query(
        `UPDATE manga SET
          anilist_id     = $1,
          anilist_failed = FALSE,
          cover_url      = NULL,
          description    = NULL,
          status         = NULL,
          average_score  = NULL,
          total_chapters = NULL
         WHERE id = $2`,
        [anilist_id, mangaId]
      );
    } else {
      await pool.query(
        `UPDATE manga SET
          anilist_failed = FALSE,
          cover_url      = NULL,
          description    = NULL,
          status         = NULL,
          average_score  = NULL,
          total_chapters = NULL
         WHERE id = $1`, [mangaId]
      );
    } 
    // Közvetlen függvényhívás – nem spawn, megvárjuk az eredményt
    const result = await refreshMetadataForManga(mangaId, anilist_id || null);
 
    res.json({ ok: true, anilist_id: result.anilist_id, matched_title: result.title });
  } catch (err) {
    console.error("refresh-metadata error:", err);
    res.status(500).json({ error: err.message || "DB error" });
  }
});

/* ================= KÉPFELTÖLTÉS (blog) ================= */

const blogImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/blog";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = (file.mimetype.split("/")[1] || "jpg").toLowerCase();
    cb(null, `blog-${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`);
  }
});

const blogImageUpload = multer({
  storage: blogImageStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg","image/png","image/gif","image/webp"].includes(file.mimetype);
    cb(null, ok);
  }
});

router.post("/upload-image", blogImageUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nincs fájl vagy nem kép formátum" });
  res.json({ url: `/uploads/blog/${req.file.filename}`, name: req.file.filename });
});

/* ================= KÉPEK LISTÁZÁSA (uploads mappa) ================= */

router.get("/images", (req, res) => {
  const blogDir   = path.join(process.cwd(), "uploads", "blog");
  const imageExts = new Set([".jpg",".jpeg",".png",".gif",".webp"]);

  try {
    if (!fs.existsSync(blogDir)) {
      fs.mkdirSync(blogDir, { recursive: true });
      return res.json([]);
    }

    const files = fs.readdirSync(blogDir)
      .filter(f => imageExts.has(path.extname(f).toLowerCase()))
      .map(f => {
        const stat = fs.statSync(path.join(blogDir, f));
        return { name: f, url: `/uploads/blog/${f}`, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    res.json(files);
  } catch (err) {
    console.error("Images list error:", err);
    res.status(500).json({ error: "Hiba a fájlok listázásánál" });
  }
});

export default router;
