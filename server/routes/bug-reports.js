// server/routes/bug-reports.js
import express from "express";
import { pool } from "../db.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

/* ── SEGÉD: kép URL feldolgozása ────────────────────────── */
// /api/image/SKYPRO/manga-slug/CH03/Fajlnev_0.jpg
function parseImageUrl(imageUrl) {
  try {
    const match = imageUrl.match(/\/api\/image\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const [, provider, mangaSlug, chapter, imageFile] = match;
    const decoded = decodeURIComponent(imageFile);
    // Kép index kinyerése a fájlnévből (_N.jpg végéből)
    const indexMatch = decoded.match(/_(\d+)\.[^.]+$/);
    const imageIndex = indexMatch ? parseInt(indexMatch[1], 10) : null;
    return { provider, mangaSlug, chapter, imageFile: decoded, imageIndex };
  } catch { return null; }
}

/* ── GET /api/bug-reports – admin lista ─────────────────── */
// Csoportosítva: manga → chapter → image
router.get("/", requireLogin, async (req, res) => {
  try {
    const { manga_slug, chapter, closed } = req.query;

    let query = `
      SELECT
        br.*,
        COUNT(*) OVER (PARTITION BY br.manga_slug, br.chapter, br.image_index) as report_count,
        bf.id as fix_id,
        bf.fixed_image_url,
        bf.fixed_by_name,
        bf.fixed_at,
        bf.likes,
        bf.dislikes,
        bf.is_applied
      FROM bug_reports br
      LEFT JOIN bug_fixes bf
        ON bf.manga_slug = br.manga_slug
        AND bf.chapter = br.chapter
        AND bf.image_index = br.image_index
      WHERE 1=1
    `;
    const params = [];

    if (manga_slug) {
      params.push(manga_slug);
      query += ` AND br.manga_slug = $${params.length}`;
    }
    if (chapter) {
      params.push(chapter);
      query += ` AND br.chapter = $${params.length}`;
    }
    if (closed !== undefined) {
      params.push(closed === "true");
      query += ` AND br.is_closed = $${params.length}`;
    }

    query += ` ORDER BY br.manga_slug, br.chapter, br.image_index, br.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Bug reports list error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/bug-reports/summary – összefoglaló ────────── */
// Mangánként csoportosítva a nyitott hibajegyek száma
router.get("/summary", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        manga_slug,
        COUNT(*) FILTER (WHERE NOT is_closed) as open_count,
        COUNT(*) FILTER (WHERE is_closed) as closed_count,
        COUNT(DISTINCT chapter) as chapter_count,
        COUNT(DISTINCT image_index) as image_count,
        MAX(created_at) as last_report
      FROM bug_reports
      GROUP BY manga_slug
      ORDER BY open_count DESC, last_report DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── GET /api/bug-reports/image – egy képhez tartozó jegyek */
router.get("/image", requireLogin, async (req, res) => {
  try {
    const { manga_slug, chapter, image_index } = req.query;
    const { rows } = await pool.query(`
      SELECT br.*, u.username
      FROM bug_reports br
      LEFT JOIN users u ON u.id = br.user_id
      WHERE br.manga_slug = $1 AND br.chapter = $2 AND br.image_index = $3
      ORDER BY br.created_at DESC
    `, [manga_slug, chapter, parseInt(image_index)]);

    const fix = await pool.query(`
      SELECT bf.*, u.username as fixer_name,
        COALESCE(
          (SELECT json_agg(json_build_object('user_id', v.user_id, 'vote', v.vote))
           FROM bug_fix_votes v WHERE v.fix_id = bf.id), '[]'
        ) as votes
      FROM bug_fixes bf
      LEFT JOIN users u ON u.id = bf.fixed_by
      WHERE bf.manga_slug = $1 AND bf.chapter = $2 AND bf.image_index = $3
      ORDER BY bf.created_at DESC LIMIT 1
    `, [manga_slug, chapter, parseInt(image_index)]);

    res.json({ reports: rows, fix: fix.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── GET /api/bug-reports/:id – egy hibajegy lekérése ───── */
router.get("/:id", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT br.*, u.username 
       FROM bug_reports br 
       LEFT JOIN users u ON u.id = br.user_id 
       WHERE br.id = $1`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Hibajegy nem található" });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error("Get bug report error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/bug-reports – új hibajegy beküldése ─────── */
router.post("/", requireLogin, async (req, res) => {
  try {
    const { image_url, description } = req.body;
    const userId   = req.session.user?.id;
    const username = req.session.user?.username;

    if (!image_url || !description?.trim()) {
      return res.status(400).json({ error: "image_url és description kötelező" });
    }

    const parsed = parseImageUrl(image_url);
    if (!parsed) {
      return res.status(400).json({ error: "Érvénytelen kép URL" });
    }

    const { provider, mangaSlug, chapter, imageFile, imageIndex } = parsed;

    const { rows } = await pool.query(`
      INSERT INTO bug_reports
        (provider, manga_slug, chapter, image_file, image_index, image_url, user_id, username, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [provider, mangaSlug, chapter, imageFile, imageIndex, image_url,
        userId || null, username || "Névtelen", description.trim()]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Bug report create error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ADMIN FUNKCIÓK - ÚJ!
   ══════════════════════════════════════════════════════════ */

/* ── POST /api/bug-reports/:id/close – lezárás (javítva/indokkal) ── */
router.post("/:id/close", requireAdmin, async (req, res) => {
  try {
    const { closed, close_reason, closed_without_fix } = req.body;
    const userId = req.session.user.id;
    const bugId = req.params.id;
    
    const { rows } = await pool.query(`
      UPDATE bug_reports
      SET is_closed = $1,
          close_reason = $2,
          closed_without_fix = $3,
          closed_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
          closed_by = CASE WHEN $1 THEN $4 ELSE NULL END
      WHERE id = $5
      RETURNING *
    `, [
      closed !== undefined ? closed : true,
      close_reason || null,
      closed_without_fix || false,
      userId,
      bugId
    ]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Hibajegy nem található" });
    }
    
    res.json({ success: true, bug_report: rows[0] });
  } catch (err) {
    console.error("Close bug report error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/bug-reports/:id/reopen – újranyitás ────── */
router.post("/:id/reopen", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE bug_reports
      SET is_closed = FALSE,
          close_reason = NULL,
          closed_without_fix = FALSE,
          closed_at = NULL,
          closed_by = NULL
      WHERE id = $1
      RETURNING *
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Hibajegy nem található" });
    }
    
    res.json({ success: true, bug_report: rows[0] });
  } catch (err) {
    console.error("Reopen bug report error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── DELETE /api/bug-reports/:id – törlés ────────────── */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM bug_reports WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Hibajegy nem található" });
    }
    
    res.json({ success: true, deleted_id: parseInt(req.params.id) });
  } catch (err) {
    console.error("Delete bug report error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   BUG FIXES - JAVÍTÁSOK
   ══════════════════════════════════════════════════════════ */

/* ── PATCH /api/bug-reports/:id/close – RÉGI lezárás (DEPRECATED) ── */
// MEGJEGYZÉS: Ez a régi toggle funkció - az új POST /close használata ajánlott
router.patch("/:id/close", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE bug_reports
      SET is_closed = NOT is_closed,
          closed_at = CASE WHEN NOT is_closed THEN NOW() ELSE NULL END,
          closed_by = CASE WHEN NOT is_closed THEN $1 ELSE NULL END
      WHERE id = $2 RETURNING *
    `, [req.session.user.id, req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/bug-reports/fix – javítás mentése ────────── */
router.post("/fix", requireLogin, async (req, res) => {
  try {
    const { manga_slug, chapter, image_index, image_file, fixed_image_url } = req.body;
    const userId   = req.session.user.id;
    const username = req.session.user.username;

    const { rows } = await pool.query(`
      INSERT INTO bug_fixes
        (manga_slug, chapter, image_index, image_file, fixed_image_url,
         fixed_by, fixed_by_name, fixed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [manga_slug, chapter, image_index, image_file, fixed_image_url, userId, username]);

    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/bug-reports/fix/:id/vote – szavazás ─────── */
router.post("/fix/:id/vote", requireLogin, async (req, res) => {
  try {
    const { vote } = req.body; // 1 vagy -1
    const userId = req.session.user.id;
    const fixId  = parseInt(req.params.id);

    if (vote !== 1 && vote !== -1) return res.status(400).json({ error: "vote: 1 vagy -1" });

    // Upsert szavazat
    await pool.query(`
      INSERT INTO bug_fix_votes (fix_id, user_id, vote)
      VALUES ($1, $2, $3)
      ON CONFLICT (fix_id, user_id)
      DO UPDATE SET vote = $3
    `, [fixId, userId, vote]);

    // Összeszámolás
    const { rows } = await pool.query(`
      UPDATE bug_fixes SET
        likes    = (SELECT COUNT(*) FROM bug_fix_votes WHERE fix_id=$1 AND vote=1),
        dislikes = (SELECT COUNT(*) FROM bug_fix_votes WHERE fix_id=$1 AND vote=-1)
      WHERE id = $1 RETURNING likes, dislikes
    `, [fixId]);

    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/bug-reports/fix/upload – javított kép feltöltése ── */
router.post("/fix/upload", requireLogin, upload.single("image"), async (req, res) => {
  try {
    const { manga_slug, chapter, image_index, provider } = req.body;
    const userId   = req.session.user.id;
    const username = req.session.user.username;

    if (!req.file) return res.status(400).json({ error: "Nincs fájl" });

    // Mappa struktúra: uploads/bugs/javitott/manga_slug/chapter/
    const fs   = await import("fs");
    const path = await import("path");

    const dir = path.join(process.cwd(), "uploads", "bugs", "javitott",
      manga_slug, chapter);
    fs.mkdirSync(dir, { recursive: true });

    // Fájlnév: image_index.jpg
    const filename = `${image_index}.jpg`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    const fixedUrl = `/uploads/bugs/javitott/${manga_slug}/${chapter}/${filename}`;

    // DB mentés
    const providerVal = provider || "unknown";
    const { rows } = await pool.query(`
      INSERT INTO bug_fixes
        (provider, manga_slug, chapter, image_index, image_file, fixed_image_url,
         fixed_by, fixed_by_name, fixed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [providerVal, manga_slug, chapter, parseInt(image_index), filename, fixedUrl, userId, username]);

    res.json({ ok: true, fix: rows[0], url: fixedUrl });
  } catch (err) {
    console.error("Fix upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/bug-reports/fix/:id/apply – admin alkalmazza ── */
router.post("/fix/:id/apply", requireAdmin, async (req, res) => {
  try {
    const { rows: fixRows } = await pool.query(
      "SELECT * FROM bug_fixes WHERE id=$1", [req.params.id]
    );
    if (!fixRows.length) return res.status(404).json({ error: "Nem található" });
    const fix = fixRows[0];

    const fs   = await import("fs");
    const path = await import("path");

    // 1. Eredeti fájlnév lekérése a bug_reports táblából
    const { rows: reportRows } = await pool.query(`
      SELECT image_file FROM bug_reports
      WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3
      LIMIT 1
    `, [fix.manga_slug, fix.chapter, fix.image_index]);

    if (!reportRows.length) {
      return res.status(404).json({ error: "Bug report nem található az eredeti fájlnévhez" });
    }
    const originalFilename = reportRows[0].image_file;

    // 2. Javított kép helye (uploads/bugs/javitott/...)
    const fixedDir  = path.join(process.cwd(), "uploads", "bugs", "javitott", fix.manga_slug, fix.chapter);
    const fixedFile = path.join(fixedDir, `${fix.image_index}.jpg`);

    if (!fs.existsSync(fixedFile)) {
      return res.status(404).json({ error: "Javított kép fájl nem található: " + fixedFile });
    }

    // 3. Eredeti kép elérési útja a DB-ből (library_path + manga_folder + chapter + eredeti fájlnév)
    const { rows: pathRows } = await pool.query(`
      SELECT l.path AS library_path, m.folder AS manga_folder
      FROM manga m
      JOIN library l ON l.id = m.library_id
      WHERE m.slug = $1
      LIMIT 1
    `, [fix.manga_slug]);

    if (!pathRows.length) {
      return res.status(404).json({ error: "Manga nem található az adatbázisban: " + fix.manga_slug });
    }

    const { library_path, manga_folder } = pathRows[0];
    const originalPath = path.join(library_path, manga_folder, fix.chapter, originalFilename);

    if (!fs.existsSync(originalPath)) {
      return res.status(404).json({ error: "Eredeti kép nem található: " + originalPath });
    }

    // 3. Javított → eredeti fájl felülírása (read/write NFS kompatibilis)
    const fileData = fs.readFileSync(fixedFile);
    fs.writeFileSync(originalPath, fileData);

    // 4. Javított kép törlése az uploads mappából
    fs.unlinkSync(fixedFile);

    // 5. Ha a mappa üres lett, törli azt is
    try {
      const remaining = fs.readdirSync(fixedDir);
      if (remaining.length === 0) fs.rmdirSync(fixedDir);
    } catch (_) {}

    // 6. DB frissítés
    await pool.query(
      `UPDATE bug_fixes SET is_applied=true, fixed_image_url=$1 WHERE id=$2`,
      [originalPath, req.params.id]
    );

    // 7. Kapcsolódó bug reportok lezárása
    await pool.query(`
      UPDATE bug_reports SET is_closed=true, closed_at=NOW(), closed_by=$1
      WHERE manga_slug=$2 AND chapter=$3 AND image_index=$4
    `, [req.session.user.id, fix.manga_slug, fix.chapter, fix.image_index]);

    // 7.5. Pont hozzáadása a javítónak (ha még nem kapta meg)
    try {
      const { rows: pointCheck } = await pool.query(
        `SELECT id FROM user_points WHERE fix_id = $1`,
        [req.params.id]
      );
      
      if (!pointCheck.length) {
        await pool.query(`
          INSERT INTO user_points (user_id, fix_id, points, approved_by, earned_at)
          VALUES ($1, $2, 1, $3, NOW())
        `, [fix.fixed_by, req.params.id, req.session.user.id]);
        
        console.log(`[PONT] +1 pont hozzáadva user_id=${fix.fixed_by} (fix_id=${req.params.id})`);
      }
    } catch (pointErr) {
      console.error("[PONT hiba]", pointErr.message);
      // Nem állítjuk le a folyamatot, ha a pont hozzáadás sikertelen
    }

    // 8. Cloudflare cache purge csak erre az egy képre
    const CF_ZONE   = process.env.CF_ZONE_ID;
    const CF_TOKEN  = process.env.CF_API_TOKEN;
    const CF_DOMAIN = process.env.CF_DOMAIN || "https://padlizsanfansub.hu";

    if (CF_ZONE && CF_TOKEN) {
      const imageUrl = `${CF_DOMAIN}/api/image/${fix.provider}/${fix.manga_slug}/${fix.chapter}/${encodeURIComponent(originalFilename)}`;
      try {
        await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${CF_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ files: [imageUrl] })
        });
        console.log("[CF purge] OK:", imageUrl);
      } catch (cfErr) {
        console.warn("[CF purge hiba]", cfErr.message);
      }
    }

    res.json({ ok: true, original: originalPath });
  } catch (err) {
    console.error("Fix apply error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   MIDDLEWARE
   ══════════════════════════════════════════════════════════ */

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
    if (!rows.length || rows[0].tier !== "Admin")
      return res.status(403).json({ error: "Nincs jogosultság" });
    next();
  } catch { return res.status(500).json({ error: "Auth hiba" }); }
}

export default router;
