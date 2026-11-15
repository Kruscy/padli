/* ── Android-app API (2026-11-15) — /api/app/... ──
   Belépés: az app böngészőben megnyitja az /app-login.html?state=...&device=... oldalt; a bejelentkezett
   user engedélyez → egyszer használatos kód → padlizsan://auth?code=...&state=... → az app beváltja
   (POST /auth/token) hosszú életű tokenre (Authorization: Bearer pdla_...). Jelszó nem kerül az appba.

   Letöltés: POST /download {slug, chapter} → ugyanaz a hozzáférés-döntés, mint a weboldali olvasónál
   (zárolt fejezet csak támogatónak, 18+ csak igazolt nagykorúnak), napi keret (ingyenes / támogató),
   és oldalszintű terheléskorlát (egyszerre legfeljebb APP_DL_MAX_ACTIVE kiadott letöltés). A képek
   rövid életű, aláírt R2-linkekről jönnek, így a letöltés a szerverünket nem terheli; amit csak
   helyben tárolunk, azt a /page végpont szolgálja ki (tokennel). */
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { getPresignedUrl, listFiles, localPathToR2Key } from "../r2.js";
import { getChapterFlags, denyReason } from "../lib/chapter-access.js";
import { ADULT_GENRE_EXISTS_SQL, isAdultVerified } from "../lib/age.js";

const router = express.Router();
const SITE = "https://padlizsanfansub.hu";
const TOKEN_PREFIX = "pdla_";
const FREE_PER_DAY = parseInt(process.env.APP_DL_FREE_PER_DAY || "10", 10);
const PATRON_PER_DAY = parseInt(process.env.APP_DL_PATRON_PER_DAY || "200", 10);
const MAX_ACTIVE = parseInt(process.env.APP_DL_MAX_ACTIVE || "40", 10);   // egész oldalra
const URL_TTL = 30 * 60;                                                  // aláírt link: 30 perc
const ACTIVE_WINDOW = "20 minutes";                                       // ennyi után egy félbehagyott letöltés már nem foglal helyet

const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const ipOf = req => req.headers["cf-connecting-ip"] || req.ip;

/* ── Belépés ── */
// A weboldali bejelentkezett user engedélyezi az appot (az /app-login.html hívja)
router.post("/auth/grant", requireLogin, express.json(), async (req, res) => {
  const state = String(req.body?.state || "");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return res.status(400).json({ error: "Hibás kérés (state)." });
  const code = crypto.randomBytes(24).toString("base64url");
  await pool.query("INSERT INTO app_auth_codes (code_hash, user_id, state, device) VALUES ($1, $2, $3, $4)",
    [sha(code), req.session.user.id, state, String(req.body?.device || "").slice(0, 80) || null]);
  res.json({ ok: true, redirect: `padlizsan://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` });
});

// Az app beváltja a kódot (5 percig érvényes, egyszer használható, a state-nek egyeznie kell)
router.post("/auth/token", express.json(), async (req, res) => {
  const code = String(req.body?.code || ""), state = String(req.body?.state || "");
  const { rows } = await pool.query(
    `UPDATE app_auth_codes SET used_at = now()
      WHERE code_hash = $1 AND state = $2 AND used_at IS NULL AND created_at > now() - interval '5 minutes'
      RETURNING user_id, device`, [sha(code), state]);
  if (!rows[0]) return res.status(400).json({ error: "A belépési kód lejárt vagy érvénytelen. Próbáld újra." });
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO app_tokens (user_id, token_hash, device) VALUES ($1, $2, $3)", [rows[0].user_id, sha(token), rows[0].device]);
  const u = await pool.query("SELECT username FROM users WHERE id = $1", [rows[0].user_id]);
  res.json({ ok: true, token, username: u.rows[0]?.username });
});

// Bearer-token → req.appUser = { id, username, role }
async function appAuth(req, res, next) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok.startsWith(TOKEN_PREFIX)) return res.status(401).json({ error: "Jelentkezz be az appban." });
  const { rows } = await pool.query(
    `SELECT t.id AS token_id, u.id, u.username, u.role FROM app_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`, [sha(tok)]);
  if (!rows[0]) return res.status(401).json({ error: "A belépésed lejárt, jelentkezz be újra." });
  req.appUser = rows[0];
  pool.query("UPDATE app_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')", [rows[0].token_id]).catch(() => {});
  next();
}

router.post("/auth/logout", appAuth, async (req, res) => {
  await pool.query("UPDATE app_tokens SET revoked_at = now() WHERE id = $1", [req.appUser.token_id]);
  res.json({ ok: true });
});

/* ── Keret ── */
async function isPatron(userId) {
  const { rows } = await pool.query("SELECT 1 FROM patreon_status WHERE user_id = $1 AND active = true LIMIT 1", [userId]);
  return rows.length > 0;
}
async function quota(user) {
  const patron = user.role === "admin" || await isPatron(user.id);
  const limit = patron ? PATRON_PER_DAY : FREE_PER_DAY;
  // Ugyanannak a fejezetnek az újbóli letöltése 30 napon belül nem számít bele
  const { rows } = await pool.query(
    `SELECT count(DISTINCT (manga_slug, chapter))::int AS n FROM app_downloads d
      WHERE d.user_id = $1 AND d.created_at > now() - interval '24 hours' AND d.status <> 'failed'
        AND NOT EXISTS (SELECT 1 FROM app_downloads p WHERE p.user_id = d.user_id AND p.manga_slug = d.manga_slug
                          AND p.chapter = d.chapter AND p.status = 'done' AND p.created_at < now() - interval '24 hours'
                          AND p.created_at > now() - interval '30 days')`, [user.id]);
  return { patron, limit, used: rows[0].n, left: Math.max(0, limit - rows[0].n) };
}

router.get("/me", appAuth, async (req, res) => {
  res.json({ username: req.appUser.username, quota: await quota(req.appUser) });
});

/* ── Böngészés ── */
router.get("/search", appAuth, async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q.length < 2) return res.json({ results: [] });
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (m.slug) m.slug, m.title, m.cover_url FROM manga m
      WHERE m.title ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(COALESCE(m.alt_titles, ARRAY[]::text[])) a WHERE a ILIKE $1)
      ORDER BY m.slug, m.id DESC LIMIT 30`, [`%${q}%`]);
  res.json({ results: rows });
});

router.get("/manga/:slug", appAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const m = await pool.query(
    `SELECT m.title, m.description, m.cover_url, ${ADULT_GENRE_EXISTS_SQL} AS is_adult FROM manga m WHERE m.slug = $1 ORDER BY m.id DESC LIMIT 1`, [slug]);
  if (!m.rows[0]) return res.status(404).json({ error: "Nincs ilyen mű." });
  const patron = req.appUser.role === "admin" || await isPatron(req.appUser.id);
  const { rows } = await pool.query(
    `SELECT c.folder, max(c.unlocks_at) AS unlocks_at FROM chapter c JOIN manga m ON m.id = c.manga_id
      WHERE m.slug = $1 GROUP BY c.folder`, [slug]);
  const num = s => parseFloat((String(s).match(/(\d+(?:\.\d+)?)/) || [0, 1e9])[1]);
  const now = Date.now();
  const chapters = rows.sort((a, b) => num(a.folder) - num(b.folder)).map(c => ({
    chapter: c.folder,
    locked: !patron && !!c.unlocks_at && new Date(c.unlocks_at).getTime() > now,
    unlocks_at: c.unlocks_at,
  }));
  let ageBlocked = false;
  if (m.rows[0].is_adult && req.appUser.role !== "admin") {
    const u = await pool.query("SELECT birth_date FROM users WHERE id = $1", [req.appUser.id]);
    ageBlocked = !isAdultVerified(u.rows[0]?.birth_date);
  }
  res.json({ slug, title: m.rows[0].title, description: m.rows[0].description, cover_url: m.rows[0].cover_url, ageBlocked, chapters });
});

/* ── Fejezet oldalai (ugyanaz a sorrend, mint a weboldali olvasónál) ── */
function pageNumber(f) {
  const m = f.replace(/\.[^.]+$/, "").match(/(\d+)(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}
async function chapterPages(slug, chapter) {
  const cands = await pool.query(
    `SELECT l.path AS lp, m.folder AS mf, m.r2_migrated FROM chapter c JOIN manga m ON m.id = c.manga_id
       JOIN library l ON l.id = c.library_id WHERE m.slug = $1 AND c.folder = $2`, [slug, chapter]);
  for (const c of cands.rows) {
    const dir = path.join(c.lp, c.mf, chapter);
    let files = [], remote = false;
    if (c.r2_migrated) {
      const prefix = localPathToR2Key(`${c.lp}/${c.mf}/${chapter}/`.replace(/\/+/g, "/"));
      files = (await listFiles(prefix)).map(f => path.basename(f));
      remote = files.length > 0;
    }
    if (!files.length && fs.existsSync(dir)) files = fs.readdirSync(dir);
    files = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    if (!files.length) continue;
    files.sort((a, b) => {
      const x = pageNumber(a), y = pageNumber(b);
      if (x !== null && y !== null) return x - y;
      if (x !== null) return -1;
      if (y !== null) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    return { files, remote, base: `${c.lp}/${c.mf}/${chapter}` };
  }
  return null;
}

/* ── Letöltési engedély ── */
router.post("/download", appAuth, express.json(), async (req, res) => {
  const slug = String(req.body?.slug || ""), chapter = String(req.body?.chapter || "");
  const flags = await getChapterFlags(slug, chapter);
  if (!flags.exists) return res.status(404).json({ error: "Nincs ilyen fejezet." });
  const deny = await denyReason({ id: req.appUser.id, role: req.appUser.role }, flags);
  if (deny === "locked") return res.status(403).json({ error: "Ez a fejezet még csak támogatóknak érhető el.", reason: deny });
  if (deny) return res.status(403).json({ error: "Ehhez a fejezethez nincs hozzáférésed.", reason: deny });

  const q = await quota(req.appUser);
  const already = await pool.query(
    `SELECT 1 FROM app_downloads WHERE user_id = $1 AND manga_slug = $2 AND chapter = $3 AND status <> 'failed'
        AND created_at > now() - interval '30 days' LIMIT 1`, [req.appUser.id, slug, chapter]);
  if (!already.rows.length && q.left <= 0) {
    return res.status(429).json({ error: `Elérted a napi letöltési keretet (${q.limit} fejezet).${q.patron ? "" : " Támogatóként többet tölthetsz le."}`,
      reason: "quota", retry_after: 3600, quota: q });
  }
  // Oldalszintű terheléskorlát: ha sok letöltés fut épp, az app később próbálja újra (szórással)
  const act = await pool.query(`SELECT count(*)::int AS n FROM app_downloads WHERE status = 'issued' AND created_at > now() - interval '${ACTIVE_WINDOW}'`);
  if (act.rows[0].n >= MAX_ACTIVE) {
    return res.status(503).json({ error: "Most sokan töltenek le, a letöltés pár perc múlva magától folytatódik.", reason: "busy",
      retry_after: 120 + Math.floor(Math.random() * 240) });
  }

  const pages = await chapterPages(slug, chapter);
  if (!pages) return res.status(404).json({ error: "A fejezet képei nem találhatók." });
  const { rows } = await pool.query(
    "INSERT INTO app_downloads (user_id, manga_slug, chapter, pages) VALUES ($1, $2, $3, $4) RETURNING id",
    [req.appUser.id, slug, chapter, pages.files.length]);
  const id = rows[0].id;
  const list = [];
  for (let i = 0; i < pages.files.length; i++) {
    const f = pages.files[i];
    const url = pages.remote
      ? await getPresignedUrl(localPathToR2Key(`${pages.base}/${f}`.replace(/\/+/g, "/")), URL_TTL)
      : `${SITE}/api/app/page/${id}/${i}`;
    list.push({ index: i, name: f, url, auth: !pages.remote });
  }
  res.json({ download_id: id, slug, chapter, expires_in: URL_TTL, pages: list, quota: await quota(req.appUser) });
});

// Csak helyben tárolt fejezet képe (ritka): a kiadott letöltés tulajdonosának, 30 percig
router.get("/page/:id/:i", appAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT manga_slug, chapter FROM app_downloads WHERE id = $1 AND user_id = $2 AND created_at > now() - interval '30 minutes'`,
    [req.params.id, req.appUser.id]);
  if (!rows[0]) return res.status(404).end();
  const pages = await chapterPages(rows[0].manga_slug, rows[0].chapter);
  const f = pages?.files[Number(req.params.i)];
  if (!f || pages.remote) return res.status(404).end();
  res.sendFile(path.join(pages.base, f));
});

router.post("/download/:id/done", appAuth, express.json(), async (req, res) => {
  const ok = req.body?.ok !== false;
  await pool.query(
    `UPDATE app_downloads SET status = $1, finished_at = now(), bytes = $2 WHERE id = $3 AND user_id = $4 AND status = 'issued'`,
    [ok ? "done" : "failed", Number(req.body?.bytes) || null, req.params.id, req.appUser.id]);
  res.json({ ok: true });
});

/* ── Tesztverzió letöltése (APK) — egyelőre csak a tesztelőknek (APP_TESTERS, alap: 5 = Ascyra) ── */
const APK_DIR = process.env.APP_APK_DIR || "/srv/padlizsan-android-dist";
const appTesters = () => new Set(String(process.env.APP_TESTERS || "5").split(",").map(s => parseInt(s, 10)).filter(Boolean));
router.get("/apk", requireLogin, (req, res) => {
  if (!appTesters().has(req.session.user.id)) return res.status(403).send("Az Android-app még tesztelés alatt áll.");
  const files = fs.existsSync(APK_DIR) ? fs.readdirSync(APK_DIR).filter(f => f.endsWith(".apk"))
    .map(f => ({ f, t: fs.statSync(path.join(APK_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t) : [];
  if (!files.length) return res.status(404).send("Még nincs letölthető verzió.");
  res.download(path.join(APK_DIR, files[0].f), files[0].f);
});

export default router;
