import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { pool } from "../db.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { localPathToR2Key } from "../r2.js";
import { requestScan, getScanStatus } from "../lib/scan-runner.js";
import { findExistingSeries } from "../lib/manga-duplicates.js";
import { logSecurityEvent } from "../lib/security-log.js";
import { isImageBuffer } from "../lib/safe-path.js";
import { compressPageImage } from "../lib/image-compress.js";
import { updateMangaCore } from "../lib/manga-meta.js";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

async function uploadToR2(fullPath, buffer) {
  const ext = path.extname(fullPath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return;
  const key = localPathToR2Key(fullPath);
  const contentType = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
    ".gif": "image/gif", ".avif": "image/avif",
  }[ext] ?? "application/octet-stream";
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

// R2 sync sor: max 2 egyidejű feltöltés, többi várakozik
const r2SyncQueue = [];
let r2SyncActive = 0;
const R2_SYNC_CONCURRENCY = 2;

// A scan.js által indított teljes-könyvtár migráció (migrate-to-r2.js) ezt a
// lock fájlt tartja fenn, amíg fut. Amíg él, itt nem indítunk új feltöltést,
// hogy a két folyamat ne terhelje egyszerre a memóriát/hálózatot.
const R2_MIGRATE_LOCK = "/tmp/padlizsanfansub.r2migrate.lock";

function enqueueR2Sync(task) {
  r2SyncQueue.push(task);
  drainR2Queue();
}

function drainR2Queue() {
  if (fs.existsSync(R2_MIGRATE_LOCK)) return; // migrate-to-r2.js fut, várunk
  while (r2SyncActive < R2_SYNC_CONCURRENCY && r2SyncQueue.length > 0) {
    const task = r2SyncQueue.shift();
    r2SyncActive++;
    task().finally(() => {
      r2SyncActive--;
      drainR2Queue();
    });
  }
}

// Ha a migráció lock-ja miatt állt meg a sor, új feltöltés hiányában is
// induljon újra, amint a lock felszabadul.
setInterval(drainR2Queue, 10_000);

const router = express.Router();
const BASE_DIR = "/mnt/manga/Kavita";

// Feltöltés kikapcsolása (pl. szerverköltözéskor): ha a jelzőfájl létezik,
// a fájlokat módosító végpontok 423-at adnak (a kliens 4xx-nél nem próbálja
// újra, a hibaüzenetet kiírja). A fájl az /opt/padli-n KÍVÜL van, így a
// kód-/adatszinkron nem viszi át egy másik gépre.
const UPLOAD_DISABLED_FLAG = "/etc/padli/upload-disabled";
const UPLOAD_WRITE_PATHS = new Set(["/upload", "/mkdir", "/file", "/scan"]);
router.use((req, res, next) => {
  if (req.method === "GET" || !UPLOAD_WRITE_PATHS.has(req.path)) return next();
  if (!fs.existsSync(UPLOAD_DISABLED_FLAG)) return next();
  res.status(423).json({ error: "A feltöltés átmenetileg szünetel (szerverköltözés). Próbáld újra később." });
});

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

/* ── Fejezet-mappa a gyökérben tiltva (ch015, ch15, chapter15, chapters, stb.) ── */
const CHAPTER_FOLDER_RE = /^(chapters?|ch)[\s._-]*\d*$/i;

/* ── Már fent lévő mű új néven ──────────────────────────────
   Új sorozat-mappa (a feltöltő gyökerében még nem létező mappa) csak
   akkor jöhet létre, ha a mű nincs még fent. Ha más feltöltő tölti,
   tiltjuk (más mappájába sem tölthet); ha a saját, más nevű mappája,
   oda kerül. Ha a feltöltő jelzi, hogy ez egy teljesen másik mű (force),
   újként mehet — kivéve, ha a mappanév slugja már foglalt (2026-10-16).
   Az eredményt mappanevenként 10 percig megjegyezzük, hogy
   ne fusson AniList-keresés minden egyes fájlnál. ── */
const seriesCheckCache = new Map(); // `${userBase}\n${folder}` -> { at, result }
const SERIES_CHECK_TTL = 10 * 60e3;

function userBaseOf(uploaderRoot) {
  return uploaderRoot.startsWith("/") ? path.resolve(uploaderRoot) : path.join(BASE_DIR, uploaderRoot);
}

async function checkSeriesCached(userBase, folder) {
  const key = `${userBase}\n${folder}`;
  const hit = seriesCheckCache.get(key);
  if (hit && Date.now() - hit.at < SERIES_CHECK_TTL) return hit.result;
  const result = await findExistingSeries(folder, userBase);
  seriesCheckCache.set(key, { at: Date.now(), result });
  for (const [k, v] of seriesCheckCache) if (Date.now() - v.at > SERIES_CHECK_TTL) seriesCheckCache.delete(k);
  return result;
}

function seriesBlockMessage(folder, found) {
  if (found.own && found.ownFolder) {
    return `„${folder}” már fent van nálad „${found.ownFolder}” néven (${found.title}) — abba a mappába töltsd fel.`;
  }
  const who = found.others.map(o => o.library).join(", ") || "más feltöltő";
  return `„${folder}” már fent van az oldalon „${found.title}” néven (${found.chapters} rész, feltöltő: ${who}). Más feltöltő sorozatát nem töltheted fel.`;
}

// A scan a mappanévből képzett slug alapján köti a fejezeteket a műhöz
// (server/scan.js slugify) — ha a slug már foglalt, a „másik mű” is a
// meglévőhöz kerülne, ezért ilyenkor át kell nevezni a mappát.
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
async function slugTaken(folder) {
  const { rowCount } = await pool.query(`SELECT 1 FROM manga WHERE slug = $1 LIMIT 1`, [slugify(folder)]);
  return rowCount > 0;
}

// „Ez egy másik mű” jelzések naplózása (fájlonként is jön a kérés → egyszer/óra/mappa)
const overrideLogged = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, at] of overrideLogged) if (now - at > 3600e3) overrideLogged.delete(k);
}, 3600e3).unref();
function logSeriesOverride(req, folder, found) {
  const key = `${req.session.user.id}\n${folder}`;
  const prev = overrideLogged.get(key);
  if (prev && Date.now() - prev < 3600e3) return;
  overrideLogged.set(key, Date.now());
  logSecurityEvent({
    req, type: "upload_series_override", severity: "info",
    details: { folder, matchedTitle: found.title, matchedMangaId: found.mangaId, matchedBy: found.matchedBy,
               uploaders: found.others.map(o => o.library) },
  });
}

// null = mehet; különben a 409-es válasz törzse
async function checkNewSeriesFolder(req, relativePath, { isFolder }) {
  const parts = String(relativePath || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || (!isFolder && parts.length < 2)) return null; // gyökérbe tett fájl
  const folder = parts[0];
  const userBase = userBaseOf(req.uploaderRoot);
  if (fs.existsSync(path.join(userBase, folder))) return null; // meglévő mappa
  let found;
  try {
    found = await checkSeriesCached(userBase, folder);
  } catch (err) {
    console.warn("[duplikátum-ellenőrzés] hiba:", err.message);
    return null; // ellenőrzési hiba miatt ne álljon le a feltöltés
  }
  if (!found) return null;
  // Saját sorozat, de a helyi mappája nem található → a saját művét ne tiltsuk
  if (found.own && !found.ownFolder) return null;
  // „Ez egy teljesen másik mű, újként töltöm fel” — bárki jelezheti, ha a
  // mappanév nem ütközik egy meglévő mű slugjával (különben a scan úgyis a
  // meglévőhöz kötné). Naplózzuk, hogy visszaélés esetén látszódjon.
  const nameClash = await slugTaken(folder);
  const force = req.body?.force === true || req.body?.force === "1";
  if (force && !nameClash) {
    logSeriesOverride(req, folder, found);
    return null;
  }
  return {
    error: seriesBlockMessage(folder, found),
    code: "series_exists",
    folder,
    series: found,
    canOverride: !nameClash,
    nameClash,
  };
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

/* ── Manga megkeresése egy fizikai fájlútvonalból ──────────
   Egy manga mappaneve TÖBB különböző könyvtár (uploader root)
   alatt is előfordulhat (pl. Ascyra ÉS Stukker mappájában is
   van "Tomb Raider King" alkönyvtár, mert a fejezetek szét
   vannak osztva köztük) — ezért NEM szabad a manga saját,
   "otthoni" library_id-jére szűrni. Előbb megkeressük, melyik
   library alá esik a fájl (path-prefix egyezés), utána a
   library ALATTI mappanév alapján a mangát (nem a manga rögzített
   library_id-je alapján). ── */
async function findMangaForPath(fullPath) {
  const { rows: libRows } = await pool.query(
    `SELECT id, path, name FROM library WHERE $1 LIKE (path || '/%') ORDER BY length(path) DESC LIMIT 1`,
    [fullPath]
  );
  if (!libRows.length) return null;
  const lib = libRows[0];
  const rel = fullPath.slice(lib.path.length + 1);
  const mangaFolder = rel.split("/")[0];
  if (!mangaFolder) return null;

  const { rows: mangaRows } = await pool.query(
    `SELECT slug, r2_migrated FROM manga WHERE folder = $1 LIMIT 1`,
    [mangaFolder]
  );
  if (!mangaRows.length) return null;
  return { slug: mangaRows[0].slug, r2_migrated: mangaRows[0].r2_migrated, library_name: lib.name };
}

/* ── CF cache purge egy felülírt képre ──────────────────── */
async function purgeOverwrittenFile(fullPath, filename, chapter) {
  const CF_ZONE   = process.env.CF_ZONE_ID;
  const CF_TOKEN  = process.env.CF_API_TOKEN;
  const CF_DOMAIN = process.env.CF_DOMAIN || "http://localhost:3000";
  if (!CF_ZONE || !CF_TOKEN || !chapter) return;

  try {
    const found = await findMangaForPath(fullPath);
    if (!found) return;
    const { slug, library_name } = found;

    const base = `${CF_DOMAIN}/api/image/${encodeURIComponent(library_name)}/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}/${encodeURIComponent(filename)}`;
    // Mindkét URL-t töröljük: alap és ?r2=1-es (CF ezeket külön cache-eli)
    await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: [base, `${base}?r2=1`] })
    });
    console.log("[CF purge] felülírt kép:", base);
  } catch (err) {
    console.warn("[CF purge] hiba:", err.message);
  }
}

/* ── R2 upload ha a manga már migrált (sorba rendezve) ─── */
function syncToR2IfMigrated(fullPath, buffer) {
  const ext = path.extname(fullPath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return;
  enqueueR2Sync(async () => {
    try {
      const found = await findMangaForPath(fullPath);
      if (!found || !found.r2_migrated) return;
      await uploadToR2(fullPath, buffer);
      console.log("[R2 sync] feltöltve:", fullPath);
    } catch (err) {
      console.warn("[R2 sync] hiba:", err.message);
    }
  });
}

/* ── POST /api/uploader/upload ──────────────────────────── */
router.post("/upload", requireUploader, upload.single("file"), async (req, res) => {
  const uploaderRoot = req.uploaderRoot;
  const relativePath = req.body.path || "";

  if (!req.file) return res.status(400).json({ error: "Nincs fájl" });

  const topFolder = relativePath.replace(/\\/g, "/").split("/").filter(Boolean)[0];
  if (topFolder && CHAPTER_FOLDER_RE.test(topFolder)) {
    return res.status(400).json({
      error: `"${topFolder}" nevű mappa nem hozható létre a gyökérben — ez fejezet-mappának tűnik, egy manga/sorozat mappáján belül kell lennie.`,
    });
  }

  const fullPath = safeUserPath(uploaderRoot, relativePath);
  if (!fullPath) return res.status(400).json({ error: "Érvénytelen útvonal" });

  // Csak kép tölthető fel: a fejezetmappák tartalmát az /api/image saját
  // originről szolgálja ki, egy feltöltött .html/.svg ott szkriptként futna
  if (!IMAGE_EXTS.has(path.extname(fullPath).toLowerCase()) || !(await isImageBuffer(req.file.buffer))) {
    return res.status(415).json({ error: "Csak képfájl tölthető fel (jpg, png, webp, gif, avif)" });
  }

  const blocked = await checkNewSeriesFolder(req, relativePath, { isFolder: false });
  if (blocked) return res.status(409).json(blocked);

  try {
    const wasOverwrite = fs.existsSync(fullPath);

    // JPEG-tömörítés (a fájlnév marad); hiba esetén az eredeti buffer jön vissza
    const { buffer } = await compressPageImage(req.file.buffer, fullPath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buffer);

    // R2 sync: sorba rendezve, max 2 egyidejű feltöltés
    syncToR2IfMigrated(fullPath, buffer);

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

/* ── POST /api/uploader/scan – scan a sikeres feltöltés után ───────
   A kliens akkor hívja, ha a feltöltési sor minden fájlja hibátlanul
   felment. Ha már fut scan, a kérés sorba áll (és összevonódik), így
   sok egyszerre végző feltöltő sem indít párhuzamos scaneket.
   A requestedAt szerveridő: a kliens ehhez viszonyítva dönti el, hogy
   a kérése UTÁN indult scan befejeződött-e (a scan-status alapján). ── */
router.post("/scan", requireUploader, (req, res) => {
  try {
    const requestedAt = new Date();
    const state = requestScan();
    console.log(`🔄 Feltöltés utáni scan kérés: ${req.session.user.username} (${state})`);
    res.json({ ok: true, state, requestedAt });
  } catch (err) {
    console.error("❌ Feltöltés utáni scan hiba:", err);
    res.status(500).json({ error: "Nem sikerült elindítani a scant" });
  }
});

router.get("/scan-status", requireUploader, (req, res) => {
  res.json(getScanStatus());
});

/* ── GET /api/uploader/speedtest/ping – kör-idő (latency) mérés ─── */
router.get("/speedtest/ping", requireUploader, (req, res) => {
  res.json({ ok: true, t: Date.now() });
});

/* ── POST /api/uploader/speedtest/upload – feltöltési sávszélesség
   mérés. A kapott adatot NEM írjuk lemezre, csak eldobjuk — kizárólag
   az átvitel időzítésére kell a kliens oldalon. ── */
const speedtestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
router.post("/speedtest/upload", requireUploader, speedtestUpload.single("blob"), (req, res) => {
  res.json({ ok: true, receivedBytes: req.file?.size || 0 });
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

/* ── POST /api/uploader/check-series – új mappák előzetes ellenőrzése ─
   A kliens a feltöltés előtt kérdezi meg, hogy az új sorozat-mappák
   közül melyik mű van már fent (ugyanaz a szabály, mint az /upload-ban). */
router.post("/check-series", requireUploader, express.json(), async (req, res) => {
  const folders = Array.isArray(req.body?.folders) ? req.body.folders.slice(0, 50) : [];
  const results = [];
  for (const f of folders) {
    const blocked = await checkNewSeriesFolder(req, String(f), { isFolder: true });
    if (blocked) results.push(blocked);
  }
  res.json({ blocked: results });
});

/* ── POST /api/uploader/mkdir ───────────────────────────── */
router.post("/mkdir", requireUploader, express.json(), async (req, res) => {
  const uploaderRoot = req.uploaderRoot;
  const relativePath = req.body.path || "";

  if (!relativePath) return res.status(400).json({ error: "Hiányzó útvonal" });

  const segments = path.normalize(relativePath).split(/[\\/]/).filter(Boolean);
  const folderName = segments[segments.length - 1] || "";
  if (segments.length === 1 && CHAPTER_FOLDER_RE.test(folderName)) {
    return res.status(400).json({
      error: `"${folderName}" nevű mappa nem hozható létre a gyökérben — ez fejezet-mappának tűnik, egy manga/sorozat mappáján belül kell létrehozni.`,
    });
  }

  const fullPath = safeUserPath(uploaderRoot, relativePath);
  if (!fullPath) return res.status(400).json({ error: "Érvénytelen útvonal" });

  const blocked = await checkNewSeriesFolder(req, relativePath, { isFolder: true });
  if (blocked) return res.status(409).json(blocked);

  try {
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/uploader/my-manga — saját feltöltött mangák listája ── */
router.get("/my-manga", requireUploader, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, title, cover_url FROM manga
       WHERE $1 = ANY(uploaders) ORDER BY title`,
      [req.session.user.username]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

/* ── Manga adatlap szerkesztése — csak a saját (uploaders listában szereplő)
   mangákra, és csak cím/leírás/borító/műfaj/címke (nem státusz, AniList-link,
   uploaders-lista vagy törlés — azok admin-csak jogkörben maradnak). ── */
async function loadEditableManga(req, res, next) {
  const { slug } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.uploaders FROM manga m
       LEFT JOIN chapter c ON c.manga_id = m.id
       WHERE m.slug = $1
       GROUP BY m.id
       ORDER BY COUNT(DISTINCT c.id) DESC, m.id ASC
       LIMIT 1`,
      [slug]
    );
    if (!rows.length) return res.status(404).json({ error: "Nem található" });
    const manga = rows[0];
    const isOwner = (manga.uploaders || []).includes(req.session.user.username);
    if (req.session.user.role !== "admin" && !isOwner) {
      return res.status(403).json({ error: "Csak a saját feltöltött mangáid adatlapját szerkesztheted" });
    }
    req.editableMangaId = manga.id;
    next();
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
}

router.get("/manga/:slug", requireUploader, loadEditableManga, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.title, m.description, m.cover_url,
              COALESCE(array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres,
              COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
       FROM manga m
       LEFT JOIN manga_genre mg ON mg.manga_id = m.id
       LEFT JOIN genre g ON g.id = mg.genre_id
       LEFT JOIN manga_tag mt ON mt.manga_id = m.id
       LEFT JOIN tag t ON t.id = mt.tag_id
       WHERE m.id = $1
       GROUP BY m.id`,
      [req.editableMangaId]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.post("/manga/:slug", requireUploader, loadEditableManga, express.json(), async (req, res) => {
  const { cover_url, description, title, genres, tags } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await updateMangaCore(client, req.editableMangaId, { cover_url, description, title, genres, tags });
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("UPLOADER MANGA EDIT ERROR:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    client.release();
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

router.post("/manga/:slug/cover", requireUploader, loadEditableManga, coverUpload.single("cover"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nincs fájl" });
  const filePath = `/uploads/${req.file.filename}`;
  try {
    await pool.query(`UPDATE manga SET cover_url = $1 WHERE id = $2`, [filePath, req.editableMangaId]);
    res.json({ ok: true, cover_url: filePath });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
