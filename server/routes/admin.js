import express from "express";
import { spawn } from "child_process";
import { pool } from "../db.js";
import { sendMail } from "../mail.js";
import { clearNewReleasesCache } from "../cache/new-releases.js";
import multer from "multer";
import { refreshMetadataForManga } from "../refresh-metadata.js";
import fs from "fs";
import path from "path";

const router = express.Router();
/* ================= ADMIN GUARD ================= */

router.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

/* ================= SCAN LIBRARY ================= */

const SCAN_LOCK = "/tmp/padlizsanfansub.scan.lock";
let scanQueued = false;

function isScanRunning() {
  if (!fs.existsSync(SCAN_LOCK)) return false;
  // Stale lock ellenőrzés: ha a PID már nem él, töröljük
  try {
    const pid = parseInt(fs.readFileSync(SCAN_LOCK, "utf8").trim(), 10);
    process.kill(pid, 0); // 0 = csak ellenőrzés, nem küld signalt
    return true; // PID él → scan fut
  } catch {
    fs.unlinkSync(SCAN_LOCK); // stale lock → töröljük
    return false;
  }
}

function spawnScan() {
  clearNewReleasesCache();
  const scan = spawn("node", ["./server/scan.js"], {
    cwd: "/opt/padli",
    detached: true,
    stdio: "ignore"
  });
  scan.unref();
  console.log("🔄 Admin scan started");
}

router.post("/scan", (req, res) => {
  try {
    if (isScanRunning()) {
      if (!scanQueued) {
        scanQueued = true;
        console.log("⏳ Scan már fut – a következő scan sorba állt");
        // Megvárjuk amíg a lock felszabadul, majd elindítjuk
        const interval = setInterval(() => {
          if (!isScanRunning()) {
            clearInterval(interval);
            scanQueued = false;
            spawnScan();
          }
        }, 5000); // 5 másodpercenként ellenőrzi
      } else {
        console.log("⏳ Scan már fut és egy scan már sorban van – eldobva");
      }
      return res.json({ ok: true, queued: true });
    }

    spawnScan();
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Scan spawn failed", err);
    res.status(500).json({ error: "Scan failed" });
  }
});


/* ================= UPDATE MANGA META ================= */
router.post("/manga/:slug", async (req, res) => {
  const { slug } = req.params;
  const { cover_url, description, title, genres, tags, uploaders, anilist_id } = req.body;

  try {
    const mangaRes = await pool.query(
      `SELECT id FROM manga WHERE slug = $1`, [slug]
    );
    if (!mangaRes.rows.length) return res.status(404).json({ error: "Not found" });
    const mangaId = mangaRes.rows[0].id;
await pool.query(
  `UPDATE manga SET
    cover_url = COALESCE($1, cover_url),
    description = COALESCE($2, description),
    title = COALESCE($3, title),
    uploaders = $4::text[],
    anilist_id = CASE WHEN $5::int IS NOT NULL THEN $5::int ELSE anilist_id END
   WHERE id = $6`,
  [cover_url || null, description || null, title || null,
   uploaders || [], anilist_id || null, mangaId]
);
    if (genres) {
      await pool.query(`DELETE FROM manga_genre WHERE manga_id = $1`, [mangaId]);
      for (const g of genres) {
        const gRes = await pool.query(
          `INSERT INTO genre (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`, [g]
        );
        await pool.query(
          `INSERT INTO manga_genre (manga_id, genre_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [mangaId, gRes.rows[0].id]
        );
      }
    }

    if (tags) {
      await pool.query(`DELETE FROM manga_tag WHERE manga_id = $1`, [mangaId]);
      for (const t of tags) {
        const tRes = await pool.query(
          `INSERT INTO tag (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`, [t]
        );
        await pool.query(
          `INSERT INTO manga_tag (manga_id, tag_id, rank) VALUES ($1, $2, 0)
           ON CONFLICT DO NOTHING`,
          [mangaId, tRes.rows[0].id]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN EDIT ERROR:", err);
    res.status(500).json({ error: "DB error", detail: err.message });
  }
});
/* ================= Users ================= */
router.get("/users", async (req, res) => {
  try {
    const { rows } = await pool.query(`
SELECT u.id, u.username, u.role, u.created_at, ps.tier, ps.active, u.anilist_connected,
        u.email_verified,
        COALESCE(SUM(up.points) FILTER (WHERE up.spent = false), 0)::int AS points
      FROM users u
      LEFT JOIN patreon_status ps ON ps.user_id = u.id
      LEFT JOIN user_points up ON up.user_id = u.id
      GROUP BY u.id, u.username, u.role, u.created_at, ps.tier, ps.active, u.anilist_connected, u.email_verified
      ORDER BY u.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("ADMIN USERS ERROR:", err);
    res.status(500).json({ error: "DB error" });
  }
});
/* ================= UPLOADERS ================= */
router.get("/uploaders", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name FROM uploader_names ORDER BY name`
    );
    res.json(rows.map(r => r.name));
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.post("/uploaders", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Hiányzó név" });
  try {
    await pool.query(
      `INSERT INTO uploader_names (name) VALUES ($1) ON CONFLICT DO NOTHING`,
      [name.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

/* ================= MANGA LIST ADMIN ================= */
router.get("/mangas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, slug FROM manga ORDER BY title`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/manga/:slug/chapters", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.folder, c.scanned_at, c.unlocks_at
      FROM chapter c
      JOIN manga m ON m.id = c.manga_id
      WHERE m.slug = $1
      ORDER BY
        CAST(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 1) AS INT),
        CAST(COALESCE(NULLIF(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 2), ''), '0') AS INT)
    `, [req.params.slug]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.post("/chapter/:id/unlock", async (req, res) => {
  const { hours } = req.body;
  try {
    await pool.query(
      `UPDATE chapter
       SET unlocks_at = COALESCE(unlocks_at, now()) + ($1 * interval '1 hour')
       WHERE id = $2`,
      [hours, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.delete("/chapter/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM chapter WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
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

router.post("/manga/:slug/cover", coverUpload.single("cover"), async (req, res) => {
  const { slug } = req.params;
  if (!req.file) return res.status(400).json({ error: "Nincs fájl" });
  const filePath = `/uploads/${req.file.filename}`;
  try {
    await pool.query(`UPDATE manga SET cover_url = $1 WHERE slug = $2`, [filePath, slug]);
    res.json({ ok: true, cover_url: filePath });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

router.post("/manga/:slug/refresh-metadata", async (req, res) => {
  const { slug } = req.params;
  const { anilist_id } = req.body;
 
  try {
    const mangaRes = await pool.query(
      `SELECT id FROM manga WHERE slug = $1`, [slug]
    );
    if (!mangaRes.rows.length) return res.status(404).json({ error: "Not found" });
    const mangaId = mangaRes.rows[0].id;
 
if (anilist_id) {
      await pool.query(
        `UPDATE manga SET
          anilist_id     = $1,
          anilist_failed = FALSE,
          cover_url      = NULL,
          description    = NULL,
          status         = NULL,
          average_score  = NULL,
          total_chapters = NULL
         WHERE id = $2`,
        [anilist_id, mangaId]
      );
    } else {
      await pool.query(
        `UPDATE manga SET
          anilist_failed = FALSE,
          cover_url      = NULL,
          description    = NULL,
          status         = NULL,
          average_score  = NULL,
          total_chapters = NULL
         WHERE id = $1`, [mangaId]
      );
    } 
    // Közvetlen függvényhívás – nem spawn, megvárjuk az eredményt
    const result = await refreshMetadataForManga(mangaId, anilist_id || null);
 
    res.json({ ok: true, anilist_id: result.anilist_id, matched_title: result.title });
  } catch (err) {
    console.error("refresh-metadata error:", err);
    res.status(500).json({ error: err.message || "DB error" });
  }
});

/* ================= KÉPFELTÖLTÉS (blog) ================= */

const blogImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/blog";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = (file.mimetype.split("/")[1] || "jpg").toLowerCase();
    cb(null, `blog-${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`);
  }
});

const blogImageUpload = multer({
  storage: blogImageStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg","image/png","image/gif","image/webp"].includes(file.mimetype);
    cb(null, ok);
  }
});

router.post("/upload-image", blogImageUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nincs fájl vagy nem kép formátum" });
  res.json({ url: `/uploads/blog/${req.file.filename}`, name: req.file.filename });
});

/* ================= KÉPEK LISTÁZÁSA (uploads mappa) ================= */

router.get("/images", (req, res) => {
  const blogDir   = path.join(process.cwd(), "uploads", "blog");
  const imageExts = new Set([".jpg",".jpeg",".png",".gif",".webp"]);

  try {
    if (!fs.existsSync(blogDir)) {
      fs.mkdirSync(blogDir, { recursive: true });
      return res.json([]);
    }

    const files = fs.readdirSync(blogDir)
      .filter(f => imageExts.has(path.extname(f).toLowerCase()))
      .map(f => {
        const stat = fs.statSync(path.join(blogDir, f));
        return { name: f, url: `/uploads/blog/${f}`, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    res.json(files);
  } catch (err) {
    console.error("Images list error:", err);
    res.status(500).json({ error: "Hiba a fájlok listázásánál" });
  }
});

/* ═══════════════════════════════════════════════════════════
   KÖNYVTÁRAK – uploader root kezelés
   ═══════════════════════════════════════════════════════════ */
const KAVITA_BASE = "/mnt/manga/Kavita";

router.get("/uploader-roots", async (req, res) => {
  try {
    const [usersRes, namesRes, canUploadRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.username, ps.tier, ps.uploader_root, COALESCE(ps.active, false) AS supporter_access
        FROM users u
        JOIN patreon_status ps ON ps.user_id = u.id
        WHERE ps.tier IN ('Admin', 'Uploader')
        ORDER BY ps.tier, u.username
      `),
      pool.query(`SELECT name, root_path FROM uploader_names ORDER BY name`),
      pool.query(`
        SELECT u.id, u.username, u.can_upload, COALESCE(ps.uploader_root, '') AS uploader_root,
               COALESCE(ps.active, false) AS supporter_access
        FROM users u
        LEFT JOIN patreon_status ps ON ps.user_id = u.id
        WHERE u.upload_granted = true AND COALESCE(ps.tier, '') NOT IN ('Admin', 'Uploader')
        ORDER BY u.username
      `)
    ]);
    res.json({ users: usersRes.rows, uploaderNames: namesRes.rows, canUploadUsers: canUploadRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/supporter-access/:userId", express.json(), async (req, res) => {
  const { userId } = req.params;
  const { active } = req.body;
  if (typeof active !== "boolean") return res.status(400).json({ error: "Hiányzó active boolean" });
  try {
    const { rowCount } = await pool.query(
      `UPDATE patreon_status SET active = $1 WHERE user_id = $2`,
      [active, userId]
    );
    if (!rowCount) {
      await pool.query(
        `INSERT INTO patreon_status (patreon_user_id, user_id, active) VALUES ($1, $2, $3)`,
        [`manual_${userId}`, userId, active]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, username FROM users WHERE username ILIKE $1 ORDER BY username LIMIT 10`,
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/kavita-dirs", (req, res) => {
  try {
    if (!fs.existsSync(KAVITA_BASE)) return res.json([]);
    const dirs = fs.readdirSync(KAVITA_BASE, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
    res.json(dirs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function resolveRoot(root) {
  // Ha abszolút út (/-vel kezdődik): közvetlenül elfogadja, de csak /mnt/ alatt
  // Ha relatív: KAVITA_BASE alá illeszti
  if (root.startsWith("/")) {
    const full = path.resolve(root);
    if (!full.startsWith("/mnt/") && full !== "/mnt") return null;
    return full;
  }
  const full = path.resolve(path.join(KAVITA_BASE, root));
  if (!full.startsWith(KAVITA_BASE + path.sep) && full !== KAVITA_BASE) return null;
  return full;
}

router.post("/uploader-root/:userId", express.json(), async (req, res) => {
  const { userId } = req.params;
  let { root } = req.body;
  root = (root || "").trim().replace(/\\/g, "/");

  if (root && !resolveRoot(root)) {
    return res.status(400).json({ error: "Érvénytelen útvonal" });
  }

  await pool.query(
    `UPDATE patreon_status SET uploader_root = $1 WHERE user_id = $2`,
    [root || null, userId]
  );
  res.json({ ok: true });
});

router.post("/uploader-name-root", express.json(), async (req, res) => {
  let { name, root } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Hiányzó név" });
  root = (root || "").trim().replace(/\\/g, "/");

  if (root && !resolveRoot(root)) {
    return res.status(400).json({ error: "Érvénytelen útvonal" });
  }

  await pool.query(
    `UPDATE uploader_names SET root_path = $1 WHERE name = $2`,
    [root || null, name.trim()]
  );
  res.json({ ok: true });
});

router.post("/sync-uploader-manga", async (req, res) => {
  try {
    const { rows: uploaderRoots } = await pool.query(
      `SELECT name, root_path FROM uploader_names WHERE root_path IS NOT NULL AND root_path != ''`
    );
    if (!uploaderRoots.length) return res.json({ updated: 0 });

    const { rows: mangas } = await pool.query(`
      SELECT m.id, m.uploaders, l.path AS lib_path, m.folder
      FROM manga m
      JOIN library l ON l.id = m.library_id
    `);

    let updated = 0;
    for (const manga of mangas) {
      const mangaFullPath = (manga.lib_path + "/" + manga.folder).replace(/\/+/g, "/");
      for (const uploader of uploaderRoots) {
        const uploaderBase = uploader.root_path.startsWith("/")
          ? path.resolve(uploader.root_path)
          : (KAVITA_BASE + "/" + uploader.root_path).replace(/\/+/g, "/");
        if (mangaFullPath.startsWith(uploaderBase + "/") || mangaFullPath === uploaderBase) {
          const current = manga.uploaders || [];
          if (!current.includes(uploader.name)) {
            await pool.query(
              `UPDATE manga SET uploaders = array_append(COALESCE(uploaders, '{}'), $1) WHERE id = $2 AND NOT ($1 = ANY(COALESCE(uploaders, '{}')))`,
              [uploader.name, manga.id]
            );
            updated++;
          }
        }
      }
    }

    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   PATREON GIFT KEZELÉS
   ═══════════════════════════════════════════════════════════ */

router.get("/patreon-gifts", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.id, g.duration_months, g.cost_points, g.status, g.created_at, g.purchased_at,
             u.username AS purchased_by_name,
             -- Megvásárolt kódnál csak az első 36 char + **** jelenik meg (link vége rejtett)
             CASE WHEN g.status = 'purchased'
               THEN LEFT(g.patreon_link, 36) || '****'
               ELSE g.patreon_link
             END AS display_link
      FROM patreon_gifts g
      LEFT JOIN users u ON u.id = g.purchased_by
      ORDER BY g.status ASC, g.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/patreon-gifts", express.json(), async (req, res) => {
  const { links, duration_months, cost_points } = req.body;
  if (!Array.isArray(links) || !links.length) return res.status(400).json({ error: "Hiányzó linkek" });
  const dur = parseInt(duration_months) || 1;
  const cost = parseInt(cost_points) ?? 100;
  let added = 0;
  for (const raw of links) {
    const link = (raw || "").trim();
    if (!link) continue;
    const segment = link.split("/").pop().toUpperCase();
    const code = "GIFT-" + segment;
    try {
      const r = await pool.query(
        `INSERT INTO patreon_gifts (gift_code, patreon_link, duration_months, cost_points, status)
         VALUES ($1, $2, $3, $4, 'available')
         ON CONFLICT (gift_code) DO NOTHING
         RETURNING id`,
        [code, link, dur, cost]
      );
      if (r.rows.length) added++;
    } catch {}
  }
  res.json({ ok: true, added });
});

router.delete("/patreon-gifts/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM patreon_gifts WHERE id = $1 AND status = 'available' RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: "Nem törölhető (már megvásárolt vagy nem létezik)" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /admin/send-verification-emails ────────────────── */
// Tömeges verifikációs email küldés a meglévő, nem verifikált felhasználóknak
import { randomBytes, createHash } from "crypto";

router.post("/send-verification-emails", async (req, res) => {
  try {
    // Lekérjük az összes nem verifikált felhasználót (max 200/hívás)
    const { rows: users } = await pool.query(`
      SELECT id, username, email FROM users
      WHERE email_verified = false OR email_verified IS NULL
      ORDER BY id ASC
      LIMIT 200
    `);

    if (!users.length) return res.json({ ok: true, sent: 0, message: "Nincs verifikálandó felhasználó." });

    const BASE_URL = process.env.BASE_URL || process.env.SITE_URL || "http://localhost:3000";
    const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 nap

    let sent = 0, failed = 0;

    for (const user of users) {
      try {
        const rawToken    = randomBytes(32).toString("hex");
        const hashedToken = createHash("sha256").update(rawToken).digest("hex");

        await pool.query(`
          UPDATE users SET
            email_verification_token = $1,
            email_verification_expires = NOW() + INTERVAL '15 days',
            verified_deadline = $2
          WHERE id = $3
        `, [hashedToken, deadline, user.id]);

        const link = `${BASE_URL}/verify-email.html?token=${rawToken}`;
        const html = `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;padding:32px 28px">
            <img src="${BASE_URL}/assets/logo.png" style="height:48px;margin-bottom:20px" alt="PadlizsanFanSub">
            <h2 style="color:#a78bfa;margin:0 0 12px">Erősítsd meg az email címed!</h2>
            <p style="color:#bbb;line-height:1.7">Szia <strong style="color:#fff">${user.username}</strong>!</p>
            <p style="color:#bbb;line-height:1.7">Bevezettük az email megerősítést a PadlizsanFanSub oldalon. Kérjük, erősítsd meg a regisztrált email címed az alábbi gombra kattintva.</p>
            <p style="color:#f59e0b;font-size:0.9rem">⚠️ <strong>14 napod van</strong> megerősíteni a fiókod (${deadline.toLocaleDateString("hu-HU")}). Utána a bejelentkezés korlátozott lesz.</p>
            <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;margin:16px 0">
              ✉️ Email megerősítése
            </a>
            <p style="color:#888;font-size:0.82rem;margin-top:20px">A link 15 napig érvényes.</p>
            <hr style="border-color:#2a2a3a;margin:20px 0">
            <p style="color:#555;font-size:0.78rem">${process.env.SITE_NAME || "PadlizsanFanSub"} · ${(process.env.SITE_URL || "").replace(/^https?:\/\//, "")}</p>
          </div>`;

        await sendMail({ to: user.email, subject: "✉️ Erősítsd meg az email címed – PadlizsanFanSub", html });
        sent++;

        // Kis szünet hogy ne legyen SMTP spam
        await new Promise(r => setTimeout(r, 200));
      } catch (mailErr) {
        console.warn(`[verify-mass] ${user.email}: ${mailErr.message}`);
        failed++;
      }
    }

    res.json({ ok: true, sent, failed, total: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
