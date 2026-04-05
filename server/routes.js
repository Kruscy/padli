import express from "express";
import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import { requireLogin } from "./middleware/auth.js";
import adminRoutes from "./routes/admin.js";
import { randomBytes } from "crypto";
import { sendMail } from "./mail.js";
import wishlistRoutes from "./routes/wishlist.js";
import anilistRoutes from "./routes/anilist.js";
import settingsRoutes from "./routes/settings.js";
import patreonRoutes from "./routes/patreon.js";
import { getNewReleasesCache, setNewReleasesCache, clearNewReleasesCache} from "./cache/new-releases.js";
import mangaRoutes from "./routes/manga.js";
import releasesRoutes from "./routes/releases.js";
import pollRoutes from "./routes/polls.js";
import statsRoutes from "./routes/stats.js";
import announcementRoutes from "./routes/announcements.js";
import mangaAdminRoutes from "./routes/manga-admin.js";
import progressRoutes from "./routes/progress.js";
import ratingRoutes from "./routes/rating.js";
import chatRoutes from "./routes/chat.js";
import supportersRouter from "./routes/supporters.js";
import blogRoutes from "./routes/blog.js";
import padliAdminRoutes from "./routes/padli-admin.js";

const router = express.Router();

/* ===== READING PROGRESS SAVE ===== */
router.post("/progress", async (req, res) => {
  const userId = req.session.user?.id;
  const { slug, chapter, page } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const manga = await pool.query(
    "SELECT id FROM manga WHERE slug = $1",
    [slug]
  );

  if (!manga.rows.length) {
    return res.status(404).json({ error: "Manga not found" });
  }

  const mangaId = manga.rows[0].id;

  await pool.query(
    `
    INSERT INTO reading_progress (user_id, manga_id, chapter, page)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, manga_id)
    DO UPDATE SET
      chapter = EXCLUDED.chapter,
      page = EXCLUDED.page,
      updated_at = now()
    `,
    [userId, mangaId, chapter, page]
  );

  res.json({ ok: true });
});
/* ===== online ===== */
router.get("/online-count", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*) 
    FROM users
    WHERE last_seen > now() - interval '5 minutes'
  `);

  res.json({ online: Number(rows[0].count) });
});

/* ===== READING PROGRESS LOAD ===== */
router.get("/progress/:slug", requireLogin, async (req, res) => {
  if (!req.session.user) {
    return res.json(null);
  }

  const { slug } = req.params;
  const userId = req.session.user.id;

  const { rows } = await pool.query(
    `
    SELECT rp.chapter, rp.page, rp.updated_at
    FROM reading_progress rp
    JOIN manga m ON m.id = rp.manga_id
    WHERE rp.user_id = $1 AND m.slug = $2
    LIMIT 1
    `,
    [userId, slug]
  );

  res.json(rows[0] || null);
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

    // username ellenőrzés
    const uCheck = await pool.query(
      "SELECT 1 FROM users WHERE username = $1",
      [username]
    );
    if (uCheck.rowCount > 0) {
      return res.status(400).json({ error: "Ez a felhasználónév foglalt" });
    }

    // email ellenőrzés
    const eCheck = await pool.query(
      "SELECT 1 FROM users WHERE email = $1",
      [email]
    );
    if (eCheck.rowCount > 0) {
      return res.status(400).json({ error: "Ez az email már regisztrálva van" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `
      INSERT INTO users (username, email, password_hash)
      VALUES ($1, $2, $3)
      `,
      [username, email, passwordHash]
    );

    res.json({ ok: true });
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
      `https://padlizsanfansub.hu/reset-password.html?token=${token}`;

    await sendMail({
      to: email,
      subject: "🔐 Jelszó visszaállítás – PadlizsanFanSub",
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
  const { login, password, remember } = req.body; // login = email VAGY username
  if (!login || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT id, username, email, password_hash, role
      FROM users
      WHERE email = $1 OR username = $1
      LIMIT 1
      `,
      [login]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Invalid login" });
    }

    const user = rows[0];

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid login" });
    }

    // session
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };


	// remember me
	if (remember) {
	  req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 nap
	}

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Ki van-e jelentkezve?
router.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).end();
  }
  res.json(req.session.user);
});

// Logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});
// ===== WANT TO READ – LIST =====
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

// ===== WANT TO READ – TOGGLE =====
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
router.use("/admin", adminRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/anilist", anilistRoutes);
router.use("/settings", settingsRoutes);
router.use("/patreon", patreonRoutes);
router.use("/polls", pollRoutes);
router.use("/stats", statsRoutes);
router.use("/announcements", announcementRoutes);
router.use("/admin", mangaAdminRoutes);
router.use("/progress", progressRoutes);
router.use("/rating", ratingRoutes);
router.use("/chat", chatRoutes);
router.use("/supporters", supportersRouter);
router.use("/blog", blogRoutes);
router.use("/admin/padli", padliAdminRoutes);

export default router;
