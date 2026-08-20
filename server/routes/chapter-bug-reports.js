import express from "express";
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { r2, BUCKET, localPathToR2Key } from "../r2.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { applyAllFixesForChapter, applyBugFix } from "../lib/apply-bug-fix.js";

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
    const { manga_slug, chapter, fixed, type } = req.query;
    let query = `
      SELECT cbr.*, m.title AS manga_title_db, u.username AS fixed_by_name_db, l.name AS library_name,
        COALESCE(m.uploaders, '{}') AS translator,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', bf.id,
            'image_index', bf.image_index,
            'image_file', bf.image_file,
            'fixed_image_url', bf.fixed_image_url,
            'is_applied', bf.is_applied,
            'fixed_by_name', bf.fixed_by_name
          ) ORDER BY bf.image_index)
          FROM bug_fixes bf
          WHERE bf.manga_slug = cbr.manga_slug AND bf.chapter = cbr.chapter
        ), '[]') AS fixes
      FROM chapter_bug_reports cbr
      LEFT JOIN manga m ON m.slug = cbr.manga_slug
      LEFT JOIN users u ON u.id = cbr.fixed_by
      LEFT JOIN chapter c ON c.manga_id = m.id AND c.folder = cbr.chapter
      LEFT JOIN library l ON l.id = c.library_id
      WHERE 1=1
    `;
    const params = [];
    let n = 0;
    if (manga_slug) { query += ` AND cbr.manga_slug = $${++n}`; params.push(manga_slug); }
    if (chapter)    { query += ` AND cbr.chapter = $${++n}`;    params.push(chapter); }
    if (fixed !== undefined) { query += ` AND cbr.is_fixed = $${++n}`; params.push(fixed === 'true'); }
    if (type)       { query += ` AND cbr.type = $${++n}`;       params.push(type); }
    query += " ORDER BY cbr.report_count DESC, cbr.created_at DESC";
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

    // Deduplikáció: ha már van nyitott, AZONOS TÍPUSÚ bejelentés erre a
    // fejezetre, csak a számlálót növeljük, nem hozunk létre új sort —
    // így sok azonos jellegű ("angol maradt" stb.) jegy nem szemeteli tele
    // a listát duplikátumokkal.
    const existing = await pool.query(`
      SELECT id FROM chapter_bug_reports
      WHERE manga_slug=$1 AND chapter=$2 AND type=$3 AND is_fixed=false
      LIMIT 1
    `, [manga_slug, chapter, type]);

    if (existing.rows.length) {
      const { rows } = await pool.query(
        `UPDATE chapter_bug_reports SET report_count = report_count + 1 WHERE id=$1 RETURNING *`,
        [existing.rows[0].id]
      );
      return res.status(201).json({ ...rows[0], merged: true });
    }

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

    // 1. Minden erre a fejezetre beküldött, még alkalmazatlan javítás
    //    (pl. egész fejezetes PadliCrome importból) alkalmazása — a staging
    //    mappából (uploads/bugs/javitott/...) átmásolja a valódi helyükre.
    const applyResult = await applyAllFixesForChapter(b.manga_slug, b.chapter, req.session.user.id);

    // 2. Fájlok újrafeltöltése R2-re (lemezről → R2, a most alkalmazott
    //    javításokkal együtt)
    const uploadResult = await reuploadChapterToR2(b.manga_slug, b.chapter);

    // 3. chapter.updated_at frissítése → reader ?v= cache-bust
    if (uploadResult.uploaded > 0) {
      await pool.query(
        `UPDATE chapter SET updated_at = NOW()
         WHERE folder = $1 AND manga_id = (SELECT id FROM manga WHERE slug = $2 LIMIT 1)`,
        [b.chapter, b.manga_slug]
      );
    }

    // 4. Hibajegy lezárása
    await pool.query(
      `UPDATE chapter_bug_reports SET is_fixed=true, fixed_by=$1, fixed_at=NOW() WHERE id=$2`,
      [req.session.user.id, req.params.id]
    );

    // 5. Cloudflare cache purge
    const purgeResult = await purgeChapterCache(b.manga_slug, b.chapter);

    res.json({ ok: true, fixesApplied: applyResult, uploaded: uploadResult.uploaded, purged: purgeResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/chapter-bugs/fix/:fixId/approve – EGY kép jóváhagyása ──
   Rész-szintű importból származó javítások közül egyenként is jóvá
   lehet hagyni egy-egy képet, nem csak az egész fejezetet egyszerre. */
router.post("/fix/:fixId/approve", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM bug_fixes WHERE id=$1`, [req.params.fixId]);
    if (!rows.length) return res.status(404).json({ error: "Javítás nem található" });
    if (rows[0].is_applied) return res.json({ ok: true, alreadyApplied: true });

    const result = await applyBugFix(req.params.fixId, req.session.user.id);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/chapter-bugs/fix/:fixId/reject – EGY kép elutasítása ──
   A javítás törlődik (a fordító újra próbálkozhat), az esetleg már
   jóváírt pontok visszavonódnak, és a kép egyedi hibajegyként kerül
   vissza a "Javítani való" fülre — NEM rész-szintű hibajegyként,
   mert a többi kép a fejezetből lehet, hogy már rendben van. */
router.post("/fix/:fixId/reject", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM bug_fixes WHERE id=$1`, [req.params.fixId]);
    if (!rows.length) return res.status(404).json({ error: "Javítás nem található" });
    const fix = rows[0];
    if (fix.is_applied) return res.status(400).json({ error: "Már élesített javítás nem utasítható el" });

    // Staged fájl törlése lemezről
    try {
      if (fix.fixed_image_url) {
        const p = path.join(process.cwd(), fix.fixed_image_url);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch (_) {}

    // Esetlegesen már jóváírt pontok visszavonása (a javítás nem lett elfogadva)
    await pool.query(`DELETE FROM user_points WHERE fix_id = $1`, [fix.id]);
    await pool.query(`DELETE FROM bug_fixes WHERE id = $1`, [fix.id]);

    // Egyedi kép-szintű hibajegy létrehozása/frissítése ehhez a konkrét képhez,
    // hogy csak ez az egy oldal kelljen újrafordítani, ne az egész fejezet.
    const { rows: parentRows } = await pool.query(
      `SELECT type FROM chapter_bug_reports WHERE manga_slug=$1 AND chapter=$2 LIMIT 1`,
      [fix.manga_slug, fix.chapter]
    );
    const type = parentRows[0]?.type || "english_remained";
    const imageUrl = `/api/image/${fix.provider}/${fix.manga_slug}/${fix.chapter}/${encodeURIComponent(fix.image_file)}`;

    const { rows: existing } = await pool.query(`
      SELECT id FROM bug_reports
      WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 AND is_closed=false
      LIMIT 1
    `, [fix.manga_slug, fix.chapter, fix.image_index]);

    if (existing.length) {
      await pool.query(`UPDATE bug_reports SET report_count = report_count + 1 WHERE id=$1`, [existing[0].id]);
    } else {
      await pool.query(`
        INSERT INTO bug_reports
          (provider, manga_slug, chapter, image_file, image_index, image_url, user_id, username, description, type, report_count)
        VALUES ($1,$2,$3,$4,$5,$6,NULL,'Admin',$7,$8,1)
      `, [fix.provider, fix.manga_slug, fix.chapter, fix.image_file, fix.image_index, imageUrl,
          "Beküldött javítás minőségi okból visszadobva, újrafordítás szükséges.", type]);
    }

    // Értesítés a fordítónak
    if (fix.fixed_by) {
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link)
        VALUES ($1, 'bug_rejected', $2, '/bug-reports.html')
      `, [fix.fixed_by, `Javításod nem lett elfogadva (nem megfelelő minőség): ${fix.manga_slug} ${fix.chapter} #${(fix.image_index ?? 0) + 1} — kérjük fordítsd újra.`]);
    }

    res.json({ ok: true });
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
    const { rows } = await pool.query(`SELECT * FROM chapter_bug_reports WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Nem található" });
    const b = rows[0];

    // A hibajeggyel együtt az összes rá beküldött, még nem élesített javítást
    // is eltakarítjuk (staged fájl, pont), hogy ne maradjon árva rekord —
    // különben egy újbóli bejelentésnél tévesen "kész javításként" jelenne meg.
    const { rows: fixes } = await pool.query(
      `SELECT * FROM bug_fixes WHERE manga_slug=$1 AND chapter=$2 AND is_applied=false`,
      [b.manga_slug, b.chapter]
    );
    for (const fix of fixes) {
      try {
        if (fix.fixed_image_url) {
          const p = path.join(process.cwd(), fix.fixed_image_url);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      } catch (_) {}
      await pool.query(`DELETE FROM user_points WHERE fix_id = $1`, [fix.id]);
      await pool.query(`DELETE FROM bug_fixes WHERE id = $1`, [fix.id]);
    }

    await pool.query(`DELETE FROM chapter_bug_reports WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, cleanedFixes: fixes.length });
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
    JOIN library l ON l.id = c.library_id
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
    JOIN library l ON l.id = c.library_id
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
