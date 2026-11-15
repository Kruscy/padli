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
import { getNewMangaCache } from "../cache/new-manga.js";
import { resolveUser, forgetTokens } from "../lib/flex-auth.js";
import { createApiKey } from "../lib/api-keys.js";
import { logSecurityEvent } from "../lib/security-log.js";

const router = express.Router();
const SITE = "https://padlizsanfansub.hu";
const TOKEN_PREFIX = "pdla_";
const FREE_PER_DAY = parseInt(process.env.APP_DL_FREE_PER_DAY || "10", 10);
const PATRON_PER_DAY = parseInt(process.env.APP_DL_PATRON_PER_DAY || "200", 10);
// Ideiglenes emelés (pl. áramszünet előtt): APP_DL_FREE_BOOST=50, APP_DL_BOOST_UNTIL=2026-11-19T00:00:00+01:00
const freeLimit = () => {
  const until = Date.parse(process.env.APP_DL_BOOST_UNTIL || "");
  return until && Date.now() < until ? parseInt(process.env.APP_DL_FREE_BOOST || String(FREE_PER_DAY), 10) : FREE_PER_DAY;
};
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
  // PKCE (2026-11-15): az app egy titkos „verifier” S256-ujjlenyomatát küldi; a kódot csak az válthatja be, aki a
  // verifiert is ismeri — így egy elkapott kód (pl. a padlizsan:// linkre jelentkező kártékony app) használhatatlan
  const challenge = String(req.body?.code_challenge || "");
  if (challenge && !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return res.status(400).json({ error: "Hibás kérés (challenge)." });
  if (!challenge && process.env.APP_PKCE_REQUIRED === "1") return res.status(400).json({ error: "Frissítsd az alkalmazást." });
  const code = crypto.randomBytes(24).toString("base64url");
  await pool.query("INSERT INTO app_auth_codes (code_hash, user_id, state, device, code_challenge) VALUES ($1, $2, $3, $4, $5)",
    [sha(code), req.session.user.id, state, String(req.body?.device || "").slice(0, 80) || null, challenge || null]);
  // Asztali Studio: a gépen futó saját szerverére irányítunk vissza (csak 127.0.0.1, csak port) — 2026-11-15
  const ret = /^local:(\d{2,5})$/.exec(String(req.body?.return || ""));
  const q = `code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  res.json({ ok: true, redirect: ret ? `http://127.0.0.1:${Number(ret[1])}/auth-callback?${q}` : `padlizsan://auth?${q}` });
});

// Az app beváltja a kódot (5 percig érvényes, egyszer használható, a state-nek egyeznie kell)
router.post("/auth/token", express.json(), async (req, res) => {
  const code = String(req.body?.code || ""), state = String(req.body?.state || "");
  const { rows } = await pool.query(
    `UPDATE app_auth_codes SET used_at = now()
      WHERE code_hash = $1 AND state = $2 AND used_at IS NULL AND created_at > now() - interval '5 minutes'
      RETURNING user_id, device, code_challenge`, [sha(code), state]);
  if (!rows[0]) return res.status(400).json({ error: "A belépési kód lejárt vagy érvénytelen. Próbáld újra." });
  if (rows[0].code_challenge) {
    const v = String(req.body?.code_verifier || "");
    const ok = /^[A-Za-z0-9._~-]{43,128}$/.test(v) && crypto.createHash("sha256").update(v).digest("base64url") === rows[0].code_challenge;
    if (!ok) return res.status(400).json({ error: "A belépés nem igazolható. Próbáld újra." });
  }
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO app_tokens (user_id, token_hash, device) VALUES ($1, $2, $3)", [rows[0].user_id, sha(token), rows[0].device]);
  const u = await pool.query("SELECT username FROM users WHERE id = $1", [rows[0].user_id]);
  res.json({ ok: true, token, username: u.rows[0]?.username });
});

/* Megosztott fiók gyanúja: egy app-token 24 órán belül hány különböző hálózatról (IP első két tagja) és
   országból jelentkezik. Telefonon a wifi/mobilnet váltás 2–3 hálózat — 6 fölött vagy 2 országnál több már gyanús. */
const spread = new Map();   // token_id → { nets: Map(net→ts), countries: Map(cc→ts) }
setInterval(() => { const lim = Date.now() - 24 * 3600e3;
  for (const [k, v] of spread) { for (const m of [v.nets, v.countries]) for (const [x, t] of m) if (t < lim) m.delete(x); if (!v.nets.size) spread.delete(k); }
}, 3600e3).unref();
function trackTokenSpread(req, u) {
  const ip = String(ipOf(req) || ""), cc = req.headers["cf-ipcountry"] || "?";
  const net = ip.includes(":") ? ip.split(":").slice(0, 3).join(":") : ip.split(".").slice(0, 2).join(".");
  const e = spread.get(u.token_id) || { nets: new Map(), countries: new Map() };
  const now = Date.now(); e.nets.set(net, now); e.countries.set(cc, now); spread.set(u.token_id, e);
  if (e.nets.size > 6 || e.countries.size > 2) {
    logSecurityEvent({ req, type: "app_token_spread", severity: "warn", userId: u.id, username: u.username, dedupeKey: `tok:${u.token_id}`,
      details: { token: u.token_id, device: u.device || null, nets: e.nets.size, countries: e.countries.size } });
  }
}

// Bearer-token → req.appUser = { id, username, role }
async function appAuth(req, res, next) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  // Asztali Padlizsan Studio: ugyanezek az adatok az API-kulccsal (X-API-Key: pdl_…) — 2026-11-15
  if (!tok.startsWith(TOKEN_PREFIX) && req.headers["x-api-key"]) {
    const u = await resolveUser({ headers: { "x-api-key": req.headers["x-api-key"], "cf-connecting-ip": req.headers["cf-connecting-ip"] }, ip: req.ip }).catch(() => null);
    if (u) { req.appUser = { id: u.id, username: u.username, role: u.role, token_id: null, viaKey: true }; return next(); }
  }
  if (!tok.startsWith(TOKEN_PREFIX)) return res.status(401).json({ error: "Jelentkezz be az appban." });
  const { rows } = await pool.query(
    `SELECT t.id AS token_id, t.device, u.id, u.username, u.role FROM app_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`, [sha(tok)]);
  if (!rows[0]) return res.status(401).json({ error: "A belépésed lejárt, jelentkezz be újra." });
  req.appUser = rows[0];
  trackTokenSpread(req, rows[0]);
  pool.query("UPDATE app_tokens SET last_used_at = now(), last_ip = $2 WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')",
    [rows[0].token_id, ipOf(req)]).catch(() => {});
  next();
}

/* ── Bejelentkezett eszközeim (profil) — 2026-11-15 ── */
router.get("/devices", requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, device, created_at, last_used_at, last_ip FROM app_tokens
      WHERE user_id = $1 AND revoked_at IS NULL ORDER BY COALESCE(last_used_at, created_at) DESC`, [req.session.user.id]);
  // IP-cím csak részben (az első két tag), elég a felismeréshez
  res.json({ devices: rows.map(r => ({ ...r, last_ip: r.last_ip ? r.last_ip.split(/[.:]/).slice(0, 2).join(r.last_ip.includes(":") ? ":" : ".") + (r.last_ip.includes(":") ? ":…" : ".x.x") : null })) });
});
router.post("/devices/:id/revoke", requireLogin, async (req, res) => {
  const { rowCount } = await pool.query("UPDATE app_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    [Number(req.params.id) || 0, req.session.user.id]);
  forgetTokens();
  res.json({ ok: rowCount > 0 });
});

/* Asztali Studio belépés után: fordítási API-kulcs automatikusan (a felhasználónak nem kell kulccsal bajlódnia).
   Csak app-tokennel (böngészős engedélyezés után) kérhető; a korábbi automatikus kulcsot visszavonjuk. */
router.post("/studio-key", appAuth, async (req, res) => {
  if (!req.appUser.token_id) return res.status(403).json({ error: "Csak belépett alkalmazás kérhet kulcsot." });
  const LABEL = "Padlizsan Studio (automatikus)";
  await pool.query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND label = $2 AND revoked_at IS NULL", [req.appUser.id, LABEL]);
  try {
    const k = await createApiKey(req.appUser.id, LABEL);
    res.json({ ok: true, key: k.key });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Nem sikerült kulcsot készíteni." });
  }
});

router.post("/auth/logout", appAuth, async (req, res) => {
  if (req.appUser.token_id) await pool.query("UPDATE app_tokens SET revoked_at = now() WHERE id = $1", [req.appUser.token_id]);
  forgetTokens();
  res.json({ ok: true });
});

/* ── Keret ── */
async function isPatron(userId) {
  const { rows } = await pool.query("SELECT 1 FROM patreon_status WHERE user_id = $1 AND active = true LIMIT 1", [userId]);
  return rows.length > 0;
}
async function quota(user) {
  const patron = user.role === "admin" || await isPatron(user.id);
  const limit = patron ? PATRON_PER_DAY : freeLimit();
  // Ugyanannak a fejezetnek az újbóli letöltése 30 napon belül nem számít bele
  const { rows } = await pool.query(
    `SELECT count(DISTINCT (manga_slug, chapter))::int AS n FROM app_downloads d
      WHERE d.user_id = $1 AND d.created_at > now() - interval '24 hours' AND d.status <> 'failed'
        AND NOT EXISTS (SELECT 1 FROM app_downloads p WHERE p.user_id = d.user_id AND p.manga_slug = d.manga_slug
                          AND p.chapter = d.chapter AND p.status = 'done' AND p.created_at < now() - interval '24 hours'
                          AND p.created_at > now() - interval '30 days')`, [user.id]);
  return { patron, limit, used: rows[0].n, left: Math.max(0, limit - rows[0].n) };
}

/* 18+ mód: az app ?adult=1-gyel kéri, és csak igazoltan nagykorú (vagy admin) kapja meg — mint a weboldalon */
async function adultOn(req) {
  if (req.query.adult !== "1") return false;
  if (req.appUser.role === "admin") return true;
  const { rows } = await pool.query("SELECT birth_date FROM users WHERE id = $1", [req.appUser.id]);
  return isAdultVerified(rows[0]?.birth_date);
}

router.get("/me", appAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT avatar, birth_date FROM users WHERE id = $1", [req.appUser.id]);
  const av = rows[0]?.avatar || "/assets/logo.png";
  res.json({
    username: req.appUser.username, role: req.appUser.role,
    avatar: av.startsWith("http") ? av : SITE + (av.startsWith("/") ? "" : "/") + av,
    adult_verified: req.appUser.role === "admin" || isAdultVerified(rows[0]?.birth_date),
    quota: await quota(req.appUser),
  });
});

/* Könyvespolc (want_to_read) — mint a weboldalon */
router.get("/shelf", appAuth, async (req, res) => {
  const adult = await adultOn(req);
  const { rows } = await pool.query(`
    SELECT m.slug, m.title, m.cover_url, rp.chapter
      FROM want_to_read w JOIN manga m ON m.id = w.manga_id
      LEFT JOIN reading_progress rp ON rp.manga_id = m.id AND rp.user_id = w.user_id
     WHERE w.user_id = $1 AND (${ADULT_GENRE_EXISTS_SQL}) = $2
     ORDER BY w.created_at DESC`, [req.appUser.id, adult]);
  res.json({ items: rows });
});
router.post("/want/:slug", appAuth, async (req, res) => {
  const m = await pool.query("SELECT id FROM manga WHERE slug = $1 ORDER BY id DESC LIMIT 1", [req.params.slug]);
  if (!m.rows[0]) return res.status(404).json({ error: "Nincs ilyen mű." });
  const del = await pool.query("DELETE FROM want_to_read WHERE user_id = $1 AND manga_id = $2", [req.appUser.id, m.rows[0].id]);
  if (del.rowCount) return res.json({ wanted: false });
  await pool.query("INSERT INTO want_to_read (user_id, manga_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.appUser.id, m.rows[0].id]);
  res.json({ wanted: true });
});

/* Minden sorozat (cím szerint), 10 percig gyorsítótárazva */
const allCache = new Map();
router.get("/all", appAuth, async (req, res) => {
  const adult = await adultOn(req);
  const hit = allCache.get(adult);
  if (hit && Date.now() - hit.at < 10 * 60_000) return res.json({ items: hit.items });
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (lower(m.title)) m.slug, m.title, m.cover_url FROM manga m
     WHERE (${ADULT_GENRE_EXISTS_SQL}) = $1 ORDER BY lower(m.title), m.id DESC`, [adult]);
  allCache.set(adult, { at: Date.now(), items: rows });
  res.json({ items: rows });
});

/* ── Kezdőlap: ugyanazok a blokkok, mint a weboldalon (2026-11-15) ──
   hírek (hero), napi kiemelt művek, Most olvasott, Új részek (7 nap), Új mangák. Az appban nincs 18+ mód. */
const homeCaches = new Map();   // adult → { at, data }
router.get("/home", appAuth, async (req, res) => {
  try {
    const adult = await adultOn(req);
    let homeCache = homeCaches.get(adult) || { at: 0, data: null };
    if (!homeCache.data || Date.now() - homeCache.at > 5 * 60_000) {
      const [ann, releases, featuredAll] = await Promise.all([
        pool.query(`SELECT id, title, body, image_url, cta_label, cta_url FROM announcements WHERE expires_at > now() AND COALESCE(cta_url, '') NOT IN ('/app.html', '/api/studio/download') ORDER BY created_at DESC LIMIT 10`),
        pool.query(`SELECT m.title, m.slug, m.cover_url, COUNT(c.id)::int AS new_count, MAX(c.scanned_at) AS latest_scan
                      FROM chapter c JOIN manga m ON m.id = c.manga_id
                     WHERE c.scanned_at >= now() - interval '7 days' AND (${ADULT_GENRE_EXISTS_SQL}) = $1
                     GROUP BY m.id ORDER BY latest_scan DESC LIMIT 40`, [adult]),
        pool.query(`SELECT title, slug, cover_url, description FROM manga m
                     WHERE cover_url IS NOT NULL AND description IS NOT NULL AND (${ADULT_GENRE_EXISTS_SQL}) = $1`, [adult]),
      ]);
      // napi kiemelt: a nap dátumával seedelt keverés (ugyanaz egész nap)
      const day = new Date().toISOString().slice(0, 10);
      let h = 0; for (const ch of day) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
      const rnd = () => { h = Math.imul(48271, h) % 0x7fffffff; return (h & 0xfffffff) / 0xfffffff; };
      const featured = [...featuredAll.rows].sort(() => rnd() - 0.5).slice(0, 5)
        .map(f => ({ ...f, description: String(f.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) }));
      let newManga = adult
        ? (await pool.query(`SELECT m.slug, m.title, m.cover_url FROM manga m WHERE ${ADULT_GENRE_EXISTS_SQL} ORDER BY m.id DESC LIMIT 30`)).rows
        : (getNewMangaCache() || []).slice(0, 30);
      if (!adult && newManga.length) {
        const { rows } = await pool.query(`SELECT DISTINCT ON (slug) slug, cover_url FROM manga WHERE slug = ANY($1) AND cover_url <> '' ORDER BY slug, id DESC`, [newManga.map(m => m.slug)]);
        const cov = new Map(rows.map(r => [r.slug, r.cover_url]));
        newManga = newManga.map(m => ({ slug: m.slug, title: m.title, cover_url: cov.get(m.slug) || m.cover_url }));
      }
      homeCache = { at: Date.now(), data: { announcements: ann.rows, featured, releases: releases.rows, newManga } };
      homeCaches.set(adult, homeCache);
    }
    // Most olvasott: a weboldali olvasás alapján, userenként
    const { rows: recent } = await pool.query(`
      SELECT DISTINCT ON (m.slug) m.slug, m.title, m.cover_url, rp.chapter, rp.page, rp.updated_at
        FROM reading_progress rp JOIN manga m ON m.id = rp.manga_id
       WHERE rp.user_id = $1 AND (${ADULT_GENRE_EXISTS_SQL}) = $2
       ORDER BY m.slug, rp.updated_at DESC`, [req.appUser.id, adult]);
    recent.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    res.json({ ...homeCache.data, recent: recent.slice(0, 20) });
  } catch (e) {
    console.error("[app] home:", e.message);
    res.status(500).json({ error: "Nem sikerült betölteni a kezdőlapot." });
  }
});

/* ── Online olvasás az appban (letöltés nélkül, keretbe nem számít) — ugyanaz a hozzáférés-döntés ── */
router.get("/read/:slug/:chapter", appAuth, async (req, res) => {
  if (req.appUser.viaKey) return res.status(403).json({ error: "Olvasáshoz és letöltéshez lépj be a weboldalon (a fordítási kulcs ehhez nem elég).", reason: "login", needLogin: true });
  const { slug } = req.params;
  let chapter = req.params.chapter;
  let flags = await getChapterFlags(slug, chapter);
  // A 0.3.3-as app a szóközt „+”-ként küldte (URL-űrlap kódolás) — visszafelé kompatibilisen elfogadjuk
  if (!flags.exists && chapter.includes("+")) { chapter = chapter.replace(/\+/g, " "); flags = await getChapterFlags(slug, chapter); }
  if (!flags.exists) return res.status(404).json({ error: "Nincs ilyen fejezet." });
  const deny = await denyReason({ id: req.appUser.id, role: req.appUser.role }, flags);
  if (deny === "locked") return res.status(403).json({ error: "Ez a fejezet még csak támogatóknak érhető el.", reason: deny });
  if (deny) return res.status(403).json({ error: "Ehhez a fejezethez nincs hozzáférésed.", reason: deny });
  const pages = await chapterPages(slug, chapter);
  if (!pages) return res.status(404).json({ error: "A fejezet képei nem találhatók." });
  // olvasási előrehaladás a weboldallal közösen (Most olvasott; highest_chapter csak felfelé)
  (async () => {
    const m = await pool.query("SELECT id FROM manga WHERE slug = $1 ORDER BY id DESC LIMIT 1", [slug]);
    if (!m.rows[0]) return;
    const cur = await pool.query("SELECT highest_chapter FROM reading_progress WHERE user_id = $1 AND manga_id = $2", [req.appUser.id, m.rows[0].id]);
    const num = s => parseFloat((String(s || "").match(/(\d+(?:\.\d+)?)/) || [0, -1])[1]);
    const highest = !cur.rows[0]?.highest_chapter || num(chapter) > num(cur.rows[0].highest_chapter) ? chapter : cur.rows[0].highest_chapter;
    await pool.query(`INSERT INTO reading_progress (user_id, manga_id, chapter, page, updated_at, highest_chapter) VALUES ($1, $2, $3, 0, now(), $4)
                      ON CONFLICT (user_id, manga_id) DO UPDATE SET chapter = EXCLUDED.chapter, page = 0, updated_at = now(), highest_chapter = $4`,
      [req.appUser.id, m.rows[0].id, chapter, highest]);
  })().catch(e => console.warn("[app] progress:", e.message));
  // A 0.3.6 előtti appok a képekhez nem küldenek tokent → nekik marad az aláírt R2-link
  const appVer = String(req.headers["x-app-version"] || "0").split(".").map(Number);
  const modern = (appVer[0] || 0) * 10000 + (appVer[1] || 0) * 100 + (appVer[2] || 0) >= 306;
  if (!modern) {
    if (!pages.remote) return res.status(409).json({ error: "Ez a fejezet még csak letöltve olvasható az appban." });
    const old = [];
    for (const f of pages.files) old.push(await getPresignedUrl(localPathToR2Key(`${pages.base}/${f}`.replace(/\/+/g, "/")), 3 * 3600));
    return res.json({ slug, chapter, pages: old });
  }
  // Ugyanaz a /api/image URL, mint a weboldali olvasóban → a Cloudflare-gyorsítótár közös, és a telefon is
  // eltárolja (az aláírt R2-linkek minden megnyitáskor mások voltak: se CDN-, se telefonos gyorsítótár)
  const fx = await pool.query(`SELECT image_file, EXTRACT(EPOCH FROM fixed_at)::bigint AS v FROM bug_fixes
                                WHERE manga_slug = $1 AND chapter = $2 AND is_applied = true`, [slug, chapter]).catch(() => ({ rows: [] }));
  const fixV = Object.fromEntries(fx.rows.filter(r => r.image_file).map(r => [r.image_file, Number(r.v)]));
  const urls = pages.files.map(f => `${SITE}/api/image/${encodeURIComponent(pages.library)}/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}/${encodeURIComponent(f)}?r2=1${fixV[f] ? "&v=" + fixV[f] : ""}`);
  res.json({ slug, chapter, pages: urls });
});

/* ── Böngészés ── */
router.get("/search", appAuth, async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q.length < 2) return res.json({ results: [] });
  const adult = await adultOn(req);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (m.slug) m.slug, m.title, m.cover_url FROM manga m
      WHERE (m.title ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(COALESCE(m.alt_titles, ARRAY[]::text[])) a WHERE a ILIKE $1))
        AND ($2 OR NOT ${ADULT_GENRE_EXISTS_SQL})
      ORDER BY m.slug, m.id DESC LIMIT 30`, [`%${q}%`, adult]);
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
  const extra = await pool.query(`
    SELECT COALESCE(ARRAY_AGG(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres,
           EXISTS (SELECT 1 FROM want_to_read w JOIN manga mm ON mm.id = w.manga_id WHERE mm.slug = $1 AND w.user_id = $2) AS in_shelf,
           (SELECT rp.chapter FROM reading_progress rp JOIN manga mm ON mm.id = rp.manga_id WHERE mm.slug = $1 AND rp.user_id = $2 ORDER BY rp.updated_at DESC LIMIT 1) AS last_read
      FROM manga m LEFT JOIN manga_genre mg ON mg.manga_id = m.id LEFT JOIN genre g ON g.id = mg.genre_id
     WHERE m.slug = $1`, [slug, req.appUser.id]);
  const x = extra.rows[0] || {};
  res.json({ slug, title: m.rows[0].title, description: m.rows[0].description, cover_url: m.rows[0].cover_url, ageBlocked, chapters,
    genres: x.genres || [], in_shelf: !!x.in_shelf, last_read: x.last_read || null });
});

/* ── Fejezet oldalai (ugyanaz a sorrend, mint a weboldali olvasónál) ── */
function pageNumber(f) {
  const m = f.replace(/\.[^.]+$/, "").match(/(\d+)(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}
async function chapterPages(slug, chapter) {
  const cands = await pool.query(
    `SELECT l.path AS lp, l.name AS lname, m.folder AS mf, m.r2_migrated FROM chapter c JOIN manga m ON m.id = c.manga_id
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
    return { files, remote, base: `${c.lp}/${c.mf}/${chapter}`, library: c.lname };
  }
  return null;
}

/* ── Letöltési engedély ── */
router.post("/download", appAuth, express.json(), async (req, res) => {
  if (req.appUser.viaKey) return res.status(403).json({ error: "Olvasáshoz és letöltéshez lépj be a weboldalon (a fordítási kulcs ehhez nem elég).", reason: "login", needLogin: true });
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
    // mikor szabadul fel hely: amikor a legrégebbi beszámított letöltés 24 órásnál régebbi lesz
    const o = await pool.query(`SELECT EXTRACT(EPOCH FROM (min(created_at) + interval '24 hours' - now()))::int AS s FROM app_downloads
                                 WHERE user_id = $1 AND status <> 'failed' AND created_at > now() - interval '24 hours'`, [req.appUser.id]);
    const retry = Math.max(300, (o.rows[0]?.s || 3600) + 60);
    res.locals.quotaLimit = true;
    return res.status(429).json({ error: `Elérted a napi letöltési keretet (${q.limit} fejezet).${q.patron ? "" : " Támogatóként többet tölthetsz le."}`,
      reason: "quota", retry_after: retry, quota: q });
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
  if (req.appUser.viaKey) return res.status(403).json({ error: "Olvasáshoz és letöltéshez lépj be a weboldalon (a fordítási kulcs ehhez nem elég).", reason: "login", needLogin: true });
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

/* ── Az app letöltése (APK) — 2026-11-15 óta mindenkinek (a használatához úgyis fiók kell) ── */
const APK_DIR = process.env.APP_APK_DIR || "/srv/padlizsan-android-dist";
const appTesters = () => new Set(String(process.env.APP_TESTERS || "5").split(",").map(s => parseInt(s, 10)).filter(Boolean));
function latestApk() {
  const files = fs.existsSync(APK_DIR) ? fs.readdirSync(APK_DIR).filter(f => f.endsWith(".apk"))
    .map(f => ({ f, t: fs.statSync(path.join(APK_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t) : [];
  return files[0]?.f || null;
}
router.get("/apk", (req, res) => {
  const f = latestApk();
  if (!f) return res.status(404).send("Még nincs letölthető verzió.");
  const ip = req.headers["cf-connecting-ip"] || req.ip;
  pool.query("INSERT INTO app_apk_downloads (user_id, file, ip) VALUES ($1, $2, $3)", [req.session?.user?.id || null, f, ip]).catch(() => {});
  res.download(path.join(APK_DIR, f), f);
});
router.get("/apk-info", async (req, res) => {
  const f = latestApk();
  const v = f?.match(/(\d+\.\d+\.\d+)/)?.[1] || null;
  const st = await pool.query(`SELECT
      (SELECT count(DISTINCT COALESCE(user_id::text, ip)) FROM app_apk_downloads)::int AS downloads,
      (SELECT count(DISTINCT user_id) FROM app_tokens WHERE revoked_at IS NULL)::int AS users`).catch(() => ({ rows: [{}] }));
  // Újdonságok: az APK mellett azonos nevű .txt (pl. Padlizsan-0.3.3.txt)
  let notes = "";
  try { if (f) notes = fs.readFileSync(path.join(APK_DIR, f.replace(/\.apk$/, ".txt")), "utf8").trim().slice(0, 2000); } catch {}
  res.json({ file: f, version: v, notes, url: SITE + "/api/app/apk", size: f ? fs.statSync(path.join(APK_DIR, f)).size : 0,
    downloads: st.rows[0].downloads ?? null, users: st.rows[0].users ?? null, free_limit: freeLimit(), patron_limit: PATRON_PER_DAY });
});

/* ── Visszajelzés / kérdőív a letöltő oldalról (és az appból) ── */
const WISHES = ["forditas", "ertesites", "lapozos", "tema", "kommentek", "kivansag", "szavazas", "tablet", "ios"];
const fbHits = new Map();
router.post("/feedback", express.json({ limit: "16kb" }), async (req, res) => {
  const ip = req.headers["cf-connecting-ip"] || req.ip;
  const now = Date.now();
  const h = (fbHits.get(ip) || []).filter(t => now - t < 3600_000);
  if (h.length >= 5) return res.status(429).json({ ok: false, error: "Túl sok beküldés, próbáld később." });
  h.push(now); fbHits.set(ip, h);
  const b = req.body || {};
  const t = (v, n) => String(v || "").trim().slice(0, n) || null;
  const wishes = Array.isArray(b.wishes) ? b.wishes.filter(w => WISHES.includes(w)).slice(0, 12) : [];
  const rating = Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5 ? b.rating : null;
  if (!wishes.length && !t(b.wish_text, 10) && !t(b.bug_text, 10) && !rating && !b.install) {
    return res.status(400).json({ ok: false, error: "Írj legalább egy választ." });
  }
  await pool.query(`INSERT INTO app_feedback (user_id, username, install, device, rating, wishes, wish_text, bug_text, helper, contact, ip)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [req.session?.user?.id || null, req.session?.user?.username || null, t(b.install, 30), t(b.device, 80), rating, wishes,
     t(b.wish_text, 3000), t(b.bug_text, 3000), !!b.helper, t(b.contact, 120), ip]);
  console.log(`[app] visszajelzés: ${req.session?.user?.username || "névtelen"} (${wishes.join(",")})`);
  res.json({ ok: true });
});

/* Google Play-feltöltéshez és áruházi anyagokhoz: a dist mappa fájljai a tesztelőknek (.aab, .png) */
router.get("/dist/:name", requireLogin, (req, res) => {
  if (!appTesters().has(req.session.user.id)) return res.status(403).send("Csak tesztelőknek.");
  const name = path.basename(String(req.params.name));
  if (!/^[A-Za-z0-9._-]+\.(aab|apk|png|jpg|txt|exe|zip)$/.test(name)) return res.status(400).send("Hibás fájlnév.");
  const f = path.join(APK_DIR, name);
  if (!fs.existsSync(f)) return res.status(404).send("Nincs ilyen fájl.");
  res.download(f, name);
});

export default router;
