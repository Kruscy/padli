import express from "express";
import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import { requireLogin } from "./middleware/auth.js";
import adminRoutes from "./routes/admin.js";
import { getSite, isOwner } from "./lib/site-config.js";
import { getClientIp } from "./lib/client-ip.js";
import { logSecurityEvent } from "./lib/security-log.js";
import { validatePassword, comparePasswordSafe, hashToken, destroyUserSessions,
         findUserByLogin, resolveStoredEmail, loginLockRemaining,
         registerLoginFailure, clearLoginFailures } from "./lib/auth-security.js";
import { randomBytes, createHash } from "crypto";
import { sendMail } from "./mail.js";
import wishlistRoutes from "./routes/wishlist.js";
import anilistRoutes from "./routes/anilist.js";
import settingsRoutes from "./routes/settings.js";
import patreonRoutes from "./routes/patreon.js";
import discordLinkRoutes from "./routes/discord-link.js";
import securityAdminRoutes from "./routes/security-admin.js";
import { getNewReleasesCache, setNewReleasesCache, clearNewReleasesCache} from "./cache/new-releases.js";
import { getNewMangaCache } from "./cache/new-manga.js";
import { resolveAdultMode, ADULT_GENRE_EXISTS_SQL } from "./lib/age.js";
import mangaRoutes from "./routes/manga.js";
import releasesRoutes from "./routes/releases.js";
import pollRoutes from "./routes/polls.js";
import statsRoutes from "./routes/stats.js";
import announcementRoutes from "./routes/announcements.js";
import mangaAdminRoutes from "./routes/manga-admin.js";
import shopRoutes from "./routes/shop.js";
import progressRoutes from "./routes/progress.js";
import ratingRoutes from "./routes/rating.js";
import chatRoutes from "./routes/chat.js";
import supportersRouter from "./routes/supporters.js";
import blogRoutes from "./routes/blog.js";
import padliAdminRoutes from "./routes/padli-admin.js";
import bugReportsRoutes from "./routes/bug-reports.js";
import chapterBugRoutes from "./routes/chapter-bug-reports.js";
import uploaderRoutes from "./routes/uploader.js";
import inpaintRoutes from "./routes/inpaint.js";
import translateRoutes from "./routes/translate.js";
import ocrRoutes from "./routes/ocr.js";
import geminiProxyRoutes from "./routes/gemini-proxy.js";
import pointsRoutes from "./routes/points.js";
import padlicromeRoutes from "./routes/padlicrome.js";
import gdprRoutes from "./routes/gdpr.js";
import patreonInvoiceRoutes from "./routes/patreon-invoice.js";
import animeSubtitlesRoutes from "./routes/anime-subtitles.js";
import { rateLimit } from "express-rate-limit";

const router = express.Router();

/* ── AI-/OCR-/inpaint-proxyk korlátja ─────────────────────────
   Ezek fizetős API-kvótát (DeepL/Gemini) és a belső hálózat gépeit
   (OCR, IOPaint) használják — korábban bejelentkezés nélkül is hívhatók
   voltak. Bejelentkezés kell hozzájuk, és felhasználónként korlátozzuk a
   kérésszámot (a bug-fix editor buborékonként 1-1 kérést küld). */
function aiLimiter(name, max) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${name}:${req.session.user.id}`,
    handler: (req, res, _next, options) => {
      logSecurityEvent({ req, type: "ai_rate_limited", severity: "warn", userId: req.session.user.id,
                         username: req.session.user.username, details: { endpoint: name } });
      res.status(options.statusCode).json({ error: "Túl sok kérés, próbáld újra később." });
    },
  });
}

/* ── Email verifikációs sablon ────────────────────────────── */
function verificationEmailHtml(username, link) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;padding:32px 28px">
    <img src="${getSite().url}/assets/logo.png" style="height:48px;margin-bottom:20px" alt="PadlizsanFanSub">
    <h2 style="color:#a78bfa;margin:0 0 12px">Erősítsd meg az email címed!</h2>
    <p style="color:#bbb;line-height:1.7">Szia <strong style="color:#fff">${username || "Felhasználó"}</strong>! Köszönjük a regisztrációt a PadlizsanFanSub oldalon.</p>
    <p style="color:#bbb;line-height:1.7">Kattints az alábbi gombra az email cím megerősítéséhez:</p>
    <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;margin:16px 0">
      ✉️ Email megerősítése
    </a>
    <p style="color:#888;font-size:0.82rem;margin-top:20px">A link 24 óráig érvényes. Ha nem te regisztráltál, hagyd figyelmen kívül ezt az emailt.</p>
    <hr style="border-color:#2a2a3a;margin:20px 0">
    <p style="color:#555;font-size:0.78rem">PadlizsanFanSub · padlizsanfansub.hu</p>
  </div>`;
}

/* ===== HEALTH (Docker healthcheck / monitoring) ===== */
// Nem ad ki belső adatot: csak azt jelzi, hogy a szerver és a DB elérhető.
router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.set("Cache-Control", "no-store").json({ ok: true });
  } catch {
    res.status(503).set("Cache-Control", "no-store").json({ ok: false });
  }
});

/* ===== CSP-JELENTÉSEK (Report-Only fejléc, lásd index.js) ===== */
// A böngésző küldi, ha egy oldalon még inline eseménykezelő (onclick= stb.)
// fut. Csak naplózzuk (security_events, "csp_violation"), oldalanként és
// kódrészletenként deduplikálva — ebből látszik, hol van még átírnivaló.
// Minden oldal+kódrészlet páros folyamatonként CSAK EGYSZER kerül a naplóba,
// és legfeljebb CSP_REPORT_MAX különböző: minden látogató böngészője jelent,
// és a végpont belépés nélkül hívható — különben a valódi forgalom zaja vagy
// kitalált jelentések elárasztanák a security_events-et (és kiszorítanák a
// valódi eseményeket az írási plafonból).
// A keretet egy IP legfeljebb CSP_REPORT_PER_IP új bejegyzéssel töltheti, és
// CSP_REPORT_WINDOW_MS-enként újraindul — korábban egy támadó kitalált
// jelentésekkel újraindításig betölthette a 300 helyet, és onnantól
// semmilyen valódi jelentés nem került a naplóba.
const CSP_REPORT_MAX = 300;
const CSP_REPORT_PER_IP = 20;
const CSP_REPORT_WINDOW_MS = 6 * 60 * 60 * 1000;
const cspReportSeen = new Set();
const cspReportPerIp = new Map();
setInterval(() => { cspReportSeen.clear(); cspReportPerIp.clear(); }, CSP_REPORT_WINDOW_MS).unref();
router.post("/csp-report", express.json({ type: ["application/csp-report", "application/json"], limit: "16kb" }), (req, res) => {
  const r = req.body?.["csp-report"] || {};
  let page = "";
  try { page = new URL(String(r["document-uri"] || "")).pathname; } catch {}
  const directive = String(r["effective-directive"] || r["violated-directive"] || "").slice(0, 60);
  const sample = String(r["script-sample"] || "").slice(0, 120);
  // Csak az inline eseménykezelők jelentései érdekesek (a többi irányelvet
  // az éles CSP ugyanígy kikényszeríti, azok csak zajt adnának)
  const key = `${page}|${directive}|${sample}`;
  const ip = getClientIp(req);
  if (directive.startsWith("script-src-attr") && !cspReportSeen.has(key) && cspReportSeen.size < CSP_REPORT_MAX &&
      (cspReportPerIp.get(ip) || 0) < CSP_REPORT_PER_IP) {
    cspReportSeen.add(key);
    cspReportPerIp.set(ip, (cspReportPerIp.get(ip) || 0) + 1);
    logSecurityEvent({ req, type: "csp_violation", severity: "info",
                       dedupeKey: key,
                       details: { page, directive, sample,
                                  line: r["line-number"] || null, source: String(r["source-file"] || "").slice(0, 200) } });
  }
  res.status(204).end();
});

/* ===== READING PROGRESS → lásd routes/progress.js ===== */
/* ===== online ===== */
router.get("/online-count", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*) 
    FROM users
    WHERE last_seen > now() - interval '5 minutes'
  `);

  res.json({ online: Number(rows[0].count) });
});



import bcrypt from "bcrypt";

/* ================= REGISTER ================= */

router.post("/auth/register", async (req, res) => {
  try {
    const { username, email, password, birthDate } = req.body;

    if (!username || !email || !password || !birthDate) {
      return res.status(400).json({ error: "Minden mező kötelező" });
    }
    if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Érvénytelen adatok" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "A felhasználónév túl rövid" });
    }
    if (username.length > 32) {
      return res.status(400).json({ error: "A felhasználónév legfeljebb 32 karakter lehet" });
    }
    // HTML-/URL-jelölő és vezérlőkarakter nélkül (a nevet sok helyen
    // megjelenítjük; korábban pl. "<b>…</b>" is regisztrálható volt)
    if (/[<>"'`&\\/]|\p{C}/u.test(username) || username !== username.trim()) {
      return res.status(400).json({ error: "A felhasználónév nem tartalmazhat < > \" ' ` & / \\ karaktert, és nem kezdődhet/végződhet szóközzel" });
    }

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const birthDateObj = new Date(birthDate);
    const ageInYears = (Date.now() - birthDateObj.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (isNaN(birthDateObj.getTime()) || birthDateObj > new Date() || ageInYears > 120) {
      return res.status(400).json({ error: "Érvénytelen születési dátum" });
    }

    // Kis-/nagybetűben eltérő név se legyen (Zoli/zoli) — a belépés ilyenkor
    // nem tudná eldönteni, melyik fiókról van szó.
    const uCheck = await pool.query("SELECT 1 FROM users WHERE lower(username) = lower($1)", [username]);
    if (uCheck.rowCount > 0) {
      return res.status(400).json({ error: "Ez a felhasználónév foglalt" });
    }

    const eCheck = await pool.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
    if (eCheck.rowCount > 0) {
      return res.status(400).json({ error: "Ez az email már regisztrálva van" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const rawToken     = randomBytes(32).toString("hex");
    const hashedToken  = createHash("sha256").update(rawToken).digest("hex");

    const ins = await pool.query(
      `INSERT INTO users (username, email, password_hash, birth_date, email_verified, email_verification_token, email_verification_expires)
       VALUES ($1, $2, $3, $4, false, $5, NOW() + INTERVAL '24 hours') RETURNING id`,
      [username, email, passwordHash, birthDate, hashedToken]
    );
    logSecurityEvent({ req, type: "register", userId: ins.rows[0]?.id, username,
                       details: { emailDomain: String(email).split("@")[1]?.toLowerCase() || null } });

    const verifyLink = `${getSite().url}/verify-email.html?token=${rawToken}`;
    await sendMail({
      to: email,
      subject: "✉️ Erősítsd meg az email címed – PadlizsanFanSub",
      html: verificationEmailHtml(username, verifyLink),
    }).catch(e => console.error("[mail] verify send error:", e.message));

    res.json({ ok: true, needsVerification: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
/* ================= PASSWORD RESET ================= */

/* ===== FORGOT PASSWORD ===== */
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email: emailInput } = req.body;
    // A tárolt (pontos) e-mail-cím — kis-/nagybetű eltérés esetén is megtalálja
    const email = (await resolveStoredEmail(emailInput)) ?? emailInput;
    logSecurityEvent({ req, type: "password_reset_request",
                       details: { emailDomain: String(email || "").split("@")[1]?.toLowerCase() || null } });

    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 perc

    const result = await pool.query(
      `
      UPDATE users
      SET reset_token = $1,
          reset_expires = $2
      WHERE email = $3
      RETURNING email
      `,
      [hashToken(token), expires, email]
    );

    // Biztonság: mindig OK
    if (!result.rowCount) {
      return res.json({ ok: true });
    }

    const resetLink =
      `${getSite().url}/reset-password.html?token=${token}`;

    // Nem várjuk meg és nem adjuk vissza a levélküldés eredményét: létező
    // fióknál korábban SMTP-hiba esetén 500 jött (nem létezőnél 200), és a
    // küldés ideje is elárulta, hogy a cím regisztrált-e
    sendMail({
      to: email,
      subject: "🔐 Jelszó visszaállítás - PadlizsanFanSub",
      html: `
        <p>Jelszó visszaállítást kértél.</p>
        <p>
          <a href="${resetLink}">
            Új jelszó beállítása
          </a>
        </p>
        <p>Ez a link 30 percig érvényes.</p>
      `
    }).catch(e => console.error("[mail] reset send error:", e.message));

    res.json({ ok: true });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== RESET PASSWORD ===== */
router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Hibás vagy lejárt link." });
    }
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const hash = await bcrypt.hash(password, 12);

    // A token hash-elve van tárolva. Átmenetileg (az élesítés előtt kiküldött,
    // max. 30 percig érvényes linkek miatt) a régi, nyers formát is elfogadjuk.
    const result = await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          reset_token = NULL,
          reset_expires = NULL
      WHERE (reset_token = $2 OR reset_token = $3)
        AND reset_expires > NOW()
      RETURNING id, username
      `,
      [hash, hashToken(token), token]
    );

    if (!result.rowCount) {
      return res.status(400).json({ error: "Hibás vagy lejárt link." });
    }

    // Minden korábbi bejelentkezés érvénytelen (ha valaki ellopta, kiesik)
    const { id, username } = result.rows[0];
    const killed = await destroyUserSessions(id);
    logSecurityEvent({ req, type: "password_reset_done", severity: "info", userId: id, username,
                       details: { sessionsRevoked: killed } });

    res.json({ ok: true });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= LOGIN ================= */
router.post("/auth/login", async (req, res) => {
  const { login, password, remember } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  try {
    const found = await findUserByLogin(login,
      `id, username, email, password_hash, role, avatar, email_verified, verified_deadline`);
    const rows = found ? [found] : [];

    const loginKey = String(login).slice(0, 120);
    // Fiókszintű zárolás: létező fióknál a fiókra (név és e-mail is ugyanaz),
    // különben a beírt névre
    const throttleKey = rows.length ? `user:${rows[0].id}` : `name:${loginKey}`;
    const lockedFor = loginLockRemaining(throttleKey);
    if (lockedFor) {
      res.setHeader("Retry-After", String(lockedFor));
      return res.status(429).json({ error: "Túl sok sikertelen próbálkozás ezzel a fiókkal, próbáld újra később." });
    }
    // Nem létező fióknál is lefut egy bcrypt-összehasonlítás (időzítés-kiegyenlítés)
    const ok = await comparePasswordSafe(password, rows[0]?.password_hash);
    if (!rows.length) {
      registerLoginFailure(throttleKey);
      logSecurityEvent({ req, type: "login_failed", severity: "info", dedupeKey: `${loginKey}|nouser`,
                         details: { login: loginKey, reason: "no_such_user" } });
      return res.status(401).json({ error: "Invalid login" });
    }

    const user = rows[0];
    if (!ok) {
      const nowLocked = registerLoginFailure(throttleKey);
      logSecurityEvent({ req, type: nowLocked ? "login_account_locked" : "login_failed",
                         severity: nowLocked ? "warn" : "info", dedupeKey: `${loginKey}|badpw`,
                         userId: user.id, username: user.username,
                         details: { login: loginKey, reason: "bad_password", admin: user.role === "admin" } });
      return res.status(401).json({ error: "Invalid login" });
    }
    clearLoginFailures(throttleKey);
    logSecurityEvent({ req, type: "login_success", userId: user.id, username: user.username,
                       dedupeKey: `ok|${user.id}`, details: { admin: user.role === "admin" } });

    // Új munkamenet-azonosító belépéskor (session fixation ellen): a
    // belépés előtti esetleges munkamenet azonosítója nem marad érvényes.
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = { id: user.id, username: user.username, avatar: user.avatar, role: user.role };
    if (remember) req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

    if (!user.email_verified) {
      return res.json({ ok: true, emailPending: true, email: user.email });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── GET /auth/verify-email?token=... ────────────────────── */
router.get("/auth/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect("/verify-email.html?status=invalid");

  try {
    const hashed = createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query(
      `SELECT id FROM users
       WHERE email_verification_token = $1
         AND email_verification_expires > NOW()`,
      [hashed]
    );

    if (!rows.length) return res.redirect("/verify-email.html?status=expired");

    await pool.query(
      `UPDATE users SET email_verified = true,
         email_verification_token = NULL,
         email_verification_expires = NULL,
         verified_deadline = NULL
       WHERE id = $1`,
      [rows[0].id]
    );

    res.redirect("/verify-email.html?status=success");
  } catch (err) {
    console.error("[verify-email]", err);
    res.redirect("/verify-email.html?status=error");
  }
});

/* ── POST /auth/resend-verification ─────────────────────── */
router.post("/auth/resend-verification", async (req, res) => {
  const { email: emailInput } = req.body;
  if (!emailInput) return res.status(400).json({ error: "Email megadása kötelező" });

  try {
    const email = (await resolveStoredEmail(emailInput)) ?? emailInput;
    const { rows } = await pool.query(
      `SELECT id, username, email_verified FROM users WHERE email = $1`, [email]
    );

    // Mindig OK-t küldünk (ne lehessen enumerálni)
    if (!rows.length || rows[0].email_verified) {
      return res.json({ ok: true });
    }

    const rawToken    = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(rawToken).digest("hex");

    await pool.query(
      `UPDATE users SET
         email_verification_token = $1,
         email_verification_expires = NOW() + INTERVAL '24 hours'
       WHERE id = $2`,
      [hashedToken, rows[0].id]
    );

    const verifyLink = `${getSite().url}/verify-email.html?token=${rawToken}`;
    await sendMail({
      to: email,
      subject: "✉️ Email megerősítése – PadlizsanFanSub",
      html: verificationEmailHtml(rows[0].username, verifyLink),
    }).catch(e => console.error("[mail] resend error:", e.message));

    res.json({ ok: true });
  } catch (err) {
    console.error("[resend-verify]", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Ki van-e jelentkezve?
router.get("/auth/me", async (req, res) => {
  if (!req.session.user) return res.status(401).end();
  try {
    const [tierRes, userRes] = await Promise.all([
      pool.query(`SELECT tier FROM patreon_status WHERE user_id = $1 LIMIT 1`, [req.session.user.id]),
      pool.query(`SELECT email, email_verified, can_upload FROM users WHERE id = $1`, [req.session.user.id]),
    ]);
    res.json({
      ...req.session.user,
      tier: tierRes.rows[0]?.tier || null,
      email: userRes.rows[0]?.email || null,
      email_verified: userRes.rows[0]?.email_verified ?? true,
      can_upload: userRes.rows[0]?.can_upload || false,
      can_scan: isOwner(req.session.user.id),
      can_security: isOwner(req.session.user.id),
    });
  } catch {
    res.json({ ...req.session.user, can_scan: isOwner(req.session.user.id), can_security: isOwner(req.session.user.id) });
  }
});

// Logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});
// ===== WANT TO READ - LIST =====
router.get("/want", async (req, res) => {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.title,
        m.slug,
        m.cover_url,
        rp.chapter,
        rp.page
      FROM want_to_read w
      JOIN manga m ON m.id = w.manga_id
      LEFT JOIN reading_progress rp
        ON rp.manga_id = m.id
       AND rp.user_id = w.user_id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
      `,
      [req.session.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /api/want error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== WANT TO READ - EGY MANGA ÁLLAPOTA =====
router.get("/want/:slug", async (req, res) => {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const { slug } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT 1
      FROM want_to_read w
      JOIN manga m ON m.id = w.manga_id
      WHERE m.slug = $1 AND w.user_id = $2
      `,
      [slug, req.session.user.id]
    );

    res.json({ wanted: rows.length > 0 });
  } catch (err) {
    console.error("GET /api/want/:slug error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== WANT TO READ - TOGGLE =====
router.post("/want/:slug", requireLogin, async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const { slug } = req.params;

  const mangaRes = await pool.query(
    "SELECT id FROM manga WHERE slug = $1",
    [slug]
  );

  if (mangaRes.rowCount === 0) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const mangaId = mangaRes.rows[0].id;

  const exists = await pool.query(
    `
    SELECT 1
    FROM want_to_read
    WHERE user_id = $1 AND manga_id = $2
    `,
    [req.session.user.id, mangaId]
  );

  if (exists.rowCount > 0) {
    // törlés
    await pool.query(
      `
      DELETE FROM want_to_read
      WHERE user_id = $1 AND manga_id = $2
      `,
      [req.session.user.id, mangaId]
    );
    return res.json({ wanted: false });
  } else {
    // beszúrás
    await pool.query(
      `
      INSERT INTO want_to_read (user_id, manga_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [req.session.user.id, mangaId]
    );
    return res.json({ wanted: true });
  }
});

/* ================= ADMIN ================= */

router.use("/", mangaRoutes);          // /manga, /chapters stb
router.use("/", animeSubtitlesRoutes); // /anime, /admin/anime stb
router.use(releasesRoutes);       // /new-releases
router.get("/new-manga", async (req, res) => {
  // A cache alapból NEM tartalmaz felnőtt (Hentai/Ecchi) mangát (lásd
  // server/scan.js buildNewMangaCache). 18+ módban (?adult=1, csak
  // igazoltan 18+ usernek) élő lekérdezéssel adjuk vissza CSAK a felnőtt
  // legújabb mangákat, nem a cache-t.
  const adultMode = await resolveAdultMode(pool, req);
  if (adultMode) {
    const { rows } = await pool.query(`
      SELECT m.slug, m.title, m.cover_url
      FROM manga m
      WHERE ${ADULT_GENRE_EXISTS_SQL}
      ORDER BY m.id DESC
      LIMIT 30
    `);
    return res.json(rows);
  }
  const data = getNewMangaCache();
  res.json(data || []);
});
router.use("/admin", adminRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/anilist", anilistRoutes);
router.use("/settings", settingsRoutes);
router.use("/patreon", patreonRoutes);
router.use("/discord", discordLinkRoutes);
router.use("/admin/security", securityAdminRoutes);
router.use("/polls", pollRoutes);
router.use("/stats", statsRoutes);
router.use("/announcements", announcementRoutes);
router.use("/admin", mangaAdminRoutes);
router.use("/shop", shopRoutes);
router.use("/progress", progressRoutes);
router.use("/rating", ratingRoutes);
router.use("/chat", chatRoutes);
router.use("/supporters", supportersRouter);
router.use("/blog", blogRoutes);
router.use("/admin/padli", padliAdminRoutes);
router.use("/bug-reports", bugReportsRoutes);
router.use("/chapter-bugs", chapterBugRoutes);
router.use("/uploader", uploaderRoutes);
router.use("/inpaint", requireLogin, aiLimiter("inpaint", 100), inpaintRoutes);
router.use("/translate", requireLogin, aiLimiter("translate", 200), translateRoutes);
router.use("/ocr", requireLogin, aiLimiter("ocr", 200), ocrRoutes);
router.use("/gemini-proxy", geminiProxyRoutes);
router.use("/points", pointsRoutes);
router.use("/padlicrome", padlicromeRoutes);
router.use("/gdpr", gdprRoutes);
router.use("/patreon-invoice", patreonInvoiceRoutes);

export default router;
