// server/routes/bug-reports.js
import express from "express";
import fsSync from "fs";
import pathSync from "path";
import { pool } from "../db.js";
import { r2, BUCKET, localPathToR2Key } from "../r2.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
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
        u.username,
        m.title as manga_title,
        cb.username as closed_by_name,
        m.uploaders as translator,
        (SELECT COUNT(*) FROM bug_report_comments WHERE bug_report_id = br.id) as comment_count,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', bf2.id,
            'fixed_image_url', bf2.fixed_image_url,
            'fixed_by', bf2.fixed_by,
            'fixed_by_name', bf2.fixed_by_name,
            'fixed_at', bf2.fixed_at,
            'is_applied', bf2.is_applied,
            'award_points', bf2.award_points,
            'likes', bf2.likes,
            'dislikes', bf2.dislikes
          ) ORDER BY bf2.created_at DESC)
          FROM bug_fixes bf2
          WHERE bf2.manga_slug = br.manga_slug
            AND bf2.chapter = br.chapter
            AND bf2.image_index = br.image_index
        ), '[]') as fixes
      FROM bug_reports br
      LEFT JOIN users u ON u.id = br.user_id
      LEFT JOIN users cb ON cb.id = br.closed_by
      LEFT JOIN manga m ON m.slug = br.manga_slug
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    if (manga_slug) {
      paramCount++;
      query += ` AND br.manga_slug = $${paramCount}`;
      params.push(manga_slug);
    }

    if (chapter) {
      paramCount++;
      query += ` AND br.chapter = $${paramCount}`;
      params.push(chapter);
    }

    if (closed !== undefined) {
      paramCount++;
      const isClosed = closed === 'true' || closed === true;
      query += ` AND br.is_closed = $${paramCount}`;
      params.push(isClosed);
    }

    query += ` ORDER BY br.created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json(rows);

  } catch (err) {
    console.error("GET BUG REPORTS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
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

/* ── NOTIFICATIONS – specifikus route-ok ELŐBB, :id wildcard UTÁNA ── */
 
// GET összes
router.get("/notifications", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET NOTIFICATIONS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// GET olvasatlan szám
router.get("/notifications/unread-count", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false",
      [userId]
    );
    res.json({ count: parseInt(rows[0].count) });
  } catch (err) {
    console.error("GET UNREAD COUNT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// POST összes olvasottnak (ELŐBB mint /:id/mark-read)
router.post("/notifications/mark-all-read", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    await pool.query(
      "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
      [userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("MARK ALL READ ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// DELETE összes (ELŐBB mint /:id)
router.delete("/notifications", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    await pool.query("DELETE FROM notifications WHERE user_id = $1", [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ALL NOTIFICATIONS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// POST egy olvasottnak (wildcard – UTOLSÓ a POST-ok közül)
router.post("/notifications/:id/mark-read", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    await pool.query(
      "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("MARK READ ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
 
// DELETE egy értesítés (wildcard – UTOLSÓ a DELETE-ek közül)
router.delete("/notifications/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    await pool.query(
      "DELETE FROM notifications WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE NOTIFICATION ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
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
    const { image_url, description, image_index: explicitIndex } = req.body;
    const userId   = req.session.user?.id;
    const username = req.session.user?.username;

    if (!image_url || !description?.trim()) {
      return res.status(400).json({ error: "image_url és description kötelező" });
    }

    const parsed = parseImageUrl(image_url);
    if (!parsed) {
      return res.status(400).json({ error: "Érvénytelen kép URL" });
    }

    const { provider, mangaSlug, chapter, imageFile } = parsed;
    // Frontend által küldött index prioritást élvez; fallback: URL-ből parsed
    const imageIndex = (explicitIndex !== undefined && explicitIndex !== null && !isNaN(parseInt(explicitIndex)))
      ? parseInt(explicitIndex)
      : parsed.imageIndex;

    // Deduplication: ha már van nyitott hibajegy ugyanarra a képre, növeljük a számlálót
    const existing = await pool.query(`
      SELECT id FROM bug_reports
      WHERE manga_slug=$1 AND chapter=$2 AND (image_index=$3 OR (image_index IS NULL AND image_file=$4)) AND is_closed=false
      LIMIT 1
    `, [mangaSlug, chapter, imageIndex, imageFile]);

    if (existing.rows.length) {
      const existingId = existing.rows[0].id;
      await pool.query(
        `UPDATE bug_reports SET report_count = report_count + 1 WHERE id=$1`,
        [existingId]
      );
      // Az új bejelentő leírását kommentként mentjük el
      const description = req.body?.description;
      if (description?.trim()) {
        await pool.query(
          `INSERT INTO bug_report_comments (bug_report_id, user_id, comment) VALUES ($1, $2, $3)`,
          [existingId, req.session.user?.id || null, description.trim()]
        );
      }
      return res.status(201).json({ ...existing.rows[0], merged: true });
    }

    const { rows } = await pool.query(`
      INSERT INTO bug_reports
        (provider, manga_slug, chapter, image_file, image_index, image_url, user_id, username, description, report_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
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

    // CF cache purge ha lezárás (nem újranyitás)
    if (closed !== false) {
      const r = rows[0];
      purgeImageCF(r.manga_slug, r.chapter, r.image_file).catch(() => {});
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

    if (rows[0]) {
      // Értesítés az összes adminnak
      try {
        const { rows: admins } = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
        const msg  = `🖊️ ${username} javított egy képet — ${manga_slug} ${chapter} #${image_index ?? image_file}. Jóváhagyás szükséges!`;
        const link = `/bug-reports.html`;
        for (const admin of admins) {
          if (admin.id === userId) continue;
          await pool.query(
            `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'fix_submitted', $2, $3)`,
            [admin.id, msg, link]
          );
        }
      } catch (notifErr) {
        console.warn("[fix] értesítés hiba:", notifErr.message);
      }
    }

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

/* ── PATCH /api/bug-reports/fix/:id/award-points – pontrendszer toggle ── */
router.patch("/fix/:id/award-points", requireAdmin, async (req, res) => {
  try {
    const { award_points } = req.body;
    const { rows } = await pool.query(
      `UPDATE bug_fixes SET award_points=$1 WHERE id=$2 RETURNING id, award_points`,
      [award_points !== false, parseInt(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: "Nem található" });
    res.json({ ok: true, ...rows[0] });
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
    const fs = fsSync;
    const path = pathSync;

    const dir = path.join(process.cwd(), "uploads", "bugs", "javitott",
      manga_slug, chapter);
    fs.mkdirSync(dir, { recursive: true });

    // Fájlnév: image_index_userId.jpg (egy user csak egyet tölthet fel képenként)
    const filename = `${image_index}_${userId}.jpg`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    const fixedUrl = `/uploads/bugs/javitott/${manga_slug}/${chapter}/${image_index}_${userId}.jpg`;

    // DB mentés — ha már van javítása, frissítjük
    const providerVal = provider || "unknown";
    const { rows } = await pool.query(`
      INSERT INTO bug_fixes
        (provider, manga_slug, chapter, image_index, image_file, fixed_image_url,
         fixed_by, fixed_by_name, fixed_at, award_points)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),true)
      ON CONFLICT (manga_slug, chapter, image_index, fixed_by)
      DO UPDATE SET fixed_image_url = EXCLUDED.fixed_image_url,
                    fixed_at = NOW()
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

    const fs = fsSync;
    const path = pathSync;

    // 1. Eredeti fájlnév lekérése a bug_reports táblából
    const { rows: reportRows } = await pool.query(`
      SELECT image_file FROM bug_reports
      WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3
      LIMIT 1
    `, [fix.manga_slug, fix.chapter, fix.image_index]);

    if (!reportRows.length) {
      return res.status(404).json({ error: "Bug report nem található az eredeti fájlnévhez" });
    }
    // ?r2=1 és egyéb query paraméterek levágása
    const originalFilename = reportRows[0].image_file.split("?")[0];

    // 2. Javított kép helye — a fixed_image_url-ből vesszük a pontos fájlnevet (pl. 19_5.jpg)
    const fixedDir = path.join(process.cwd(), "uploads", "bugs", "javitott", fix.manga_slug, fix.chapter);
    if (!fix.fixed_image_url) {
      return res.status(404).json({ error: "A javítás nem tartalmaz fájl URL-t" });
    }
    const fixedFile = path.join(fixedDir, path.basename(fix.fixed_image_url));
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
    const originalPath = pathSync.join(library_path, manga_folder, fix.chapter, originalFilename);

    // 3. Javított fájl beolvasása, majd célhelyre írás (ha a mappa/fájl nem létezik, létrehozzuk)
    const fileData = fsSync.readFileSync(fixedFile);
    fsSync.mkdirSync(pathSync.dirname(originalPath), { recursive: true });
    fsSync.writeFileSync(originalPath, fileData);

    // 4. Javított kép törlése az uploads mappából
    fsSync.unlinkSync(fixedFile);

    // 5. Ha a mappa üres lett, törli azt is
    try {
      const remaining = fsSync.readdirSync(fixedDir);
      if (remaining.length === 0) fsSync.rmdirSync(fixedDir);
    } catch (_) {}

    // 6. DB frissítés
    await pool.query(
      `UPDATE bug_fixes SET is_applied=true, fixed_image_url=$1 WHERE id=$2`,
      [originalPath, req.params.id]
    );

    // 6.5. R2 feltöltés + chapter updated_at cache-bust
    try {
      const r2Key = localPathToR2Key(originalPath);
      const ct = /\.png$/i.test(originalFilename) ? "image/png" : "image/jpeg";
      await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: r2Key, Body: fileData, ContentType: ct }));
      await pool.query(
        `UPDATE chapter SET updated_at = NOW()
         WHERE folder = $1 AND manga_id = (SELECT id FROM manga WHERE slug = $2 LIMIT 1)`,
        [fix.chapter, fix.manga_slug]
      );
      console.log(`[fix-apply] R2 feltöltve: ${r2Key}`);
    } catch (r2Err) {
      console.error("[fix-apply] R2 hiba:", r2Err.message);
    }

    // 7. Kapcsolódó bug reportok lezárása
    await pool.query(`
      UPDATE bug_reports SET is_closed=true, closed_at=NOW(), closed_by=$1
      WHERE manga_slug=$2 AND chapter=$3 AND image_index=$4
    `, [req.session.user.id, fix.manga_slug, fix.chapter, fix.image_index]);

    // 7.5. Pont hozzáadása — csak ha award_points true
    try {
      if (fix.award_points !== false) {
        const { rows: pointCheck } = await pool.query(
          `SELECT id FROM user_points WHERE fix_id = $1`,
          [req.params.id]
        );
        if (!pointCheck.length) {
          await pool.query(`
            INSERT INTO user_points (user_id, fix_id, points, approved_by, earned_at)
            VALUES ($1, $2, 5, $3, NOW())
          `, [fix.fixed_by, req.params.id, req.session.user.id]);
          console.log(`[PONT] +5 pont user_id=${fix.fixed_by} (fix_id=${req.params.id})`);
        }
      } else {
        console.log(`[PONT] Kihagyva (award_points=false) fix_id=${req.params.id}`);
      }
    } catch (pointErr) {
      console.error("[PONT hiba]", pointErr.message);
    }

    // 7.6. Többi (el nem fogadott) javítás fájljainak törlése
    try {
      const { rows: otherFixes } = await pool.query(
        `SELECT fixed_image_url FROM bug_fixes WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 AND id != $4`,
        [fix.manga_slug, fix.chapter, fix.image_index, req.params.id]
      );
      for (const other of otherFixes) {
        try {
          const p = path.join(process.cwd(), other.fixed_image_url);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {}
      }
    } catch (_) {}

    // 7.6. Notification küldése
    try {
      const fixerName = fix.fixed_by_name || "Javító";
      const mangaInfo = `${fix.manga_slug} ${fix.chapter} #${fix.image_index}`;
      const bugLink   = `/bug-reports.html?id=`;

      const { rows: reporters } = await pool.query(`
        SELECT DISTINCT user_id FROM bug_reports
        WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 AND user_id IS NOT NULL
      `, [fix.manga_slug, fix.chapter, fix.image_index]);

      for (const reporter of reporters) {
        const { rows: rr } = await pool.query(`
          SELECT id FROM bug_reports
          WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 AND user_id=$4
          LIMIT 1
        `, [fix.manga_slug, fix.chapter, fix.image_index, reporter.user_id]);
        await pool.query(`
          INSERT INTO notifications (user_id, type, message, link)
          VALUES ($1, 'bug_closed', $2, $3)
        `, [
          reporter.user_id,
          `A hibajegyed javítva lett: ${mangaInfo} – Javította: ${fixerName}`,
          rr[0] ? `${bugLink}${rr[0].id}` : null
        ]);
      }

      if (fix.fixed_by && fix.fixed_by !== req.session.user.id) {
        const { rows: fixerReport } = await pool.query(`
          SELECT id FROM bug_reports
          WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3
          LIMIT 1
        `, [fix.manga_slug, fix.chapter, fix.image_index]);
        await pool.query(`
          INSERT INTO notifications (user_id, type, message, link)
          VALUES ($1, 'bug_closed', $2, $3)
        `, [
          fix.fixed_by,
          `Javításod elfogadva! +1 pont jóváírva – ${mangaInfo}`,
          fixerReport[0] ? `${bugLink}${fixerReport[0].id}` : null
        ]);
      }
    } catch (notifErr) {
      console.error("[NOTIF hiba]", notifErr.message);
    }

    // 8. Cloudflare cache purge — API URL + R2 public URL
    try {
      const CF_ZONE   = process.env.CF_ZONE_ID;
      const CF_TOKEN  = process.env.CF_API_TOKEN;
      const CF_DOMAIN = process.env.CF_DOMAIN || "https://padlizsanfansub.hu";
      const R2_PUBLIC = process.env.R2_PUBLIC_URL;
      if (CF_ZONE && CF_TOKEN) {
        const urls = [
          `${CF_DOMAIN}/api/image/${fix.provider}/${fix.manga_slug}/${fix.chapter}/${encodeURIComponent(originalFilename)}`,
        ];
        if (R2_PUBLIC) urls.push(`${R2_PUBLIC}/${localPathToR2Key(originalPath)}`);
        await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ files: urls }),
        });
        console.log("[CF purge] OK:", urls.join(", "));
      }
    } catch (cfErr) {
      console.warn("[CF purge hiba]", cfErr.message);
    }

    res.json({ ok: true, original: originalPath });
  } catch (err) {
    console.error("Fix apply error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/bug-reports/fix/:id/correct – admin korrekció ── */
router.post("/fix/:id/correct", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nincs fájl" });

    const { rows: fixRows } = await pool.query("SELECT * FROM bug_fixes WHERE id=$1", [req.params.id]);
    if (!fixRows.length) return res.status(404).json({ error: "Fix nem található" });
    const fix = fixRows[0];

    const { rows: reportRows } = await pool.query(
      `SELECT image_file FROM bug_reports WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 LIMIT 1`,
      [fix.manga_slug, fix.chapter, fix.image_index]
    );
    if (!reportRows.length) return res.status(404).json({ error: "Bug report nem található" });
    const originalFilename = reportRows[0].image_file.split("?")[0];

    const { rows: pathRows } = await pool.query(
      `SELECT l.path AS library_path, m.folder AS manga_folder
       FROM manga m JOIN library l ON l.id = m.library_id WHERE m.slug=$1 LIMIT 1`,
      [fix.manga_slug]
    );
    if (!pathRows.length) return res.status(404).json({ error: "Manga nem található" });

    const { library_path, manga_folder } = pathRows[0];

    const fs = fsSync;
    const path = pathSync;

    const originalPath = path.join(library_path, manga_folder, fix.chapter, originalFilename);
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.writeFileSync(originalPath, req.file.buffer);

    // R2 feltöltés + updated_at
    try {
      const r2Key = localPathToR2Key(originalPath);
      const ct = /\.png$/i.test(originalFilename) ? "image/png" : "image/jpeg";
      await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: r2Key, Body: req.file.buffer, ContentType: ct }));
      await pool.query(
        `UPDATE chapter SET updated_at = NOW()
         WHERE folder = $1 AND manga_id = (SELECT id FROM manga WHERE slug = $2 LIMIT 1)`,
        [fix.chapter, fix.manga_slug]
      );
    } catch (r2Err) {
      console.error("[correct] R2 hiba:", r2Err.message);
    }

    await pool.query(`UPDATE bug_fixes SET fixed_at=NOW() WHERE id=$1`, [req.params.id]);

    purgeImageCF(fix.manga_slug, fix.chapter, originalFilename).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    console.error("Fix correct error:", err);
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

/* ── CF cache purge egy képre ───────────────────────────── */
async function purgeImageCF(mangaSlug, chapter, imageFile) {
  const CF_ZONE  = process.env.CF_ZONE_ID;
  const CF_TOKEN = process.env.CF_API_TOKEN;
  const CF_DOMAIN = process.env.CF_DOMAIN || "https://padlizsanfansub.hu";
  if (!CF_ZONE || !CF_TOKEN) return;
  try {
    const { rows } = await pool.query(`
      SELECT l.name AS library_name
      FROM manga m JOIN library l ON l.id = m.library_id
      WHERE m.slug = $1 LIMIT 1
    `, [mangaSlug]);
    if (!rows.length) return;
    const url = `${CF_DOMAIN}/api/image/${encodeURIComponent(rows[0].library_name)}/${encodeURIComponent(mangaSlug)}/${encodeURIComponent(chapter)}/${encodeURIComponent(imageFile)}`;
    await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: [url] })
    });
  } catch (err) {
    console.warn("[CF purge hiba]", err.message);
  }
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

router.get("/:id/comments", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      SELECT 
        c.id,
        c.comment,
        c.created_at,
        u.id as user_id,
        u.username,
        u.role
      FROM bug_report_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.bug_report_id = $1
      ORDER BY c.created_at ASC
    `, [id]);

    res.json(rows);

  } catch (err) {
    console.error("GET COMMENTS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────
   POST /api/bug-reports/:id/comments - Komment hozzáadása
   ────────────────────────────────────────────────────────── */
router.post("/:id/comments", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const userId = req.session.user.id;

    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "Comment cannot be empty" });
    }

    // Komment létrehozása
    const { rows } = await pool.query(`
      INSERT INTO bug_report_comments (bug_report_id, user_id, comment)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, userId, comment.trim()]);

    // Bug report tulajdonosának lekérése
    const bugReport = await pool.query(`
      SELECT user_id, manga_slug, chapter, image_index
      FROM bug_reports
      WHERE id = $1
    `, [id]);

    if (bugReport.rows.length > 0) {
      const reportUserId = bugReport.rows[0].user_id;
      const { manga_slug, chapter, image_index } = bugReport.rows[0];
      const commenterName = req.session.user.username;
      const msg = `${commenterName} válaszolt a hibajegyre (${manga_slug} Ch${chapter} #${image_index})`;
      const link = `/bug-reports.html?id=${id}`;

      // Értesítés mindenki számára aki részt vett (report owner + összes kommentelő),
      // kivéve aki most kommentelt — és mindenkit csak egyszer
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link)
        SELECT DISTINCT u_id, $1, $2, $3
        FROM (
          SELECT user_id AS u_id FROM bug_reports WHERE id = $4
          UNION
          SELECT user_id AS u_id FROM bug_report_comments WHERE bug_report_id = $4
        ) participants
        WHERE u_id != $5
      `, ['bug_comment', msg, link, id, userId]);
    }

    // User adatok lekérése a válaszhoz
    const user = await pool.query(`
      SELECT id, username, role FROM users WHERE id = $1
    `, [userId]);

    res.json({
      ...rows[0],
      username: user.rows[0].username,
      role: user.rows[0].role
    });

  } catch (err) {
    console.error("POST COMMENT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────
   POST /api/bug-reports/:id/close-with-reason - Lezárás indokkal
   ────────────────────────────────────────────────────────── */
router.post("/:id/close-with-reason", requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Reason required" });
    }

    // Lezárás indokkal (nem javítva)
    await pool.query(`
      UPDATE bug_reports
      SET 
        is_closed = true,
        closed_without_fix = true,
        close_reason = $1,
        closed_at = NOW(),
        closed_by = $2
      WHERE id = $3
    `, [reason.trim(), req.session.user.id, id]);

    // Bug report adatok lekérése értesítéshez + CF purge-hoz
    const bugData = await pool.query(`
      SELECT user_id, manga_slug, chapter, image_index, image_file
      FROM bug_reports
      WHERE id = $1
    `, [id]);

    if (bugData.rows.length > 0) {
      const { user_id, manga_slug, chapter, image_index, image_file } = bugData.rows[0];

      // Értesítés a bejelentőnek
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link)
        VALUES ($1, $2, $3, $4)
      `, [
        user_id,
        'bug_closed',
        `A hibajegyed lezárásra került: ${manga_slug} Ch${chapter} #${image_index}`,
        `/bug-reports.html?id=${id}`
      ]);

      // CF cache purge
      purgeImageCF(manga_slug, chapter, image_file).catch(() => {});
    }

    res.json({ success: true });

  } catch (err) {
    console.error("CLOSE WITH REASON ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────
   DELETE /api/bug-reports/:id/comments/:commentId - Komment törlése
   ────────────────────────────────────────────────────────── */
router.delete("/:id/comments/:commentId", requireLogin, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === "admin";

    // Csak saját komment vagy admin törölheti
    const result = await pool.query(`
      DELETE FROM bug_report_comments
      WHERE id = $1 
        AND (user_id = $2 OR $3 = true)
      RETURNING id
    `, [commentId, userId, isAdmin]);

    if (result.rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("DELETE COMMENT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
