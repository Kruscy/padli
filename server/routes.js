import express from "express";
import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import { requireLogin } from "./middleware/auth.js";
import adminRoutes from "./routes/admin.js";
import { randomBytes, createHash } from "crypto";
import { sendMail } from "./mail.js";
import wishlistRoutes from "./routes/wishlist.js";
import anilistRoutes from "./routes/anilist.js";
import settingsRoutes from "./routes/settings.js";
import patreonRoutes from "./routes/patreon.js";
import { getNewReleasesCache, setNewReleasesCache, clearNewReleasesCache} from "./cache/new-releases.js";
import { getNewMangaCache } from "./cache/new-manga.js";
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
import pointsRoutes from "./routes/points.js";
import padlicromeRoutes from "./routes/padlicrome.js";
import gdprRoutes from "./routes/gdpr.js";


const router = express.Router();

/* ── Email verifikációs sablon ────────────────────────────── */
function verificationEmailHtml(username, link) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;padding:32px 28px">
    <img src="${process.env.SITE_URL || ""}/assets/logo.png" style="height:48px;margin-bottom:20px" alt="${process.env.SITE_NAME || "PadlizsanFanSub"}">
    <h2 style="color:#a78bfa;margin:0 0 12px">Erősítsd meg az email címed!</h2>
    <p style="color:#bbb;line-height:1.7">Szia <strong style="color:#fff">${username || "Felhasználó"}</strong>! Köszönjük a regisztrációt a PadlizsanFanSub oldalon.</p>
    <p style="color:#bbb;line-height:1.7">Kattints az alábbi gombra az email cím megerősítéséhez:</p>
    <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;margin:16px 0">
      ✉️ Email megerősítése
    </a>
    <p style="color:#888;font-size:0.82rem;margin-top:20px">A link 24 óráig érvényes. Ha nem te regisztráltál, hagyd figyelmen kívül ezt az emailt.</p>
    <hr style="border-color:#2a2a3a;margin:20px 0">
    <p style="color:#555;font-size:0.78rem">${process.env.SITE_NAME || "PadlizsanFanSub"} · ${(process.env.SITE_URL || "").replace(/^https?:\/\//, "")}</p>
  </div>`;
}

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
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Minden mező kötelező" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "A felhasználónév túl rövid" });
    }

    const uCheck = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if (uCheck.rowCount > 0) {
      return res.status(400).json({ error: "Ez a felhasználónév foglalt" });
    }

    const eCheck = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (eCheck.rowCount > 0) {
      return res.status(400).json({ error: "Ez az email már regisztrálva van" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const rawToken     = randomBytes(32).toString("hex");
    const hashedToken  = createHash("sha256").update(rawToken).digest("hex");

    await pool.query(
      `INSERT INTO users (username, email, password_hash, email_verified, email_verification_token, email_verification_expires)
       VALUES ($1, $2, $3, false, $4, NOW() + INTERVAL '24 hours')`,
      [username, email, passwordHash, hashedToken]
    );

    const verifyLink = `${process.env.BASE_URL || process.env.SITE_URL || "http://localhost:3000"}/verify-email.html?token=${rawToken}`;
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
    const { email } = req.body;

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
      [token, expires, email]
    );

    // Biztonság: mindig OK
    if (!result.rowCount) {
      return res.json({ ok: true });
    }

    const resetLink =
      `${process.env.BASE_URL || process.env.SITE_URL || "http://localhost:3000"}/reset-password.html?token=${token}`;

    await sendMail({
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
    });

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

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          reset_token = NULL,
          reset_expires = NULL
      WHERE reset_token = $2
        AND reset_expires > NOW()
      `,
      [hash, token]
    );

    if (!result.rowCount) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

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
    const { rows } = await pool.query(
      `SELECT id, username, email, password_hash, role, avatar,
              email_verified, verified_deadline
       FROM users WHERE email = $1 OR username = $1 LIMIT 1`,
      [login]
    );

    if (!rows.length) return res.status(401).json({ error: "Invalid login" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid login" });

    req.session.user = { id: user.id, username: user.username, avatar: user.avatar, role: user.role };
    if (remember) req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;

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
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email megadása kötelező" });

  try {
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

    const verifyLink = `${process.env.BASE_URL || process.env.SITE_URL || "http://localhost:3000"}/verify-email.html?token=${rawToken}`;
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
      pool.query(`SELECT email, email_verified FROM users WHERE id = $1`, [req.session.user.id]),
    ]);
    res.json({
      ...req.session.user,
      tier: tierRes.rows[0]?.tier || null,
      email: userRes.rows[0]?.email || null,
      email_verified: userRes.rows[0]?.email_verified ?? true,
    });
  } catch {
    res.json(req.session.user);
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
router.use(releasesRoutes);       // /new-releases
router.get("/new-manga", (req, res) => {
  const data = getNewMangaCache();
  res.json(data || []);
});
router.use("/admin", adminRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/anilist", anilistRoutes);
router.use("/settings", settingsRoutes);
router.use("/patreon", patreonRoutes);
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
router.use("/inpaint", inpaintRoutes);
router.use("/translate", translateRoutes);
router.use("/ocr", ocrRoutes);
router.use("/points", pointsRoutes);
router.use("/padlicrome", padlicromeRoutes);
router.use("/gdpr", gdprRoutes);
// router.use("/admin/fansub", fansubAdminRoutes); // FansubÉlet letiltva

export default router;
