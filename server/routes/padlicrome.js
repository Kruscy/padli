/* ============================================================
   routes/padlicrome.js - Manga fordító + projekt kezelés
   ============================================================ */

import express  from "express";
import multer   from "multer";
import FormData from "form-data";
import fetch    from "node-fetch";
import rateLimit from "express-rate-limit";
import sharp    from "sharp";
import fs       from "fs";
import path     from "path";
import { pool } from "../db.js";
import { logSecurityEvent } from "../lib/security-log.js";
import { localPathToR2Key, listFiles, getPresignedUrl } from "../r2.js";
import { callGemini } from "../lib/gemini-client.js";
import { BUGFIX_STAGING_DIR, findChapter, isSafeName, resolveInside } from "../lib/safe-path.js";
import { denyReason, getChapterFlags, flagsFromRows } from "../lib/chapter-access.js";
import { getBalance, spendPoints, refundPoints } from "../lib/points-ledger.js";
import { safeFetch } from "../lib/safe-fetch.js";
import { keyFromRequest, authenticateApiKey } from "../lib/api-keys.js";
import { validateInput, billablePages, translateBubbles, TEXT_MODEL } from "../lib/text-translate.js";
import { chatCompletions, listModels } from "../lib/llm-proxy.js";
import { availablePoints } from "../lib/llm-meter.js";
import { getClientIp } from "../lib/client-ip.js";
import { isAdultVerified, ADULT_GENRE_EXISTS_SQL } from "../lib/age.js";

const router = express.Router();

/* ── KONFIG ──────────────────────────────────────────────── */
const TORII_API_KEY  = process.env.TORII_API_KEY;
const TORII_API_URL  = "https://api.toriitranslate.com/api/v2/upload";
const PROJECT_ROOT   = process.env.PADLICROME_DIR || "/mnt/manga2/padlicrome";
const MAX_IMAGES     = 30;
const MAX_FILE_SIZE  = 5 * 1024 * 1024;       // 5MB
const MAX_IMG_HEIGHT = 65000;                  // px - a JPEG formátum kemény határa 65535px, ez alatt biztonsági ráhagyással; Torii API-val élesben tesztelve idáig működik
const MAX_IMG_WIDTH  = 10000;                  // px

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ── DIR HELPERS ─────────────────────────────────────────── */
const userDir       = id => path.join(PROJECT_ROOT, String(id));
const originalsDir  = id => path.join(userDir(id), "originals");
const translatedDir = id => path.join(userDir(id), "translated");
const mergedDir     = id => path.join(userDir(id), "merged");
const projectFile   = id => path.join(userDir(id), "project.json");

// Egy kép forrás-elérési útja: összefűzött kép esetén a merged/ mappában van,
// egyébként az originals/-ban.
function sourcePath(userId, img) {
  return path.join(img.merged ? mergedDir(userId) : originalsDir(userId), img.filename);
}

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
// Egyenleg és levonás: lib/points-ledger.js (zárolt, tranzakciós)
const getPoints = getBalance;

// Ugyanaz a zárolás/korhatár-döntés, mint az olvasóban: importálni csak
// olyan fejezetet lehet, amit a user amúgy is olvashat (korábban bármely
// zárolt vagy 18+ fejezet képei importálhatók és letölthetők voltak).
// A szerepkört a DB-ből olvassuk (az authUser-ben nincs benne).
async function chapterDenyReason(userId, slug, chapter) {
  const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
  if (!rows.length) return "login";
  return denyReason({ id: userId, role: rows[0].role }, await getChapterFlags(slug, chapter));
}

async function isSubscriber(userId) {
  const r = await pool.query(
    "SELECT 1 FROM patreon_status WHERE user_id = $1 AND tier IS NOT NULL LIMIT 1",
    [userId]
  );
  return r.rows.length > 0;
}

/* ── AUTH ─────────────────────────────────────────────────────
   2026-11-08: két bejárat, egymástól elválasztva:
   • /api/padlicrome  – a weboldal saját PadliCrome-oldala, CSAK session.
   • /api/pc/v1       – a külső PadliCrome, CSAK felhasználónkénti API-kulcs
                        (X-API-Key fejléc vagy Authorization: Bearer pdl_…).
   A böngészőbővítmény JWT-s belépése (POST /login) megszűnt.
   A kulcsos bejárat nem éri el a hibajegy-javítási végpontokat. ── */
const isKeyGateway = req => req.baseUrl.startsWith("/api/pc/");
const KEY_BLOCKED = /^\/(import-bug-image|submit-bug-fix|fix-status)\b/;

async function requireAuth(req, res, next) {
  if (!isKeyGateway(req)) {
    if (!req.session?.user?.id) return res.status(401).json({ error: "Nem vagy bejelentkezve" });
    req.authUser = { id: req.session.user.id, username: req.session.user.username };
    return next();
  }
  try {
    const key = keyFromRequest(req);
    if (!key) return res.status(401).json({ error: "Hiányzó API-kulcs (X-API-Key fejléc)" });
    const user = await authenticateApiKey(key, getClientIp(req));
    if (!user) {
      logSecurityEvent({ req, type: "api_key_invalid", severity: "warn",
                         dedupeKey: key.slice(0, 10), details: { prefix: key.slice(0, 10) } });
      return res.status(401).json({ error: "Érvénytelen vagy visszavont API-kulcs" });
    }
    if (KEY_BLOCKED.test(req.path)) return res.status(403).json({ error: "Ez a funkció API-kulccsal nem érhető el" });
    req.authUser = { id: user.id, username: user.username, keyId: user.keyId };
    next();
  } catch (err) {
    console.error("[PADLICROME] api-kulcs:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
}

/* ── CORS ─────────────────────────────────────────────────────
   A kulcsos bejárat bármely eredetről hívható: nem sütivel, hanem
   kulccsal hitelesít, így a CSRF nem értelmezhető rá. A session-ös
   bejárat csak a saját oldalunkról (nincs CORS-fejléc). ── */
router.use((req, res, next) => {
  if (isKeyGateway(req)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "X-Points-Remaining, X-Points-Used, X-Context");
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
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
// trusted: saját (R2) forrás; minden más, kliensből jövő URL a
// safeFetch-en megy át (belső hálózati címek tiltva, SSRF ellen)
async function downloadImage(url, refererOverride, { trusted = false } = {}) {
  const referer = refererOverride || (new URL(url).origin + "/");
  const resp = await (trusted ? fetch : safeFetch)(url, {
    headers: {
      "Referer": referer,
      "User-Agent": USER_AGENT,
      "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(20000), // a node-fetch v3 a "timeout" opciót figyelmen kívül hagyja
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} - ${url}`);
  const buf = await resp.buffer();
  if (buf.length > MAX_FILE_SIZE) throw new Error(`Túl nagy fájl: ${Math.round(buf.length/1024)}KB (max 5MB)`);
  return buf;
}

/* ── TORII TRANSLATE (Gemini-alapú, felhő API) ───────────── */
/* opts (2026-11-08, Padlizsan Studio): a felhasználó beállításai, ellenőrzött
   értékekkel. A modell (translator) SZÁNDÉKOSAN rögzített: a gemini-3.1-flash-lite
   ~0,5 Ft/oldal; a drágább Torii-modellek (4+ kredit) mellett az 1 pont/oldal
   ár nem hozna hasznot. Visszaad: { image: Buffer, context?: string } */
const TORII_ALIGN = new Set(["auto", "left", "center", "right"]);
function toriiOptions(src = {}) {
  const o = {};
  if (typeof src.target_lang === "string" && /^[a-z]{2}(-[a-z]{2})?$/i.test(src.target_lang)) o.target_lang = src.target_lang.toLowerCase();
  if (typeof src.font === "string" && /^[A-Za-z][A-Za-z ]{1,29}$/.test(src.font)) o.font = src.font;
  if (TORII_ALIGN.has(src.text_align)) o.text_align = src.text_align;
  const mf = parseInt(src.min_font_size, 10);
  if (mf >= 1 && mf <= 60) o.min_font_size = String(mf);
  if (src.bubbles_only === "true" || src.bubbles_only === true) o.bubbles_only = "true";
  if (src.stroke_disabled === "true" || src.stroke_disabled === true) o.stroke_disabled = "true";
  if (typeof src.custom_prompt === "string" && src.custom_prompt.trim()) o.custom_prompt = src.custom_prompt.slice(0, 1000);
  if (typeof src.context === "string" && src.context.trim()) o.context = src.context.slice(0, 10000);
  return o;
}

async function translateViaToriiFull(imageBuffer, filename, opts = {}) {
  if (!TORII_API_KEY) throw new Error("Nincs beállítva TORII_API_KEY a szerveren");

  const form = new FormData();
  form.append("file", imageBuffer, { filename, contentType: "image/jpeg" });
  form.append("target_lang", opts.target_lang || "hu");
  form.append("translator", "gemini-3.1-flash-lite");
  form.append("font", opts.font || "wildwords");
  form.append("text_align", opts.text_align || "auto");
  form.append("stroke_disabled", opts.stroke_disabled || "false");
  form.append("min_font_size", opts.min_font_size || "6");
  form.append("bubbles_only", opts.bubbles_only || "false");
  if (opts.custom_prompt) form.append("custom_prompt", opts.custom_prompt);
  if (opts.context) form.append("context", opts.context);

  const resp = await fetch(TORII_API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TORII_API_KEY}`, ...form.getHeaders() },
    body: form,
    signal: AbortSignal.timeout(180000),
  });

  if (resp.headers.get("success") !== "true") {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Torii API hiba: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const imageBase64 = (data.image || "").split(",")[1];
  if (!imageBase64) throw new Error("Torii API: hiányzó kép a válaszban");
  return { image: Buffer.from(imageBase64, "base64"), context: typeof data.context === "string" ? data.context : null };
}

async function translateViaTorii(imageBuffer, filename, opts) {
  return (await translateViaToriiFull(imageBuffer, filename, opts)).image;
}

// A kép valódi formátuma a bájtok alapján (a Torii JPEG-et is adhat)
function sniffImageType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return "application/octet-stream";
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
  const resp = await safeFetch(apiUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10000),
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
  const resp = await safeFetch(chapterUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Referer": new URL(chapterUrl).origin + "/",
    },
    signal: AbortSignal.timeout(15000),
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
  // (modern, nem klasszikus WP-manga sablonú oldalaknál, pl. asurascans.com,
  // ez a fallback nemcsak a fejezet-oldalakat találja meg, hanem elszórt
  // egyéb képeket is — pl. borító-thumbnail egy ajánló/breadcrumb widgetben.
  // Ezeket a könyvtár-csoportosítással szűrjük ki lentebb.)
  if (imageUrls.size === 0) {
    const allImgs = html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/gi);
    const candidates = [];
    const seen = new Set();
    for (const m of allImgs) {
      if (isImageUrl(m[1]) && isCdnUrl(m[1], chapterUrl) && !seen.has(m[1])) {
        seen.add(m[1]);
        candidates.push(m[1]);
      }
    }
    filterByDirectoryGroup(candidates).forEach(u => imageUrls.add(u));
  }

  if (imageUrls.size === 0) throw new Error("Nem találtam képeket az oldalon. Lehet hogy JavaScript-tel rendereli a képeket.");

  return [...imageUrls];
}

// Kiszűri az elszórt (más mappából jövő, pl. borító-thumbnail) képeket:
// ha van legalább egy olyan mappa, ahonnan több kép is jött (ez lesz a
// tényleges fejezet-mappa), csak azokat tartjuk meg.
function filterByDirectoryGroup(urls) {
  const dirCounts = new Map();
  const dirOf = new Map();
  for (const u of urls) {
    try {
      const p = new URL(u).pathname;
      const dir = p.slice(0, p.lastIndexOf("/"));
      dirOf.set(u, dir);
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    } catch { dirOf.set(u, null); }
  }
  const hasMultiImageGroup = [...dirCounts.values()].some(c => c > 1);
  if (!hasMultiImageGroup) return urls;
  return urls.filter(u => (dirCounts.get(dirOf.get(u)) || 0) > 1);
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

/* ── POST /login – MEGSZŰNT (2026-11-08) ─────────────────────
   A böngészőbővítmény jelszavas/JWT-s belépése helyett a külső
   PadliCrome felhasználónkénti API-kulcsot használ (Beállítások →
   API-kulcsok). ── */
router.post("/login", (req, res) => {
  res.status(410).json({ error: "Ez a belépési mód megszűnt. Hozz létre API-kulcsot: Beállítások → API-kulcsok." });
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
    // a helyi motor GPT-hívásainak még le nem vont töredéke (lib/llm-meter.js)
    const acc = await availablePoints(req.authUser.id).catch(() => null);
    res.json({ username: req.authUser.username, points, subscriber, role,
               points_pending: acc ? +acc.pending.toFixed(3) : 0,
               points_available: acc ? +acc.available.toFixed(3) : points });
  } catch (err) {
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── GET /library/manga – sorozatok listája (2026-11-08) ─────
   ?q=keresés (cím vagy alternatív cím), ?limit=1..100, ?offset=
   18+ sorozat csak igazoltan nagykorú felhasználónak jelenik meg. ── */
async function userAccessInfo(userId) {
  const { rows } = await pool.query("SELECT role, birth_date FROM users WHERE id = $1", [userId]);
  return { role: rows[0]?.role || "user", adultOk: rows[0]?.role === "admin" || isAdultVerified(rows[0]?.birth_date) };
}

router.get("/library/manga", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 100);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { adultOk } = await userAccessInfo(req.authUser.id);
    const like = q ? "%" + q.replace(/[\\%_]/g, c => "\\" + c) + "%" : "";
    const { rows } = await pool.query(`
      SELECT m.slug, min(m.title) AS title, max(m.cover_url) AS cover_url,
             max(m.status) AS status, bool_or(${ADULT_GENRE_EXISTS_SQL}) AS adult,
             count(DISTINCT c.folder)::int AS chapters, max(c.scanned_at) AS updated_at,
             count(*) OVER()::int AS total
        FROM manga m JOIN chapter c ON c.manga_id = m.id
       WHERE ($1 = '' OR m.title ILIKE $1 OR array_to_string(m.alt_titles, ' ') ILIKE $1)
       GROUP BY m.slug
      HAVING $2 OR NOT bool_or(${ADULT_GENRE_EXISTS_SQL})
       ORDER BY max(c.scanned_at) DESC NULLS LAST
       LIMIT $3 OFFSET $4`, [like, adultOk, limit, offset]);
    res.json({
      total: rows[0]?.total ?? 0, limit, offset,
      items: rows.map(({ total, ...r }) => r),
    });
  } catch (err) {
    console.error("[PADLICROME] library/manga:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── GET /library/manga/:slug/chapters – fejezetek + hozzáférés ──
   accessible=false: zárolt (támogatói) vagy korhatáros a felhasználónak;
   ilyenkor az /import-chapter is 403-at ad. ── */
router.get("/library/manga/:slug/chapters", requireAuth, async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!isSafeName(slug)) return res.status(400).json({ error: "Hibás slug" });
    const access = await userAccessInfo(req.authUser.id);
    const { rows } = await pool.query(`
      SELECT c.folder, c.title, c.unlocks_at, c.scanned_at, ${ADULT_GENRE_EXISTS_SQL} AS is_adult
        FROM chapter c JOIN manga m ON m.id = c.manga_id
       WHERE m.slug = $1`, [slug]);
    if (!rows.length) return res.status(404).json({ error: "Nincs ilyen sorozat" });
    if (rows.some(r => r.is_adult) && !access.adultOk) return res.status(404).json({ error: "Nincs ilyen sorozat" });
    const byFolder = new Map();
    for (const r of rows) {
      if (!byFolder.has(r.folder)) byFolder.set(r.folder, []);
      byFolder.get(r.folder).push(r);
    }
    const user = { id: req.authUser.id, role: access.role };
    const chapters = [];
    for (const [folder, list] of byFolder) {
      const flags = flagsFromRows(list);
      const unlocks = list.map(r => r.unlocks_at).filter(Boolean).sort((a, b) => a - b)[0] || null;
      chapters.push({
        chapter: folder,
        title: list.find(r => r.title)?.title || null,
        locked: flags.locked,
        unlocks_at: flags.locked ? unlocks : null,
        accessible: !(await denyReason(user, flags)),
        updated_at: list.reduce((a, r) => (r.scanned_at > a ? r.scanned_at : a), list[0].scanned_at),
      });
    }
    chapters.sort((a, b) => a.chapter.localeCompare(b.chapter, undefined, { numeric: true }));
    res.json({ slug, chapters });
  } catch (err) {
    console.error("[PADLICROME] library/chapters:", err.message);
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

  // Scrape
  let imageUrls;
  try {
    imageUrls = await scrapeChapterImages(url);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  // A meglévő projekt csak sikeres scrape UTÁN törlődik (korábban előtte:
  // hibás URL-nél a felhasználó elvesztette a folyamatban lévő munkáját)
  if (readProject(userId)) {
    const dir = userDir(userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  }

  ensureUserDirs(userId);

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

  const origPath = sourcePath(userId, img);
  if (!fs.existsSync(origPath)) return res.status(404).json({ error: "Eredeti kép hiányzik" });

  // A pontot a hívás ELŐTT foglaljuk le (zárolt tranzakcióban), és hiba
  // esetén visszaadjuk — így párhuzamos kérésekkel sem költhető el kétszer
  const spend = await spendPoints(userId, 1);
  if (!spend.ok) return res.status(402).json({ error: "Nincs elég pont" });

  img.translating = true;
  writeProject(userId, project);

  try {
    const pngBuf = await translateViaTorii(fs.readFileSync(origPath), img.filename);
    const jpgBuf = await sharp(pngBuf).jpeg({ quality: 92 }).toBuffer();
    fs.writeFileSync(path.join(translatedDir(userId), img.filename), jpgBuf);

    const newPoints = spend.balance;

    img.translated = true;
    img.translating = false;
    img.translatedAt = new Date().toISOString();
    writeProject(userId, project);

    res.json({ ok: true, filename: img.filename, pointsRemaining: newPoints });
  } catch (err) {
    await refundPoints(spend.entryId).catch(e => console.error("[PADLICROME] pont-visszaadás hiba:", e.message));
    img.translating = false;
    writeProject(userId, project);
    console.error("[PADLICROME] translate:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── POST /translate-gemini/:id - KÍSÉRLETI Gemini-alapú fordítás ──
   Nem helyettesíti a fenti /translate/:id-t (ami a manga-image-translator
   szolgáltatást hívja és renderelt, kép-visszaírt eredményt ad) — ez csak
   szöveg-kinyerést + fordítást ad vissza JSON-ban, minőség-összehasonlításhoz.
   Nincs pontlevonás, mert kísérleti/teszt funkció — ezért felhasználónként
   óránként korlátozott (korábban korlátlanul hívható volt, a fizetős
   Gemini-kvóta terhére). ── */
const geminiTestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `pc-gemini:${req.authUser.id}`,
  handler: (req, res, _next, options) => {
    logSecurityEvent({ req, type: "ai_rate_limited", severity: "warn", userId: req.authUser.id,
                       username: req.authUser.username, details: { endpoint: "padlicrome-translate-gemini" } });
    res.status(options.statusCode).json({ error: "Túl sok teszt-fordítás, próbáld újra később." });
  },
});

router.post("/translate-gemini/:id", requireAuth, geminiTestLimiter, async (req, res) => {
  const userId = req.authUser.id;
  const project = readProject(userId);
  if (!project) return res.status(404).json({ error: "Nincs projekt" });
  const img = project.images.find(i => i.id === req.params.id);
  if (!img) return res.status(404).json({ error: "Kép nem található" });

  try {
    const origPath = sourcePath(userId, img);
    if (!fs.existsSync(origPath)) return res.status(404).json({ error: "Eredeti kép hiányzik" });

    const imgBuffer = fs.readFileSync(origPath);
    const mimeType = img.filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const base64 = imgBuffer.toString("base64");

    const prompt = `Ez egy manga/manhwa oldal képe. Azonosíts minden szövegbuborékot és hangeffektust (SFX) a képen, és fordítsd le magyarra természetes, olvasható stílusban.

Válaszolj KIZÁRÓLAG egy JSON tömbbel, más szöveg vagy magyarázat nélkül. Minden elem formátuma:
{"original": "eredeti szöveg", "translation": "magyar fordítás", "location": "rövid leírás, hol van a képen (pl. 'bal felső buborék', 'jobb oldali SFX')"}

Ha nincs szöveg a képen, üres tömböt ([]) adj vissza.`;

    const data = await callGemini(
      "gemini-3.1-flash-lite",
      {
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
      },
      45000,
      "padlicrome-translate-gemini-test"
    );

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return res.status(502).json({ error: "Nem sikerült JSON-t kinyerni a Gemini válaszból", raw: text.slice(0, 500) });
    }

    let segments;
    try {
      segments = JSON.parse(match[0]);
    } catch {
      return res.status(502).json({ error: "Érvénytelen JSON a Gemini válaszban", raw: text.slice(0, 500) });
    }

    res.json({ ok: true, segments });
  } catch (err) {
    console.error("[PADLICROME] translate-gemini:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── POST /translate-text – buborékszövegek fordítása (2026-11-08) ──
   A külső PadliCrome-ban a Torii olvassa ki és írja vissza a szöveget,
   a fordítást mi adjuk (gpt-5.4-mini). Body:
     { pages: [["buborék1","buborék2"], …], mangaSlug?, glossary?, notes? }
   Ár: oldalanként PC_TEXT_POINTS_PER_PAGE pont (alap: 1); üres oldal ingyenes.
   A pontot előre levonjuk, hiba esetén visszaadjuk. A valós költséget a
   pc_text_usage táblába naplózzuk (haszon-ellenőrzéshez). ── */
const TEXT_POINTS_PER_PAGE = Math.max(0, parseInt(process.env.PC_TEXT_POINTS_PER_PAGE ?? "1", 10) || 0);

router.post("/translate-text", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const input = validateInput(req.body);
  if (typeof input === "string") return res.status(400).json({ error: input });

  const mangaSlug = typeof req.body.mangaSlug === "string" && isSafeName(req.body.mangaSlug) ? req.body.mangaSlug : null;
  let title = null;
  if (mangaSlug) {
    const { rows } = await pool.query("SELECT title FROM manga WHERE slug = $1 LIMIT 1", [mangaSlug]).catch(() => ({ rows: [] }));
    title = rows[0]?.title || null;
  }

  const pages = billablePages(input.pages);
  const bubbles = input.pages.reduce((n, p) => n + p.filter(t => t.trim()).length, 0);
  const cost = pages * TEXT_POINTS_PER_PAGE;
  if (!pages) return res.json({ ok: true, pages: input.pages.map(p => p.map(() => "")), pointsCharged: 0 });

  const spend = cost ? await spendPoints(userId, cost) : { ok: true, entryId: null, balance: await getBalance(userId) };
  if (!spend.ok) return res.status(402).json({ error: `Nincs elég pont (kell: ${cost}, van: ${spend.balance})`, needed: cost, balance: spend.balance });

  const log = (ok, usage, error) => pool.query(
    `INSERT INTO pc_text_usage (user_id, api_key_id, manga_slug, pages, bubbles, points, model,
                                prompt_tokens, cached_tokens, completion_tokens, cost_usd, ok, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [userId, req.authUser.keyId || null, mangaSlug, pages, bubbles, ok ? cost : 0, TEXT_MODEL,
     usage?.prompt || 0, usage?.cached || 0, usage?.completion || 0, usage?.costUsd || 0, ok, error ? String(error).slice(0, 500) : null]
  ).catch(e => console.error("[PADLICROME] translate-text napló:", e.message));

  try {
    const { pages: translated, usage } = await translateBubbles({ ...input, title });
    log(true, usage);
    res.setHeader("X-Points-Remaining", spend.balance);
    res.json({ ok: true, pages: translated, pointsCharged: cost, pointsRemaining: spend.balance, model: TEXT_MODEL });
  } catch (err) {
    if (spend.entryId) await refundPoints(spend.entryId).catch(e => console.error("[PADLICROME] pont-visszaadás hiba:", e.message));
    log(false, null, err.message);
    console.error("[PADLICROME] translate-text:", err.message);
    res.status(502).json({ error: "A fordítás nem sikerült, a pontot visszaadtuk. Próbáld újra." });
  }
});

/* ── Helyi motor szövegfordítója (OpenAI-kompatibilis, lib/llm-proxy.js) ── */
router.get("/llm/v1/models", requireAuth, listModels);
router.post("/llm/v1/chat/completions", requireAuth, chatCompletions);

/* ── POST /merge - összefűzés (előfizető, min 2, max 25) ──
   A kijelölt képeket sorrendben csoportokba osztja úgy, hogy egyik
   csoport se lépje túl a MAX_IMG_HEIGHT magasságot (amit a fordító
   szolgáltatás még elfogad) — így nagyobb kijelölésnél automatikusan
   több kimeneti kép készül, nem egy óriási. ── */
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
      const filePath  = fs.existsSync(transPath) ? transPath : sourcePath(userId, img);
      if (!fs.existsSync(filePath)) continue;
      const meta = await sharp(filePath).metadata();
      if (meta.width > maxWidth) maxWidth = meta.width;
      metas.push({ img, filePath, width: meta.width, height: meta.height });
    }

    if (metas.length < 2) return res.status(400).json({ error: "Nincs elég érvényes kép" });

    for (const m of metas) {
      m.normHeight = m.width !== maxWidth ? Math.round(m.height * maxWidth / m.width) : m.height;
    }

    // Sorrendben csoportosítás — egyik csoport se lépje túl a magasság-limitet
    const batches = [];
    let current = [];
    let currentHeight = 0;
    for (const m of metas) {
      if (current.length && currentHeight + m.normHeight > MAX_IMG_HEIGHT) {
        batches.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(m);
      currentHeight += m.normHeight;
    }
    if (current.length) batches.push(current);

    const mergedImages = [];
    const skipped = [];

    for (const batch of batches) {
      if (batch.length < 2) {
        // Egyedül maradt kép egy csoportban — nincs mit összefűzni vele, marad ahogy van
        skipped.push(batch[0].img.name);
        continue;
      }

      const resized = [];
      let totalHeight = 0;
      for (const m of batch) {
        let buf, h;
        if (m.width !== maxWidth) {
          h = m.normHeight;
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

      const mergedId = Date.now() + "_merged_" + Math.random().toString(36).slice(2, 6);
      const mergedFilename = mergedId + ".jpg";
      fs.writeFileSync(path.join(mergedDir(userId), mergedFilename), mergedBuf);

      const batchIds = batch.map(m => m.img.id);
      const mergedImg = {
        id: mergedId, filename: mergedFilename,
        name: `merged_${batch.length}x.jpg`,
        active: true, translated: false, merged: true,
        mergedFrom: batchIds,
      };
      project.images.push(mergedImg);
      batchIds.forEach(id => {
        const img = project.images.find(i => i.id === id);
        if (img) img.active = false;
      });
      mergedImages.push(mergedImg);
    }

    writeProject(userId, project);
    res.json({ ok: true, images: mergedImages, batchCount: batches.length, skipped });
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
  const filePath = isSafeName(req.params.filename) && resolveInside(dir, req.params.filename);
  if (!filePath) return res.status(403).end();
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

  const spend = await spendPoints(userId, 1);
  if (!spend.ok) return res.status(402).json({ error: "Nincs elég pont" });

  try {
    const { image: imageData, context } = await translateViaToriiFull(imageBuffer, "image.jpg", toriiOptions(req.body));
    res.setHeader("X-Points-Remaining", spend.balance);
    res.setHeader("X-Points-Used", "1");
    // Context chain (Padlizsan Studio): a context a TÖRZSBE kerül (Torii-stílusú
    // JSON), nem fejlécbe — 2026-11-08: a több KB-os X-Context fejlécet a
    // szerver előtti proxy 502-vel eldobta (szövegsűrű oldalaknál), miközben
    // a pont már le volt vonva. Csak akkor JSON, ha a kliens küldött contextet.
    if (typeof req.body?.context === "string" && req.body.context.trim()) {
      const mime = sniffImageType(imageData);
      return res.json({
        image: `data:${mime};base64,${imageData.toString("base64")}`,
        context: context || null,
        metadata: { credits_used: 1 },
      });
    }
    res.setHeader("Content-Type", sniffImageType(imageData));
    res.send(imageData);
  } catch (err) {
    await refundPoints(spend.entryId).catch(e => console.error("[PADLICROME] pont-visszaadás hiba:", e.message));
    console.error("[PADLICROME] translate (addon):", err.message);
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
    if (typeof imageUrl !== "string") return res.status(400).json({ error: "imageUrl kötelező" });
    // A saját oldalra mutató abszolút URL-t a helyi (ellenőrzött) úton kezeljük
    for (const base of [process.env.SITE_URL, process.env.BASE_URL]) {
      try {
        const origin = base && new URL(base).origin;
        if (origin && imageUrl.startsWith(origin + "/api/image/")) imageUrl = imageUrl.slice(origin.length);
      } catch {}
    }

    let jpgBuf;
    const localMatch = imageUrl.match(/^\/api\/image\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (localMatch) {
      // Direkt fájlrendszer olvasás a DB-ből
      const [, library, slug, chapterFolder, file] = localMatch;
      let decodedFile;
      try { decodedFile = decodeURIComponent(file.split("?")[0]); } catch { decodedFile = null; }
      if (!isSafeName(decodedFile)) return res.status(400).json({ error: "Érvénytelen fájlnév" });
      // A javítás célja mindig a ténylegesen beolvasott kép — a törzsben
      // küldött slug/fejezet/fájlnév nem írhatja felül (különben a
      // submit-bug-fix bárhová írhatott a lemezen)
      mangaSlug = slug;
      chapter = chapterFolder;
      imageFile = decodedFile;
      const denied = await chapterDenyReason(userId, slug, chapterFolder);
      if (denied) return res.status(403).json({ error: "Ehhez a fejezethez nincs hozzáférésed" });
      const { rows } = await pool.query(
        `SELECT l.path AS library_path, m.folder AS manga_folder
         FROM chapter c
         JOIN manga m ON m.id = c.manga_id
         JOIN library l ON l.id = c.library_id
         WHERE l.name = $1 AND m.slug = $2 AND c.folder = $3
         LIMIT 1`,
        [library, slug, chapterFolder]
      );
      if (!rows.length) return res.status(404).json({ error: "Kép nem található az adatbázisban" });
      const { library_path, manga_folder } = rows[0];
      const imgPath = resolveInside(library_path, manga_folder, chapterFolder, decodedFile);
      if (!imgPath) return res.status(400).json({ error: "Érvénytelen útvonal" });
      let buf;
      if (fs.existsSync(imgPath)) {
        buf = fs.readFileSync(imgPath);
      } else {
        // Nincs lokálisan → R2-ről töltjük le
        const r2Key = localPathToR2Key(imgPath);
        // hitelesített (aláírt) URL — a publikus cím a fejezetképekre le lesz tiltva
        buf = await downloadImage(await getPresignedUrl(r2Key, 300), undefined, { trusted: true });
      }
      jpgBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
    } else {
      // Abszolút URL — HTTP letöltés. A törzsben kapott slug/fejezet/fájlnév
      // csak címke; a submit-bug-fix a DB alapján újra ellenőrzi.
      if ([mangaSlug, chapter, imageFile].some(v => v != null && v !== "" && !isSafeName(String(v)))) {
        return res.status(400).json({ error: "Érvénytelen manga/fejezet/fájlnév" });
      }
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
    const { mangaSlug, chapter, chapterBugId } = req.body;
    if (!isSafeName(mangaSlug) || !isSafeName(chapter)) return res.status(400).json({ error: "mangaSlug és chapter kötelező" });
    const denied = await chapterDenyReason(userId, mangaSlug, chapter);
    if (denied) return res.status(403).json({ error: "Ehhez a fejezethez nincs hozzáférésed" });

    ensureUserDirs(userId);

    const { rows } = await pool.query(`
      SELECT l.name AS library_name, l.path AS library_path, m.folder AS manga_folder
      FROM manga m
      JOIN chapter c ON c.manga_id = m.id AND c.folder = $2
      JOIN library l ON l.id = c.library_id
      WHERE m.slug = $1 LIMIT 1
    `, [mangaSlug, chapter]);
    if (!rows.length) return res.status(404).json({ error: "Manga nem található" });
    const { library_name, library_path, manga_folder } = rows[0];

    // A fejezet-hibajegy azonosítója csak akkor kerül a projektbe, ha
    // tényleg ehhez a fejezethez tartozik (a beküldéskor ez zárja le)
    let linkedChapterBugId = null;
    const cbId = parseInt(chapterBugId, 10);
    if (cbId) {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM chapter_bug_reports WHERE id = $1 AND manga_slug = $2 AND chapter = $3`,
        [cbId, mangaSlug, chapter]
      );
      if (rowCount) linkedChapterBugId = cbId;
    }

    const chapterDir = path.join(library_path, manga_folder, chapter);
    const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);

    let files = [];
    let useR2 = false;

    if (fs.existsSync(chapterDir)) {
      files = fs.readdirSync(chapterDir)
        .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
        .sort();
    } else {
      // Lokális könyvtár nincs → R2-ből listázzuk
      const prefix = localPathToR2Key(chapterDir + "/");
      files = (await listFiles(prefix))
        .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
        .sort();
      useR2 = true;
    }

    if (!files.length) return res.status(404).json({ error: "Fejezet képek nem találhatók (sem lokálisan, sem R2-n)" });

    const R2_PUBLIC = process.env.R2_PUBLIC_URL;
    const project = readProject(userId) || { images: [], createdAt: new Date().toISOString(), status: "ready" };

    let added = 0, skipped = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (project.images.some(img =>
        img.bugFix?.imageFile === file &&
        img.bugFix?.mangaSlug === mangaSlug &&
        img.bugFix?.chapter === chapter
      )) { skipped++; continue; }

      let buf;
      if (useR2) {
        const r2Key = localPathToR2Key(path.join(chapterDir, file));
        buf = await downloadImage(await getPresignedUrl(r2Key, 300), undefined, { trusted: true });
      } else {
        buf = fs.readFileSync(path.join(chapterDir, file));
      }
      const jpgBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
      const id = `${Date.now()}_${i}_ch`;
      const filename = id + ".jpg";
      fs.writeFileSync(path.join(originalsDir(userId), filename), jpgBuf);

      project.images.push({
        id, filename,
        name: `${mangaSlug} ${chapter} #${i + 1}`,
        active: true, translated: false, merged: false,
        bugFix: { reportId: "", chapterBugId: linkedChapterBugId, mangaSlug, chapter, imageIndex: i, imageFile: file, mangaTitle: null, library: library_name },
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

    const { mangaSlug, chapter, imageIndex, imageFile, library, chapterBugId } = img.bugFix;
    const provider = library || "unknown";

    // Fordított verzió preferált, ha nincs akkor az eredeti
    const translatedPath = path.join(translatedDir(userId), img.filename);
    const srcPath = fs.existsSync(translatedPath) ? translatedPath : sourcePath(userId, img);
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: "Forráskép nem található" });

    let fixId = null;
    let fixedImageUrl = null;
    let chapterBugClosed = false;

    if (mangaSlug && chapter) {
      // A bugFix-adatok a kliens importjából származnak — csak létező
      // fejezetre és ellenőrzött fájlnévvel írunk, az átmeneti mappán belül
      if (!(await findChapter(mangaSlug, chapter))) {
        return res.status(400).json({ error: "A kép mangája/fejezete nem található" });
      }
      const targetFilename = String(imageFile || img.filename).split("?")[0];
      const fixedDir = resolveInside(BUGFIX_STAGING_DIR, mangaSlug, chapter);
      const destPath = isSafeName(targetFilename) && fixedDir && resolveInside(fixedDir, targetFilename);
      if (!destPath) return res.status(400).json({ error: "Érvénytelen fájlnév" });

      // Cél: uploads/bugs/javitott/{mangaSlug}/{chapter}/
      fs.mkdirSync(fixedDir, { recursive: true });
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

      // Ha egész fejezet importból jött (chapterBugId) → lezárjuk a chapter_bug_reports bejegyzést
      if (chapterBugId) {
        const cbId = parseInt(chapterBugId);
        if (cbId) {
          // Csak az ugyanehhez a mangához/fejezethez tartozó hibajegyet
          // (korábban bármely azonosítójú hibajegy lezárható volt)
          const { rowCount } = await pool.query(
            `UPDATE chapter_bug_reports SET is_fixed = true, fixed_by = $1, fixed_at = NOW()
             WHERE id = $2 AND manga_slug = $3 AND chapter = $4 AND is_fixed = false`,
            [userId, cbId, mangaSlug, chapter]
          );
          chapterBugClosed = rowCount > 0;
        }
      }
    }

    img.submittedAsFix = true;
    writeProject(userId, project);

    res.json({ ok: true, fixId, fixedImageUrl, chapterBugClosed, noMeta: !mangaSlug || !chapter });
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
