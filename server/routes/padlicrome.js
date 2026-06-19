/* ============================================================
   routes/padlicrome.js - Manga fordító + projekt kezelés
   ============================================================ */

import express  from "express";
import bcrypt   from "bcrypt";
import jwt      from "jsonwebtoken";
import multer   from "multer";
import FormData from "form-data";
import fetch    from "node-fetch";
import sharp    from "sharp";
import fs       from "fs";
import path     from "path";
import { pool } from "../db.js";

const router = express.Router();

/* ── KONFIG ──────────────────────────────────────────────── */
const JWT_SECRET     = process.env.MANGA_JWT_SECRET;
const TRANSLATOR_URL = process.env.MANGA_TRANSLATOR_URL;
const PROJECT_ROOT   = "/mnt/manga2/padlicrome";
const MAX_IMAGES     = 30;
const MAX_FILE_SIZE  = 5 * 1024 * 1024;       // 5MB
const MAX_IMG_HEIGHT = 20000;                  // px - manhwa 2x ésszerű max
const MAX_IMG_WIDTH  = 10000;                  // px

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ── DIR HELPERS ─────────────────────────────────────────── */
const userDir       = id => path.join(PROJECT_ROOT, String(id));
const originalsDir  = id => path.join(userDir(id), "originals");
const translatedDir = id => path.join(userDir(id), "translated");
const mergedDir     = id => path.join(userDir(id), "merged");
const projectFile   = id => path.join(userDir(id), "project.json");

function ensureUserDirs(userId) {
  [userDir(userId), originalsDir(userId), translatedDir(userId), mergedDir(userId)]
    .forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function readProject(userId) {
  const f = projectFile(userId);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

function writeProject(userId, data) {
  fs.writeFileSync(projectFile(userId), JSON.stringify(data, null, 2));
}

/* ── DB HELPERS ──────────────────────────────────────────── */
async function getPoints(userId) {
  const r = await pool.query(
    "SELECT COALESCE(SUM(points) FILTER (WHERE spent = false), 0)::int AS points FROM user_points WHERE user_id = $1",
    [userId]
  );
  return r.rows[0]?.points ?? 0;
}

async function deductPoint(userId) {
  return pool.query(
    "INSERT INTO user_points (user_id, fix_id, points, approved_by, earned_at, spent) VALUES ($1, NULL, -1, NULL, NOW(), false)",
    [userId]
  );
}

async function isSubscriber(userId) {
  const r = await pool.query(
    "SELECT 1 FROM patreon_status WHERE user_id = $1 AND tier IS NOT NULL LIMIT 1",
    [userId]
  );
  return r.rows.length > 0;
}

/* ── AUTH: session VAGY JWT ──────────────────────────────── */
function requireAuth(req, res, next) {
  if (req.session?.user?.id) {
    req.authUser = { id: req.session.user.id, username: req.session.user.username };
    return next();
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Nem vagy bejelentkezve" });
  try {
    req.authUser = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Érvénytelen token" });
  }
}

/* ── CORS (addon) ─────────────────────────────────────────── */
router.use((req, res, next) => {
  const origin = req.headers.origin || "";
  if (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1")
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "X-Points-Remaining");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ── MULTER ───────────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|jpg|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Csak képfájl engedélyezett"));
  },
});

/* ── KÉP VALIDÁCIÓ ───────────────────────────────────────── */
async function validateAndConvertImage(buffer) {
  const meta = await sharp(buffer).metadata();
  if (meta.width > MAX_IMG_WIDTH || meta.height > MAX_IMG_HEIGHT) {
    throw new Error(`Túl nagy kép: ${meta.width}×${meta.height}px (max ${MAX_IMG_WIDTH}×${MAX_IMG_HEIGHT}px)`);
  }
  return await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
}

/* ── HTTP LETÖLTÉS REFERER-REL ───────────────────────────── */
async function downloadImage(url, refererOverride) {
  const referer = refererOverride || (new URL(url).origin + "/");
  const resp = await fetch(url, {
    headers: {
      "Referer": referer,
      "User-Agent": USER_AGENT,
      "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    },
    timeout: 20000,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} - ${url}`);
  const buf = await resp.buffer();
  if (buf.length > MAX_FILE_SIZE) throw new Error(`Túl nagy fájl: ${Math.round(buf.length/1024)}KB (max 5MB)`);
  return buf;
}

/* ── CHAPTER SCRAPER ─────────────────────────────────────── */
async function scrapeChapterImages(chapterUrl) {
  const parsed = new URL(chapterUrl);
  const host = parsed.hostname;

  // MangaDex
  if (host.includes("mangadex.org")) {
    return await scrapeMangaDex(chapterUrl);
  }

  // Általános WordPress manga scraper (arenascan, ravenscans, asurascans stb.)
  return await scrapeGenericWordPress(chapterUrl);
}

async function scrapeMangaDex(chapterUrl) {
  // Chapter UUID kinyerése: /chapter/UUID
  const match = chapterUrl.match(/\/chapter\/([a-f0-9-]{36})/i);
  if (!match) throw new Error("Nem találtam MangaDex chapter UUID-t az URL-ben");
  const chapterId = match[1];

  const apiUrl = `https://api.mangadex.org/at-home/server/${chapterId}`;
  const resp = await fetch(apiUrl, {
    headers: { "User-Agent": USER_AGENT },
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`MangaDex API hiba: ${resp.status}`);
  const data = await resp.json();

  if (data.result !== "ok") throw new Error("MangaDex API: nem OK válasz");

  const baseUrl = data.baseUrl;
  const hash = data.chapter.hash;
  const pages = data.chapter.data; // vagy dataSaver a kisebb méretért

  return pages.map(p => `${baseUrl}/data/${hash}/${p}`);
}

async function scrapeGenericWordPress(chapterUrl) {
  const resp = await fetch(chapterUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Referer": new URL(chapterUrl).origin + "/",
    },
    timeout: 15000,
  });

  if (!resp.ok) throw new Error(`Az oldal nem elérhető: HTTP ${resp.status}`);
  const html = await resp.text();

  // Képek kinyerése - több stratégia
  const imageUrls = new Set();

  // 1. div#readerarea vagy .reading-content img src-ek
  const readerMatch = html.match(/<div[^>]+(?:id="readerarea"|class="[^"]*reading-content[^"]*")[^>]*>([\s\S]*?)<\/div>/i);
  if (readerMatch) {
    const imgs = readerMatch[1].matchAll(/<img[^>]+src="([^"]+)"/gi);
    for (const m of imgs) {
      if (isImageUrl(m[1])) imageUrls.add(m[1]);
    }
  }

  // 2. data-src (lazy load)
  const dataSrcs = html.matchAll(/<img[^>]+data-src="([^"]+)"/gi);
  for (const m of dataSrcs) {
    if (isImageUrl(m[1])) imageUrls.add(m[1]);
  }

  // 3. wp-manga-chapter-img osztályú img-ek
  const wpImgs = html.matchAll(/class="[^"]*wp-manga-chapter-img[^"]*"[^>]*src="([^"]+)"/gi);
  for (const m of wpImgs) {
    if (isImageUrl(m[1])) imageUrls.add(m[1]);
  }

  // 4. Általános img src - CDN URL-ek szűrésével
  if (imageUrls.size === 0) {
    const allImgs = html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/gi);
    for (const m of allImgs) {
      if (isImageUrl(m[1]) && isCdnUrl(m[1], chapterUrl)) imageUrls.add(m[1]);
    }
  }

  if (imageUrls.size === 0) throw new Error("Nem találtam képeket az oldalon. Lehet hogy JavaScript-tel rendereli a képeket.");

  return [...imageUrls];
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url);
}

function isCdnUrl(imgUrl, pageUrl) {
  // Kiszűrjük a logókat, ikonokat, thumbnailokat
  if (/logo|icon|avatar|thumb|banner|ads|wp-content\/themes/i.test(imgUrl)) return false;
  // CDN vagy ugyanaz a domain
  try {
    const imgHost = new URL(imgUrl).hostname;
    const pageHost = new URL(pageUrl).hostname.replace(/^www\./, "");
    return imgHost.includes("cdn") || imgHost.includes(pageHost.split(".")[0]);
  } catch { return false; }
}

/* ── POST /login (addon visszakompatibilitás) ────────────── */
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Hiányzó adatok" });
  try {
    const { rows } = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1 OR email = $1 LIMIT 1",
      [username]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ error: "Hibás felhasználónév vagy jelszó" });
    const user = rows[0];
    const points = await getPoints(user.id);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, username: user.username, points });
  } catch (err) {
    console.error("[PADLICROME] login:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── GET /me ─────────────────────────────────────────────── */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const [points, subscriber, roleRes] = await Promise.all([
      getPoints(req.authUser.id),
      isSubscriber(req.authUser.id),
      pool.query("SELECT role FROM users WHERE id = $1", [req.authUser.id]),
    ]);
    const role = roleRes.rows[0]?.role || "user";
    res.json({ username: req.authUser.username, points, subscriber, role });
  } catch (err) {
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── POST /scrape - chapter URL → képek listája ──────────── */
router.post("/scrape", requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Hiányzó URL" });

  try {
    const imageUrls = await scrapeChapterImages(url);
    res.json({
      urls: imageUrls,
      count: imageUrls.length,
      tooMany: imageUrls.length > MAX_IMAGES,
    });
  } catch (err) {
    console.error("[PADLICROME] scrape:", err.message);
    res.status(422).json({ error: err.message });
  }
});

/* ── POST /upload - fájlfeltöltés ───────────────────────── */
router.post("/upload", requireAuth, upload.array("images", MAX_IMAGES), async (req, res) => {
  const userId = req.authUser.id;
  if (!req.files?.length) return res.status(400).json({ error: "Nincs kép" });

  ensureUserDirs(userId);
  const project = readProject(userId) || { images: [], createdAt: new Date().toISOString(), status: "ready" };
  const available = MAX_IMAGES - project.images.filter(i => i.id).length;
  if (available <= 0) return res.status(400).json({ error: `Maximum ${MAX_IMAGES} kép engedélyezett` });

  const added = [];
  for (const file of req.files.slice(0, available)) {
    try {
      const jpgBuf = await validateAndConvertImage(file.buffer);
      const id = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const filename = id + ".jpg";
      fs.writeFileSync(path.join(originalsDir(userId), filename), jpgBuf);
      const img = { id, filename, name: file.originalname, active: true, translated: false, merged: false };
      project.images.push(img);
      added.push(img);
    } catch (err) {
      console.error("[PADLICROME] upload error:", err.message);
    }
  }

  writeProject(userId, project);
  res.json({ added, total: project.images.filter(i => i.id).length });
});

/* ── POST /project/start - új projekt URL-ből ────────────── */
router.post("/project/start", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Hiányzó URL" });

  // Meglévő projekt törlése
  const existingProject = readProject(userId);
  if (existingProject) {
    const dir = userDir(userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  }

  ensureUserDirs(userId);

  // Scrape
  let imageUrls;
  try {
    imageUrls = await scrapeChapterImages(url);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const referer = new URL(url).origin + "/";
  const project = {
    sourceUrl: url,
    createdAt: new Date().toISOString(),
    images: [],
    status: "downloading",
    totalFound: imageUrls.length,
  };
  writeProject(userId, project);

  // Háttérben letöltjük a képeket (max 30)
  const toDownload = imageUrls.slice(0, MAX_IMAGES);
  res.json({
    ok: true,
    found: imageUrls.length,
    downloading: toDownload.length,
    tooMany: imageUrls.length > MAX_IMAGES,
  });

  // Aszinkron letöltés
  (async () => {
    for (const imgUrl of toDownload) {
      try {
        const buf = await downloadImage(imgUrl, referer);
        const jpgBuf = await validateAndConvertImage(buf);
        const id = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        const filename = id + ".jpg";
        fs.writeFileSync(path.join(originalsDir(userId), filename), jpgBuf);
        project.images.push({
          id,
          filename,
          name: path.basename(new URL(imgUrl).pathname),
          active: true,
          translated: false,
          merged: false,
          sourceUrl: imgUrl,
        });
        writeProject(userId, project);
      } catch (err) {
        console.error("[PADLICROME] dl error:", imgUrl, err.message);
        project.images.push({ id: null, error: err.message, sourceUrl: imgUrl });
        writeProject(userId, project);
      }
    }
    project.status = "ready";
    writeProject(userId, project);
  })();
});

/* ── GET /project - projekt állapot ─────────────────────── */
router.get("/project", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const project = readProject(userId);
  if (!project) return res.json(null);
  // Csak érvényes képek
  const images = (project.images || []).filter(i => i.id);
  res.json({ ...project, images });
});

/* ── DELETE /project ─────────────────────────────────────── */
router.delete("/project", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  try {
    const dir = userDir(userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Törlési hiba" });
  }
});

/* ── PATCH /image/:id - aktív/inaktív ───────────────────── */
router.patch("/image/:id", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const project = readProject(userId);
  if (!project) return res.status(404).json({ error: "Nincs projekt" });
  const img = project.images.find(i => i.id === req.params.id);
  if (!img) return res.status(404).json({ error: "Kép nem található" });
  img.active = req.body.active;
  writeProject(userId, project);
  res.json({ ok: true });
});

/* ── DELETE /image/:id ───────────────────────────────────── */
router.delete("/image/:id", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const project = readProject(userId);
  if (!project) return res.status(404).json({ error: "Nincs projekt" });
  const idx = project.images.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Nem található" });
  const img = project.images[idx];
  [originalsDir(userId), translatedDir(userId), mergedDir(userId)].forEach(d => {
    const f = path.join(d, img.filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  project.images.splice(idx, 1);
  writeProject(userId, project);
  res.json({ ok: true });
});

/* ── GET /image/:type/:filename ──────────────────────────── */
router.get("/image/:type/:filename", requireAuth, (req, res) => {
  const userId = req.authUser.id;
  const dirs = { originals: originalsDir(userId), translated: translatedDir(userId), merged: mergedDir(userId) };
  const dir = dirs[req.params.type];
  if (!dir) return res.status(400).end();
  const resolvedDir = path.resolve(dir);
  const filePath = path.resolve(path.join(resolvedDir, req.params.filename));
  if (!filePath.startsWith(resolvedDir + path.sep)) return res.status(403).end();
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.setHeader("Content-Type", "image/jpeg");
  res.sendFile(filePath);
});

/* ── POST /translate/:id ─────────────────────────────────── */
router.post("/translate/:id", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const project = readProject(userId);
  if (!project) return res.status(404).json({ error: "Nincs projekt" });
  const img = project.images.find(i => i.id === req.params.id);
  if (!img) return res.status(404).json({ error: "Kép nem található" });

  const points = await getPoints(userId);
  if (points < 1) return res.status(402).json({ error: "Nincs elég pont" });

  img.translating = true;
  writeProject(userId, project);

  try {
    const origPath = path.join(originalsDir(userId), img.filename);
    if (!fs.existsSync(origPath)) return res.status(404).json({ error: "Eredeti kép hiányzik" });

    const form = new FormData();
    form.append("image", fs.createReadStream(origPath), { filename: img.filename, contentType: "image/jpeg" });

    const translateRes = await fetch(`${TRANSLATOR_URL}/translate/with-form/image`, {
      method: "POST", body: form, headers: form.getHeaders(), timeout: 180000,
    });

    if (!translateRes.ok) {
      img.translating = false;
      writeProject(userId, project);
      return res.status(502).json({ error: "Fordítási hiba" });
    }

    const pngBuf = await translateRes.buffer();
    const jpgBuf = await sharp(pngBuf).jpeg({ quality: 92 }).toBuffer();
    fs.writeFileSync(path.join(translatedDir(userId), img.filename), jpgBuf);

    await deductPoint(userId);
    const newPoints = points - 1;

    img.translated = true;
    img.translating = false;
    img.translatedAt = new Date().toISOString();
    writeProject(userId, project);

    res.json({ ok: true, filename: img.filename, pointsRemaining: newPoints });
  } catch (err) {
    img.translating = false;
    writeProject(userId, project);
    console.error("[PADLICROME] translate:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── POST /merge - összefűzés (előfizető, min 2, max 25) ── */
router.post("/merge", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  if (!(await isSubscriber(userId)))
    return res.status(403).json({ error: "Csak előfizetőknek érhető el" });

  const { imageIds } = req.body || {};
  if (!imageIds?.length) return res.status(400).json({ error: "Nincs kijelölt kép" });
  if (imageIds.length < 2) return res.status(400).json({ error: "Legalább 2 kép kell az összefűzéshez" });
  if (imageIds.length > 25) return res.status(400).json({ error: "Maximum 25 képet lehet összefűzni" });

  const project = readProject(userId);
  if (!project) return res.status(404).json({ error: "Nincs projekt" });

  try {
    const images = imageIds.map(id => project.images.find(i => i.id === id)).filter(Boolean);
    if (images.length < 2) return res.status(400).json({ error: "Érvénytelen képek" });

    let maxWidth = 0;
    const metas = [];
    for (const img of images) {
      const transPath = path.join(translatedDir(userId), img.filename);
      const origPath  = path.join(originalsDir(userId), img.filename);
      const filePath  = fs.existsSync(transPath) ? transPath : origPath;
      if (!fs.existsSync(filePath)) continue;
      const meta = await sharp(filePath).metadata();
      if (meta.width > maxWidth) maxWidth = meta.width;
      metas.push({ filePath, width: meta.width, height: meta.height });
    }

    if (!metas.length) return res.status(400).json({ error: "Nincs érvényes kép" });

    const resized = [];
    let totalHeight = 0;
    for (const m of metas) {
      let buf, h;
      if (m.width !== maxWidth) {
        h = Math.round(m.height * maxWidth / m.width);
        buf = await sharp(m.filePath).resize(maxWidth, h).jpeg({ quality: 92 }).toBuffer();
      } else {
        buf = fs.readFileSync(m.filePath);
        h = m.height;
      }
      resized.push({ buf, h });
      totalHeight += h;
    }

    const composite = [];
    let y = 0;
    for (const r of resized) {
      composite.push({ input: r.buf, left: 0, top: y });
      y += r.h;
    }

    const mergedBuf = await sharp({
      create: { width: maxWidth, height: totalHeight, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).composite(composite).jpeg({ quality: 92 }).toBuffer();

    const mergedId = Date.now() + "_merged";
    const mergedFilename = mergedId + ".jpg";
    fs.writeFileSync(path.join(mergedDir(userId), mergedFilename), mergedBuf);

    const mergedImg = {
      id: mergedId, filename: mergedFilename,
      name: `merged_${images.length}x.jpg`,
      active: true, translated: false, merged: true,
      mergedFrom: imageIds,
    };
    project.images.push(mergedImg);
    imageIds.forEach(id => {
      const img = project.images.find(i => i.id === id);
      if (img) img.active = false;
    });
    writeProject(userId, project);
    res.json({ ok: true, image: mergedImg });
  } catch (err) {
    console.error("[PADLICROME] merge:", err);
    res.status(500).json({ error: "Összefűzési hiba" });
  }
});

/* ── GET /download/:type/:filename ──────────────────────── */
router.get("/download/:type/:filename", requireAuth, (req, res) => {
  const userId = req.authUser.id;
  const dirs = { originals: originalsDir(userId), translated: translatedDir(userId), merged: mergedDir(userId) };
  const dir = dirs[req.params.type];
  if (!dir) return res.status(400).end();
  const filePath = path.join(dir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.download(filePath);
});

/* ── POST /translate (addon - régi kompatibilitás) ───────── */
router.post("/translate", requireAuth, upload.single("image"), async (req, res) => {
  const userId = req.authUser.id;

  let imageBuffer;
  if (req.file) {
    imageBuffer = req.file.buffer;
  } else if (req.body?.imageUrl) {
    try {
      const originUrl = new URL(req.body.imageUrl).origin + "/";
      const buf = await downloadImage(req.body.imageUrl, originUrl);
      imageBuffer = buf;
    } catch (err) {
      return res.status(400).json({ error: "Kép letöltési hiba: " + err.message });
    }
  } else {
    return res.status(400).json({ error: "Hiányzó kép" });
  }

  const points = await getPoints(userId);
  if (points < 1) return res.status(402).json({ error: "Nincs elég pont" });

  try {
    const form = new FormData();
    form.append("image", imageBuffer, { filename: "image.jpg", contentType: "image/jpeg" });
    const translateRes = await fetch(`${TRANSLATOR_URL}/translate/with-form/image`, {
      method: "POST", body: form, headers: form.getHeaders(), timeout: 180000,
    });
    if (!translateRes.ok) return res.status(502).json({ error: "Fordítási hiba" });
    await deductPoint(userId);
    const imageData = await translateRes.buffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Points-Remaining", points - 1);
    res.send(imageData);
  } catch (err) {
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── POST /import-bug-image – bug kép importálása admin projektjébe ── */
router.post("/import-bug-image", requireAuth, async (req, res) => {
  try {
    const userId = req.authUser.id;

    let { imageUrl, reportId, mangaSlug, chapter, imageIndex, imageFile, mangaTitle } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl kötelező" });

    ensureUserDirs(userId);

    // imageUrl lehet relatív (/api/image/...) vagy abszolút
    let jpgBuf;
    const localMatch = imageUrl.match(/^\/api\/image\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (localMatch) {
      // Direkt fájlrendszer olvasás a DB-ből
      const [, library, slug, chapterFolder, file] = localMatch;
      const decodedFile = decodeURIComponent(file);
      // URL-ből auto-kitöltés ha a body-ból hiányzik
      if (!mangaSlug) mangaSlug = slug;
      if (!chapter) chapter = chapterFolder;
      if (!imageFile) imageFile = decodedFile;
      const { rows } = await pool.query(
        `SELECT l.path AS library_path, m.folder AS manga_folder
         FROM chapter c
         JOIN manga m ON m.id = c.manga_id
         JOIN library l ON l.id = m.library_id
         WHERE l.name = $1 AND m.slug = $2 AND c.folder = $3
         LIMIT 1`,
        [library, slug, chapterFolder]
      );
      if (!rows.length) return res.status(404).json({ error: "Kép nem található az adatbázisban" });
      const { library_path, manga_folder } = rows[0];
      const imgPath = path.resolve(path.join(library_path, manga_folder, chapterFolder, decodedFile));
      if (!fs.existsSync(imgPath)) return res.status(404).json({ error: "Képfájl nem található: " + imgPath });
      const buf = fs.readFileSync(imgPath);
      jpgBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
    } else {
      // Abszolút URL — HTTP letöltés
      const buf = await downloadImage(imageUrl);
      jpgBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
    }

    const id = Date.now() + "_bugfix";
    const filename = id + ".jpg";
    fs.writeFileSync(path.join(originalsDir(userId), filename), jpgBuf);

    const project = readProject(userId) || { images: [], createdAt: new Date().toISOString(), status: "ready" };
    // Ellenőrzés: már be van-e töltve ez a reportId
    if (reportId && project.images.some(i => i.bugFix?.reportId === String(reportId))) {
      return res.json({ ok: true, alreadyAdded: true });
    }
    project.images.push({
      id, filename,
      name: `${mangaSlug || "bug"} ${chapter || ""} #${imageIndex ?? imageFile ?? "?"}`,
      active: true, translated: false, merged: false,
      bugFix: { reportId: String(reportId || ""), mangaSlug, chapter, imageIndex, imageFile, mangaTitle, library: localMatch ? localMatch[1] : null },
    });
    writeProject(userId, project);

    res.json({ ok: true, imageId: id });
  } catch (err) {
    console.error("[PADLICROME] import-bug-image:", err);
    res.status(500).json({ error: "Kép importálási hiba: " + err.message });
  }
});

/* ── POST /import-chapter – egész fejezet importálása ──────── */
router.post("/import-chapter", requireAuth, async (req, res) => {
  try {
    const userId = req.authUser.id;
    const { mangaSlug, chapter } = req.body;
    if (!mangaSlug || !chapter) return res.status(400).json({ error: "mangaSlug és chapter kötelező" });

    ensureUserDirs(userId);

    const { rows } = await pool.query(`
      SELECT l.name AS library_name, l.path AS library_path, m.folder AS manga_folder
      FROM manga m JOIN library l ON l.id = m.library_id
      WHERE m.slug = $1 LIMIT 1
    `, [mangaSlug]);
    if (!rows.length) return res.status(404).json({ error: "Manga nem található" });
    const { library_name, library_path, manga_folder } = rows[0];

    const chapterDir = path.join(library_path, manga_folder, chapter);
    if (!fs.existsSync(chapterDir)) return res.status(404).json({ error: "Fejezet mappa nem található" });

    const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
    const files = fs.readdirSync(chapterDir)
      .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .sort();

    const project = readProject(userId) || { images: [], createdAt: new Date().toISOString(), status: "ready" };

    let added = 0, skipped = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (project.images.some(img =>
        img.bugFix?.imageFile === file &&
        img.bugFix?.mangaSlug === mangaSlug &&
        img.bugFix?.chapter === chapter
      )) { skipped++; continue; }

      const buf = fs.readFileSync(path.join(chapterDir, file));
      const jpgBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
      const id = `${Date.now()}_${i}_ch`;
      const filename = id + ".jpg";
      fs.writeFileSync(path.join(originalsDir(userId), filename), jpgBuf);

      project.images.push({
        id, filename,
        name: `${mangaSlug} ${chapter} #${i + 1}`,
        active: true, translated: false, merged: false,
        bugFix: { reportId: "", mangaSlug, chapter, imageIndex: i, imageFile: file, mangaTitle: null, library: library_name },
      });
      added++;
    }
    writeProject(userId, project);
    res.json({ ok: true, added, skipped, total: files.length });
  } catch (err) {
    console.error("[PADLICROME] import-chapter:", err);
    res.status(500).json({ error: "Fejezet importálási hiba: " + err.message });
  }
});

/* ── POST /submit-bug-fix – lefordított kép mentése javításként ── */
router.post("/submit-bug-fix", requireAuth, async (req, res) => {
  try {
    const userId = req.authUser.id;

    const { rows: uRows } = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
    const username = uRows[0].username;

    const { imageId } = req.body;
    if (!imageId) return res.status(400).json({ error: "imageId kötelező" });

    const project = readProject(userId);
    if (!project) return res.status(404).json({ error: "Nincs projekt" });

    const img = project.images.find(i => i.id === imageId);
    if (!img) return res.status(404).json({ error: "Kép nem található a projektben" });
    if (!img.bugFix) return res.status(400).json({ error: "Ez a kép nem bugfix kép" });

    const { mangaSlug, chapter, imageIndex, imageFile, library } = img.bugFix;
    const provider = library || "unknown";

    // Fordított verzió preferált, ha nincs akkor az eredeti
    const translatedPath = path.join(translatedDir(userId), img.filename);
    const originalPath   = path.join(originalsDir(userId), img.filename);
    const srcPath = fs.existsSync(translatedPath) ? translatedPath : originalPath;
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: "Forráskép nem található" });

    let fixId = null;
    let fixedImageUrl = null;

    if (mangaSlug && chapter) {
      // Cél: uploads/bugs/javitott/{mangaSlug}/{chapter}/
      const fixedDir = path.join(process.cwd(), "uploads", "bugs", "javitott", mangaSlug, chapter);
      fs.mkdirSync(fixedDir, { recursive: true });

      const targetFilename = imageFile || img.filename;
      const destPath = path.join(fixedDir, targetFilename);
      fs.copyFileSync(srcPath, destPath);

      fixedImageUrl = `/uploads/bugs/javitott/${mangaSlug}/${chapter}/${targetFilename}`;

      // bug_fixes INSERT
      const imgIdx = imageIndex != null ? parseInt(imageIndex) : 0;
      const imgFile = imageFile || targetFilename;
      const { rows: fixRows } = await pool.query(`
        INSERT INTO bug_fixes
          (provider, manga_slug, chapter, image_index, image_file, fixed_image_url, fixed_by, fixed_by_name, fixed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (manga_slug, chapter, image_index, fixed_by)
        DO UPDATE SET fixed_image_url = EXCLUDED.fixed_image_url, fixed_at = NOW()
        RETURNING id
      `, [provider, mangaSlug, chapter, imgIdx, imgFile, fixedImageUrl, userId, username]);
      fixId = fixRows[0]?.id;
    }

    img.submittedAsFix = true;
    writeProject(userId, project);

    res.json({ ok: true, fixId, fixedImageUrl, noMeta: !mangaSlug || !chapter });
  } catch (err) {
    console.error("[PADLICROME] submit-bug-fix:", err);
    res.status(500).json({ error: "Szerver hiba: " + err.message });
  }
});

/* ── GET /fix-status – ellenőrzi melyik bugfix kép már javítva/lezárva ── */
router.get("/fix-status", requireAuth, async (req, res) => {
  try {
    const userId = req.authUser.id;
    const project = readProject(userId);
    if (!project) return res.json({ alreadyFixed: [] });

    const bugImgs = project.images.filter(i => i.bugFix && !i.submittedAsFix);
    if (!bugImgs.length) return res.json({ alreadyFixed: [] });

    const alreadyFixed = [];
    for (const img of bugImgs) {
      const { reportId, mangaSlug, chapter, imageIndex, mangaTitle } = img.bugFix;
      let fixed = false;
      // 1) Bug report lezárva?
      if (reportId && parseInt(reportId)) {
        const { rows } = await pool.query(
          `SELECT is_closed FROM bug_reports WHERE id = $1`, [parseInt(reportId)]
        );
        if (rows[0]?.is_closed) fixed = true;
      }
      // 2) Van már elfogadott javítás?
      if (!fixed && mangaSlug && chapter && imageIndex != null) {
        const { rows } = await pool.query(
          `SELECT id FROM bug_fixes WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 AND is_applied=true LIMIT 1`,
          [mangaSlug, chapter, parseInt(imageIndex)]
        );
        if (rows.length) fixed = true;
      }
      if (fixed) {
        alreadyFixed.push({
          imageId: img.id,
          label: `${mangaTitle || mangaSlug || "?"} – ${chapter || "?"}`,
        });
      }
    }
    res.json({ alreadyFixed });
  } catch (err) {
    console.error("[PADLICROME] fix-status:", err);
    res.json({ alreadyFixed: [] });
  }
});

export default router;
