import { Router } from "express";
import fs from "fs";
import path from "path";
import { pool } from "./db.js";

const router = Router();

/* ================= HELPERS ================= */

function extractPageNumber(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const match = base.match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
}

/* ================= MANGA LIST ================= */

router.get("/manga", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT title, slug, cover_url FROM manga ORDER BY title"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});

/* ================= CHAPTER LIST ================= */

router.get("/chapters/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      `
      SELECT c.folder, c.title
      FROM chapter c
      JOIN manga m ON m.id = c.manga_id
      WHERE m.slug = $1
      ORDER BY
        CAST(
          NULLIF(REGEXP_REPLACE(c.folder, '[^0-9]', '', 'g'), '')
          AS INTEGER
        )
      `,
      [slug]
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});

/* ================= PAGE LIST ================= */

router.get("/pages/:slug/:chapter", async (req, res) => {
  const { slug, chapter } = req.params;

  const result = await pool.query(
    `
    SELECT
      l.path AS library_path,
      m.folder AS manga_folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = m.library_id
    WHERE m.slug = $1 AND c.folder = $2
    LIMIT 1
    `,
    [slug, chapter]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: "Chapter not found" });
  }

  const { library_path, manga_folder } = result.rows[0];
  const dir = path.join(library_path, manga_folder, chapter);

  try {
    const files = fs
      .readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

    const pages = files
      .map(f => ({ f, n: extractPageNumber(f) }))
      .sort((a, b) => {
        if (a.n !== null && b.n !== null) return a.n - b.n;
        if (a.n !== null) return -1;
        if (b.n !== null) return 1;
        return a.f.localeCompare(b.f, undefined, { numeric: true });
      })
      .map(p => p.f);

    res.json(pages);
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: "Pages not found" });
  }
});

/* ================= IMAGE ================= */

router.get("/image/:slug/:chapter/:file", async (req, res) => {
  const { slug, chapter, file } = req.params;

  const result = await pool.query(
    `
    SELECT
      l.path AS library_path,
      m.folder AS manga_folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = m.library_id
    WHERE m.slug = $1 AND c.folder = $2
    LIMIT 1
    `,
    [slug, chapter]
  );

  if (!result.rows.length) return res.status(404).end();

  const { library_path, manga_folder } = result.rows[0];
  const imgPath = path.join(library_path, manga_folder, chapter, file);

  if (!fs.existsSync(imgPath)) return res.status(404).end();

  res.sendFile(imgPath);
});

/* ================= NEXT / PREV ================= */

router.get("/chapter-nav/:slug/:chapter", async (req, res) => {
  const { slug, chapter } = req.params;

  const { rows } = await pool.query(
    `
    SELECT c.folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    WHERE m.slug = $1
    ORDER BY
      CAST(
        NULLIF(REGEXP_REPLACE(c.folder, '[^0-9]', '', 'g'), '')
        AS INTEGER
      )
    `,
    [slug]
  );

  const list = rows.map(r => r.folder);
  const idx = list.indexOf(chapter);

  res.json({
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  });
});
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


/* ===== READING PROGRESS LOAD ===== */
router.get("/progress/:slug", async (req, res) => {
  if (!req.session.user) {
    return res.json(null);
  }

  const { slug } = req.params;
  const userId = req.session.user.id;

  const { rows } = await pool.query(
    `
    SELECT rp.chapter, rp.page
    FROM reading_progress rp
    JOIN manga m ON m.id = rp.manga_id
    WHERE rp.user_id = $1 AND m.slug = $2
    LIMIT 1
    `,
    [userId, slug]
  );

  res.json(rows[0] || null);
});

export default router;
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
/* ================= LOGIN ================= */
router.post("/auth/login", async (req, res) => {
  const { login, password } = req.body; // login = email VAGY username

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
// ===== WANT TO READ =====

// lekérdezés
router.get("/want/:slug", async (req, res) => {
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

  const r = await pool.query(
    `
    SELECT 1
    FROM want_to_read
    WHERE user_id = $1 AND manga_id = $2
    `,
    [req.session.user.id, mangaId]
  );

  res.json({ wanted: r.rowCount > 0 });
});

// toggle
router.post("/want/:slug", async (req, res) => {
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

