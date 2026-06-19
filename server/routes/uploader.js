import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { pool } from "../db.js";

const router = express.Router();
const BASE_DIR = "/mnt/manga/Kavita";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB / fájl
});

/* ── Auth middleware ────────────────────────────────────── */
function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Bejelentkezés szükséges" });
  next();
}

async function requireUploader(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Bejelentkezés szükséges" });
  try {
    const { rows } = await pool.query(
      `SELECT ps.tier, ps.uploader_root, u.can_upload
       FROM users u
       LEFT JOIN patreon_status ps ON ps.user_id = u.id
       WHERE u.id = $1 LIMIT 1`,
      [req.session.user.id]
    );
    const { tier, uploader_root, can_upload } = rows[0] || {};
    if (tier !== "Admin" && tier !== "Uploader" && !can_upload) {
      return res.status(403).json({ error: "Nincs feltöltési jogosultság" });
    }
    req.uploaderRoot = (uploader_root || req.session.user.username).replace(/\\/g, "/");
    next();
  } catch { return res.status(500).json({ error: "Auth hiba" }); }
}

/* ── Path security ──────────────────────────────────────── */
function safeUserPath(uploaderRoot, relativePath = "") {
  const userBase = uploaderRoot.startsWith("/")
    ? path.resolve(uploaderRoot)
    : path.join(BASE_DIR, uploaderRoot);
  const normalized = path.normalize(relativePath || "").replace(/^(\.\.[\\/])+/, "");
  const full = path.join(userBase, normalized);
  // Megakadályozza hogy a felhasználó kilépjen a saját mappájából
  if (!full.startsWith(userBase + path.sep) && full !== userBase) {
    return null;
  }
  return full;
}

/* ── GET /api/uploader/files?path= ─────────────────────── */
router.get("/files", requireUploader, async (req, res) => {
  const uploaderRoot = req.uploaderRoot;
  const relativePath = req.query.path || "";
  const fullPath = safeUserPath(uploaderRoot, relativePath);

  if (!fullPath) return res.status(400).json({ error: "Érvénytelen útvonal" });

  // Felhasználó mappájának automatikus létrehozása
  const userBase = uploaderRoot.startsWith("/")
    ? path.resolve(uploaderRoot)
    : path.join(BASE_DIR, uploaderRoot);
  if (!fs.existsSync(userBase)) {
    try { fs.mkdirSync(userBase, { recursive: true }); } catch {}
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "A mappa nem létezik" });
  }

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = entries.map(e => {
      const stat = fs.statSync(path.join(fullPath, e.name));
      return {
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        size: e.isDirectory() ? null : stat.size,
        modified: stat.mtime,
      };
    }).sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: relativePath, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── CF cache purge egy felülírt képre ──────────────────── */
async function purgeOverwrittenFile(fullPath, filename, chapter) {
  const CF_ZONE   = process.env.CF_ZONE_ID;
  const CF_TOKEN  = process.env.CF_API_TOKEN;
  const CF_DOMAIN = process.env.CF_DOMAIN || "https://padlizsanfansub.hu";
  if (!CF_ZONE || !CF_TOKEN || !chapter) return;

  try {
    const { rows } = await pool.query(`
      SELECT m.slug, l.name AS library_name
      FROM manga m
      JOIN library l ON l.id = m.library_id
      WHERE $1 LIKE (l.path || '/' || m.folder || '/%')
      LIMIT 1
    `, [fullPath]);

    if (!rows.length) return;
    const { slug, library_name } = rows[0];

    const url = `${CF_DOMAIN}/api/image/${encodeURIComponent(library_name)}/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}/${encodeURIComponent(filename)}`;
    await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: [url] })
    });
    console.log("[CF purge] felülírt kép:", url);
  } catch (err) {
    console.warn("[CF purge] hiba:", err.message);
  }
}

/* ── POST /api/uploader/upload ──────────────────────────── */
router.post("/upload", requireUploader, upload.single("file"), async (req, res) => {
  const uploaderRoot = req.uploaderRoot;
  const relativePath = req.body.path || "";

  if (!req.file) return res.status(400).json({ error: "Nincs fájl" });

  const fullPath = safeUserPath(uploaderRoot, relativePath);
  if (!fullPath) return res.status(400).json({ error: "Érvénytelen útvonal" });

  try {
    const wasOverwrite = fs.existsSync(fullPath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, req.file.buffer);

    if (wasOverwrite) {
      const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
      const filename = parts[parts.length - 1];
      const chapter  = parts.length >= 2 ? parts[parts.length - 2] : null;
      purgeOverwrittenFile(fullPath, filename, chapter).catch(() => {});
    }

    res.json({ ok: true, path: relativePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/uploader/check – meglévő fájlok ellenőrzése ─ */
router.post("/check", requireUploader, express.json(), async (req, res) => {
  const uploaderRoot = req.uploaderRoot;
  const paths = req.body.paths; // string[]
  if (!Array.isArray(paths)) return res.status(400).json({ error: "paths tömb szükséges" });

  const existing = paths.filter(rel => {
    const full = safeUserPath(uploaderRoot, rel);
    return full && fs.existsSync(full);
  });

  res.json({ existing });
});

/* ── DELETE /api/uploader/file ──────────────────────────── */
router.delete("/file", requireUploader, express.json(), async (req, res) => {
  const uploaderRoot = req.uploaderRoot;
  const relativePath = req.body.path || "";

  if (!relativePath) return res.status(400).json({ error: "Hiányzó útvonal" });

  const fullPath = safeUserPath(uploaderRoot, relativePath);
  if (!fullPath) return res.status(400).json({ error: "Érvénytelen útvonal" });

  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Nem található" });

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/uploader/mkdir ───────────────────────────── */
router.post("/mkdir", requireUploader, express.json(), async (req, res) => {
  const uploaderRoot = req.uploaderRoot;
  const relativePath = req.body.path || "";

  if (!relativePath) return res.status(400).json({ error: "Hiányzó útvonal" });

  const fullPath = safeUserPath(uploaderRoot, relativePath);
  if (!fullPath) return res.status(400).json({ error: "Érvénytelen útvonal" });

  try {
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
