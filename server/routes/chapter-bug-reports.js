import express from "express";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { r2, BUCKET, localPathToR2Key } from "../r2.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Bejelentkezés szükséges" });
  next();
}
async function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(403).json({ error: "Nincs jogosultság" });
  try {
    const { rows } = await pool.query(
      `SELECT ps.tier FROM patreon_status ps WHERE ps.user_id = $1 LIMIT 1`,
      [req.session.user.id]
    );
    if (!rows.length || rows[0].tier !== "Admin") return res.status(403).json({ error: "Nincs jogosultság" });
    next();
  } catch { return res.status(500).json({ error: "Auth hiba" }); }
}

/* ── GET /api/chapter-bugs – lista ───────────────────────── */
router.get("/", requireLogin, async (req, res) => {
  try {
    const { manga_slug, chapter, fixed } = req.query;
    let query = `
      SELECT cbr.*, m.title AS manga_title_db, u.username AS fixed_by_name_db
      FROM chapter_bug_reports cbr
      LEFT JOIN manga m ON m.slug = cbr.manga_slug
      LEFT JOIN users u ON u.id = cbr.fixed_by
      WHERE 1=1
    `;
    const params = [];
    let n = 0;
    if (manga_slug) { query += ` AND cbr.manga_slug = $${++n}`; params.push(manga_slug); }
    if (chapter)    { query += ` AND cbr.chapter = $${++n}`;    params.push(chapter); }
    if (fixed !== undefined) { query += ` AND cbr.is_fixed = $${++n}`; params.push(fixed === 'true'); }
    query += " ORDER BY cbr.created_at DESC";
    const { rows } = await pool.query(query, params);
    res.json(rows.map(r => ({ ...r, manga_title: r.manga_title_db || r.manga_title || r.manga_slug, fixed_by_name: r.fixed_by_name_db })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/chapter-bugs – új bejelentés ──────────────── */
router.post("/", requireLogin, async (req, res) => {
  try {
    const { manga_slug, chapter, provider, type, description } = req.body;
    const VALID = ["english_remained", "wrong_chapter", "other"];
    if (!manga_slug || !chapter || !VALID.includes(type)) {
      return res.status(400).json({ error: "Hiányzó vagy érvénytelen adat" });
    }
    if (type === "other" && !description?.trim()) {
      return res.status(400).json({ error: "Egyéb típusnál leírás kötelező" });
    }

    const userId   = req.session.user.id;
    const username = req.session.user.username;

    // Manga title lekérése
    const { rows: mRows } = await pool.query(`SELECT title FROM manga WHERE slug=$1 LIMIT 1`, [manga_slug]);
    const mangaTitle = mRows[0]?.title || manga_slug;

    const { rows } = await pool.query(`
      INSERT INTO chapter_bug_reports
        (manga_slug, chapter, provider, type, description, manga_title, reported_by, reported_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [manga_slug, chapter, provider || null, type, description?.trim() || null, mangaTitle, userId, username]);

    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/chapter-bugs/:id/fix – adminként javítva ─── */
router.post("/:id/fix", requireAdmin, async (req, res) => {
  try {
    const { rows: bug } = await pool.query(`SELECT * FROM chapter_bug_reports WHERE id=$1`, [req.params.id]);
    if (!bug.length) return res.status(404).json({ error: "Nem található" });
    const b = bug[0];

    // 1. Fájlok újrafeltöltése R2-re (lemezről → R2, felülírja az angolt magyarral)
    const uploadResult = await reuploadChapterToR2(b.manga_slug, b.chapter);

    // 2. chapter.updated_at frissítése → reader ?v= cache-bust
    if (uploadResult.uploaded > 0) {
      await pool.query(
        `UPDATE chapter SET updated_at = NOW()
         WHERE folder = $1 AND manga_id = (SELECT id FROM manga WHERE slug = $2 LIMIT 1)`,
        [b.chapter, b.manga_slug]
      );
    }

    // 3. Hibajegy lezárása
    await pool.query(
      `UPDATE chapter_bug_reports SET is_fixed=true, fixed_by=$1, fixed_at=NOW() WHERE id=$2`,
      [req.session.user.id, req.params.id]
    );

    // 4. Cloudflare cache purge
    const purgeResult = await purgeChapterCache(b.manga_slug, b.chapter);

    res.json({ ok: true, uploaded: uploadResult.uploaded, purged: purgeResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/chapter-bugs/purge – R2 újrafeltöltés + CF cache ── */
router.post("/purge", requireAdmin, async (req, res) => {
  try {
    const { manga_slug, chapter } = req.body;
    if (!manga_slug || !chapter) return res.status(400).json({ error: "manga_slug és chapter kötelező" });

    const uploadResult = await reuploadChapterToR2(manga_slug, chapter);
    if (uploadResult.uploaded > 0) {
      await pool.query(
        `UPDATE chapter SET updated_at = NOW()
         WHERE folder = $1 AND manga_id = (SELECT id FROM manga WHERE slug = $2 LIMIT 1)`,
        [chapter, manga_slug]
      );
    }
    const purgeResult = await purgeChapterCache(manga_slug, chapter);
    res.json({ ok: true, uploaded: uploadResult.uploaded, purged: purgeResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── DELETE /api/chapter-bugs/:id ────────────────────────── */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM chapter_bug_reports WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════════
   LEMEZ → R2 ÚJRAFELTÖLTÉS
   ══════════════════════════════════════════════════════════ */
async function reuploadChapterToR2(mangaSlug, chapter) {
  const { rows } = await pool.query(`
    SELECT l.path AS library_path, m.folder AS manga_folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = m.library_id
    WHERE m.slug = $1 AND c.folder = $2 LIMIT 1
  `, [mangaSlug, chapter]);

  if (!rows.length) return { uploaded: 0, reason: "Fejezet nem található DB-ben" };

  const { library_path, manga_folder } = rows[0];
  const dir = path.join(library_path, manga_folder, chapter);

  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  } catch (_) {
    return { uploaded: 0, reason: "Könyvtár nem olvasható: " + dir };
  }

  if (!files.length) return { uploaded: 0, reason: "Üres mappa" };

  let uploaded = 0;
  for (const file of files) {
    const filePath = path.join(dir, file);
    const r2Key = localPathToR2Key(filePath);
    const buf = fs.readFileSync(filePath);
    const ct = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: r2Key, Body: buf, ContentType: ct }));
    uploaded++;
  }

  console.log(`[r2-reupload] ${uploaded} fájl feltöltve: ${mangaSlug} ${chapter}`);
  return { uploaded };
}

/* ══════════════════════════════════════════════════════════
   CF CACHE PURGE — /api/image/... + R2 public URL-ek
   ══════════════════════════════════════════════════════════ */
async function purgeChapterCache(mangaSlug, chapter) {
  const CF_ZONE   = process.env.CF_ZONE_ID;
  const CF_TOKEN  = process.env.CF_API_TOKEN;
  const CF_DOMAIN = process.env.CF_DOMAIN || "http://localhost:3000";
  const R2_PUBLIC = process.env.R2_PUBLIC_URL;

  if (!CF_ZONE || !CF_TOKEN) return { skipped: true, reason: "Nincs CF konfig" };

  const { rows } = await pool.query(`
    SELECT l.path AS library_path, l.name AS library_name, m.folder AS manga_folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = m.library_id
    WHERE m.slug = $1 AND c.folder = $2 LIMIT 1
  `, [mangaSlug, chapter]);

  if (!rows.length) return { skipped: true, reason: "Fejezet nem található DB-ben" };

  const { library_path, library_name, manga_folder } = rows[0];
  const dir = path.join(library_path, manga_folder, chapter);

  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)); } catch (_) {}
  if (!files.length) return { skipped: true, reason: "Üres képlista" };

  const urls = [];
  for (const f of files) {
    // /api/image/ proxy URL (böngésző cache)
    urls.push(`${CF_DOMAIN}/api/image/${encodeURIComponent(library_name)}/${encodeURIComponent(mangaSlug)}/${encodeURIComponent(chapter)}/${encodeURIComponent(f)}`);
    // R2 public URL (CDN cache)
    if (R2_PUBLIC) {
      const r2Key = localPathToR2Key(path.join(dir, f));
      urls.push(`${R2_PUBLIC}/${r2Key}`);
    }
  }

  let purgedCount = 0;
  for (let i = 0; i < urls.length; i += 30) {
    const batch = urls.slice(i, i + 30);
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: batch }),
    });
    const result = await r.json();
    if (result.success) purgedCount += batch.length;
    else console.warn("[CF purge] batch hiba:", result.errors);
  }

  console.log(`[CF purge] ${purgedCount}/${urls.length} URL kitisztítva: ${mangaSlug} ${chapter}`);
  return { total: urls.length, purged: purgedCount };
}

export default router;
