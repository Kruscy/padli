/* ── Padlizsan Studio: letöltés, verzió, statisztika (2026-11-08) ──────
   • GET /api/studio/info       – (session) letölthet-e, a legújabb csomag adatai
   • GET /api/studio/download   – (session) MINDIG a legújabb ZIP; böngészőből
                                  belépés/jogosultság nélkül a profilra irányít
   • GET /api/studio/latest     – (nyilvános) a legújabb verzió – a program ebből
                                  látja, hogy van-e frissítés
   • GET /api/studio/my-stats   – (session) a saját Studio-fordítások havonta
   • GET /api/studio/admin/*    – (csak tulajdonos) használat, haszon, beállítás
   Letölthet: a STUDIO_TESTERS (alap: 5 = Ascyra), vagy mindenki, ha az admin
   fülön a „nyilvános letöltés” be van kapcsolva (studio_settings).
   A ZIP a /opt/padli/studio-dist mappában van (nem public/, nincs gitben);
   a verziót a csomagban lévő app/version.json adja (régi csomag: 2.0.0). ── */
import express from "express";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { SCAN_OWNER_USER_ID } from "../lib/scan-runner.js";
import { POINT_FT, USD_HUF } from "../lib/llm-pricing.js";

const router = express.Router();
const DIST_DIR = process.env.STUDIO_DIST_DIR || "/opt/padli/studio-dist";
const SITE = (process.env.SITE_URL || "https://padlizsanfansub.hu").replace(/\/$/, "");
const testers = () => new Set(String(process.env.STUDIO_TESTERS || "5").split(",").map(s => parseInt(s, 10)).filter(Boolean));

async function publicDownload() {
  try {
    const { rows } = await pool.query("SELECT value FROM studio_settings WHERE key = 'public_download'");
    return rows[0]?.value === "true";
  } catch { return false; }
}
async function canDownload(user) {
  if (!user) return false;
  return testers().has(user.id) || await publicDownload();
}

function latestZip() {
  try {
    return fs.readdirSync(DIST_DIR)
      .filter(f => /\.zip$/i.test(f))
      .map(f => ({ name: f, stat: fs.statSync(path.join(DIST_DIR, f)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] || null;
  } catch { return null; }
}

// a csomag verziója (app/version.json a ZIP-ben), mtime szerint gyorsítótárazva
const verCache = new Map();
function zipVersion(z) {
  const key = `${z.name}|${z.stat.mtimeMs}`;
  if (verCache.has(key)) return Promise.resolve(verCache.get(key));
  return new Promise(resolve => {
    execFile("unzip", ["-p", path.join(DIST_DIR, z.name), "*/app/version.json"], { timeout: 15000, maxBuffer: 1 << 16 }, (err, out) => {
      let v = { version: "2.0.0", notes: "" };
      try { if (!err && out) v = { ...v, ...JSON.parse(String(out)) }; } catch { /* régi csomag */ }
      verCache.set(key, v);
      resolve(v);
    });
  });
}

/* ── Telepítő (Setup.exe) a ZIP-ből, automatikusan (2026-11-08) ──
   Ha a legújabb ZIP verziójához még nincs Padlizsan-Studio-Setup-<v>.exe, a háttérben
   megépítjük (NSIS, a studio-repó gui/installer/build-installer.sh-ja). A letöltés
   alapból a telepítőt adja (asztali ikon, Start menü, eltávolító), a ZIP ?type=zip-pel. */
const INSTALLER_SCRIPT = process.env.STUDIO_INSTALLER_SCRIPT || "/opt/padlizsan-studio-src/gui/installer/build-installer.sh";
const setupName = v => `Padlizsan-Studio-Setup-${v}.exe`;
let building = null;
function installerFor(version) {
  if (building === version) return null; // épp íródik: félkész fájlt nem adunk ki
  const f = path.join(DIST_DIR, setupName(version));
  try { const st = fs.statSync(f); return { name: setupName(version), size: st.size, date: st.mtime }; } catch { return null; }
}
function ensureInstaller(z, version) {
  if (building || installerFor(version) || !fs.existsSync(INSTALLER_SCRIPT)) return;
  building = version;
  console.log(`[STUDIO] telepítő építése: v${version} (${z.name})`);
  // ideiglenes mappába épül, és csak kész állapotban kerül a helyére (különben a félkész exe letölthető volt)
  const tmpDir = fs.mkdtempSync(path.join(DIST_DIR, ".build-"));
  execFile(INSTALLER_SCRIPT, [path.join(DIST_DIR, z.name), tmpDir], { timeout: 15 * 60_000, maxBuffer: 1 << 20 }, (err, out, errOut) => {
    try { if (!err) fs.renameSync(path.join(tmpDir, setupName(version)), path.join(DIST_DIR, setupName(version))); }
    catch (e) { err = e; }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    building = null;
    if (err) { console.error(`[STUDIO] telepítő építése sikertelen: ${err.message} ${String(errOut).slice(-300)}`); return; }
    console.log(`[STUDIO] ${String(out).trim().split("\n").pop()}`);
    // a régi telepítők közül a legutóbbi 3 marad
    try {
      fs.readdirSync(DIST_DIR).filter(f => /^Padlizsan-Studio-Setup-.*\.exe$/.test(f))
        .map(f => ({ f, t: fs.statSync(path.join(DIST_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t)
        .slice(3).forEach(x => fs.unlinkSync(path.join(DIST_DIR, x.f)));
    } catch { /* takarítás nem kritikus */ }
  });
}

async function latestInfo() {
  const z = latestZip();
  if (!z) return null;
  const v = await zipVersion(z);
  ensureInstaller(z, v.version);
  return { name: z.name, size: z.stat.size, date: z.stat.mtime, version: v.version, notes: v.notes || "",
           installer: installerFor(v.version), installerBuilding: building === v.version };
}

router.get("/info", requireLogin, async (req, res) => {
  const allowed = await canDownload(req.session.user);
  if (!allowed) return res.json({ allowed: false });
  res.json({ allowed: true, file: await latestInfo(), url: `${SITE}/api/studio/download` });
});

// Nyilvános: a program ebből látja, van-e újabb verzió (a letöltéshez belépés kell)
router.get("/latest", async (req, res) => {
  const info = await latestInfo();
  res.setHeader("Cache-Control", "public, max-age=300");
  if (!info) return res.status(404).json({ error: "Még nincs kiadott csomag" });
  res.json({ version: info.version, notes: info.notes, date: info.date, size: info.size, url: `${SITE}/api/studio/download` });
});

/* ── Letöltésszámlálás + egyszeri ajándékpont (2026-11-09) ──
   Minden letöltés bekerül a studio_downloads-ba. Az első letöltésért STUDIO_GIFT_POINTS
   (alap 30) pont jár, felhasználónként EGYSZER (studio_gifts PK), csak megerősített
   e-mail-címmel (a tömeges kamufiókos pontgyűjtés ellen), értesítéssel. */
const GIFT_POINTS = Number(process.env.STUDIO_GIFT_POINTS) || 30;
pool.query(`CREATE TABLE IF NOT EXISTS studio_downloads (
  id serial PRIMARY KEY, user_id integer REFERENCES users(id) ON DELETE SET NULL,
  version text, file text, ip text, created_at timestamptz NOT NULL DEFAULT now())`).catch(e => console.error("[STUDIO] tábla:", e.message));
pool.query(`CREATE TABLE IF NOT EXISTS studio_gifts (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  points integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`).catch(e => console.error("[STUDIO] tábla:", e.message));

async function recordDownload(req, info, file) {
  const u = req.session.user;
  await pool.query("INSERT INTO studio_downloads (user_id, version, file, ip) VALUES ($1,$2,$3,$4)",
    [u.id, info.version, file, req.headers["cf-connecting-ip"] || req.ip || null]);
  const { rows } = await pool.query("SELECT email_verified FROM users WHERE id = $1", [u.id]);
  if (!rows[0]?.email_verified) return;
  const ip = req.headers["cf-connecting-ip"] || req.ip || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    /* Egy hálózatról (IPv4: azonos cím, IPv6: azonos /64 – a háztartás) csak egy ajándék jár (2026-11-10):
       ha erről a hálózatról már letöltött valaki, aki kapott ajándékot, ez a fiók nem kap. */
    if (ip) {
      const net = `network(set_masklen(X::inet, CASE WHEN family(X::inet) = 6 THEN 64 ELSE 32 END))`;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('studio-gift:' || " + net.replaceAll("X", "$1") + "::text))", [ip]);
      const dup = await client.query(
        `SELECT u.username FROM studio_downloads d JOIN studio_gifts g ON g.user_id = d.user_id JOIN users u ON u.id = d.user_id
          WHERE d.user_id <> $2 AND d.ip IS NOT NULL AND ${net.replaceAll("X", "d.ip")} = ${net.replaceAll("X", "$1")} LIMIT 1`, [ip, u.id]);
      if (dup.rowCount) {
        await client.query("ROLLBACK");
        console.log(`[STUDIO] ajándék kihagyva: ${u.username} – erről a hálózatról már kapott ${dup.rows[0].username}`);
        return;
      }
    }
    const g = await client.query("INSERT INTO studio_gifts (user_id, points) VALUES ($1,$2) ON CONFLICT DO NOTHING", [u.id, GIFT_POINTS]);
    if (!g.rowCount) { await client.query("ROLLBACK"); return; } // már kapott
    await client.query(`INSERT INTO user_points (user_id, fix_id, points, approved_by, earned_at, spent) VALUES ($1, NULL, $2, NULL, NOW(), false)`, [u.id, GIFT_POINTS]);
    await client.query(`INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'points', $2, '/profile.html#studio')`,
      [u.id, `🎁 Köszönjük, hogy letöltötted a Padlizsan Studio-t! Ajándékba ${GIFT_POINTS} pontot írtunk jóvá a fiókodon. Az API-kulcsodat a profilodon hozhatod létre.`]);
    await client.query("COMMIT");
    console.log(`[STUDIO] ajándék: ${u.username} +${GIFT_POINTS} pont`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[STUDIO] ajándékpont:", e.message);
  } finally { client.release(); }
}

// Mindig a legújabb. Böngészőből (nincs belépve / nincs joga) a profilra irányít.
router.get("/download", async (req, res) => {
  const wantsHtml = /text\/html/.test(req.headers.accept || "");
  if (!(await canDownload(req.session?.user))) {
    if (wantsHtml) return res.redirect(302, req.session?.user ? "/profile.html#studio" : "/login.html?redirect=" + encodeURIComponent("/api/studio/download"));
    return res.status(req.session?.user ? 404 : 401).json({ error: req.session?.user ? "Nem található" : "Login required" });
  }
  const info = await latestInfo();
  if (!info) return wantsHtml ? res.redirect(302, "/profile.html#studio") : res.status(404).json({ error: "Még nincs feltöltött csomag" });
  // alapból a telepítő; ?type=zip vagy ha még nincs kész telepítő: a ZIP
  const file = req.query.type !== "zip" && info.installer ? info.installer.name : info.name;
  console.log(`[STUDIO] letöltés: ${req.session.user.username} → ${file}`);
  recordDownload(req, info, file).catch(e => console.error("[STUDIO] letöltés-napló:", e.message));
  res.setHeader("Cache-Control", "no-store");
  res.download(path.join(DIST_DIR, file), file);
});

/* ── Statisztika ─────────────────────────────────────────────── */
const monthRange = (q) => {
  const now = new Date();
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(q || "") ? q : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { month: m, start: `${m}-01`, end: `${m}-01` };
};

// Egy hónap Studio-használata soronként (felhőben Torii, helyi motor GPT, szövegfordító)
async function usageRows(month, userId = null) {
  const params = [`${month}-01`];
  let userCond = "";
  if (userId) { params.push(userId); userCond = "AND user_id = $2"; }
  const { rows } = await pool.query(`
    SELECT user_id, username, 'felhő' AS mode, translator AS model, to_char(created_at AT TIME ZONE 'Europe/Budapest', 'YYYY-MM-DD') AS day,
           1 AS pages, points_milli / 1000.0 AS points,
           CASE WHEN cost_ft > 0 THEN cost_ft ELSE credits * 0.465 END AS cost_ft
      FROM pc_torii_usage
     WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 month') ${userCond}
    UNION ALL
    SELECT user_id, username, 'helyi', model, to_char(created_at AT TIME ZONE 'Europe/Budapest', 'YYYY-MM-DD'), 1, points_milli / 1000.0, cost_usd * ${USD_HUF}
      FROM pc_llm_usage
     WHERE ok AND created_at >= $1::date AND created_at < ($1::date + interval '1 month') ${userCond}
    UNION ALL
    SELECT user_id, username, 'szövegfordító', model, to_char(created_at AT TIME ZONE 'Europe/Budapest', 'YYYY-MM-DD'), pages, points, cost_usd * ${USD_HUF}
      FROM pc_text_usage
     WHERE ok AND created_at >= $1::date AND created_at < ($1::date + interval '1 month') ${userCond}`, params);
  return rows.map(r => ({ ...r, points: Number(r.points), cost_ft: Number(r.cost_ft), day: r.day }));
}

function summarize(rows) {
  const by = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const e = m.get(k) || { key: k, pages: 0, points: 0, cost_ft: 0 };
      e.pages += r.pages; e.points += r.points; e.cost_ft += r.cost_ft;
      m.set(k, e);
    }
    return [...m.values()].map(e => ({ ...e, points: +e.points.toFixed(3), cost_ft: +e.cost_ft.toFixed(2) }));
  };
  return {
    pages: rows.reduce((a, r) => a + r.pages, 0),
    points: +rows.reduce((a, r) => a + r.points, 0).toFixed(3),
    cost_ft: +rows.reduce((a, r) => a + r.cost_ft, 0).toFixed(2),
    byModel: by(r => `${r.mode} · ${r.model}`).sort((a, b) => b.points - a.points),
    byDay: by(r => r.day).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// Saját statisztika: oldalak, pontok, modellek, napok (a mi költségünk nélkül).
// A program is ezt kapja az API-kulcsával (/api/pc/v1/stats).
export async function userStudioStats(userId, monthQuery) {
  const { month } = monthRange(monthQuery);
  const s = summarize(await usageRows(month, userId));
  return {
    month, pages: s.pages, points: s.points,
    byModel: s.byModel.map(({ cost_ft, ...x }) => x),
    byDay: s.byDay.map(({ cost_ft, ...x }) => x),
  };
}

router.get("/my-stats", requireLogin, async (req, res) => {
  try {
    res.json(await userStudioStats(req.session.user.id, req.query.month));
  } catch (err) {
    console.error("[STUDIO] my-stats:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── Admin (csak tulajdonos) ─────────────────────────────────── */
const admin = express.Router();
admin.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin" || req.session.user.id !== SCAN_OWNER_USER_ID) return res.status(403).json({ error: "Forbidden" });
  next();
});

admin.get("/overview", async (req, res) => {
  try {
    const { month } = monthRange(req.query.month);
    const rows = await usageRows(month);
    const s = summarize(rows);
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    const names = new Map();
    if (userIds.length) {
      const { rows: u } = await pool.query("SELECT id, username FROM users WHERE id = ANY($1)", [userIds]);
      for (const x of u) names.set(x.id, x.username);
    }
    const perUser = new Map();
    // Törölt fióknál (user_id = NULL) a naplóban eltárolt név látszik (2026-11-11)
    for (const r of rows) {
      const key = r.user_id ?? `torolt:${r.username || ""}`;
      const user = r.user_id
        ? (names.get(r.user_id) || r.username || `#${r.user_id}`)
        : (r.username ? `${r.username} (törölt fiók)` : "Törölt fiók");
      const e = perUser.get(key) || { user, pages: 0, points: 0, cost_ft: 0, modes: new Set() };
      e.pages += r.pages; e.points += r.points; e.cost_ft += r.cost_ft; e.modes.add(r.mode);
      perUser.set(key, e);
    }
    const users = [...perUser.values()].map(e => ({
      user: e.user, pages: e.pages, points: +e.points.toFixed(2), modes: [...e.modes],
      revenue_ft: +(e.points * POINT_FT).toFixed(0), cost_ft: +e.cost_ft.toFixed(0),
      profit_ft: +(e.points * POINT_FT - e.cost_ft).toFixed(0),
    })).sort((a, b) => b.pages - a.pages);
    const { rows: keys } = await pool.query(`
      SELECT u.username, count(*)::int AS keys, max(k.last_used_at) AS last_used
        FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.revoked_at IS NULL GROUP BY u.username ORDER BY max(k.last_used_at) DESC NULLS LAST`);
    res.json({
      month, latest: await latestInfo(), publicDownload: await publicDownload(),
      testers: [...testers()], pointFt: POINT_FT,
      total: { pages: s.pages, points: s.points, revenue_ft: +(s.points * POINT_FT).toFixed(0), cost_ft: +s.cost_ft.toFixed(0), profit_ft: +(s.points * POINT_FT - s.cost_ft).toFixed(0) },
      users,
      byModel: s.byModel.map(m => ({ ...m, revenue_ft: +(m.points * POINT_FT).toFixed(0), cost_ft: +m.cost_ft.toFixed(0) })),
      byDay: s.byDay,
      keyHolders: keys,
      downloads: (await pool.query(`SELECT count(*)::int AS total, count(DISTINCT user_id)::int AS users,
                   (SELECT count(*)::int FROM studio_gifts) AS gifts,
                   (SELECT COALESCE(sum(points),0)::int FROM studio_gifts) AS gift_points,
                   count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today
                   FROM studio_downloads`)).rows[0],
    });
  } catch (err) {
    console.error("[STUDIO] admin overview:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

admin.post("/settings", async (req, res) => {
  const v = req.body?.publicDownload === true ? "true" : "false";
  await pool.query(`INSERT INTO studio_settings (key, value, updated_at) VALUES ('public_download', $1, now())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [v]);
  console.log(`[STUDIO] nyilvános letöltés: ${v} (${req.session.user.username})`);
  res.json({ ok: true, publicDownload: v === "true" });
});

router.use("/admin", admin);

export default router;
