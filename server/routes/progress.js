import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import fs from "fs";
import path from "path";

const router = express.Router();

// ✅ Chapter számok természetes rendezése
function parseChapterNumber(str) {
  const m = str.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : Infinity;
}

/* ===== SAVE PROGRESS ===== */
router.post("/", async (req, res) => {
  const userId = req.session.user?.id;
  const { slug, chapter, page } = req.body;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  const manga = await pool.query("SELECT id FROM manga WHERE slug = $1", [slug]);
  if (!manga.rows.length) return res.status(404).json({ error: "Manga not found" });

  const mangaId = manga.rows[0].id;

  // Lekérjük az előző fejezetet
  const prev = await pool.query(
    `SELECT chapter FROM reading_progress WHERE user_id = $1 AND manga_id = $2`,
    [userId, mangaId]
  );
  const prevChapter = prev.rows[0]?.chapter || null;

  await pool.query(
    `INSERT INTO reading_progress (user_id, manga_id, chapter, page)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, manga_id)
     DO UPDATE SET chapter = EXCLUDED.chapter, page = EXCLUDED.page, updated_at = now()`,
    [userId, mangaId, chapter, page]
  );

  // Chapter read log - csak ha fejezet változott (vagy első olvasás)
  if (prevChapter !== chapter) {
    await pool.query(
      `INSERT INTO chapter_reads (user_id, manga_id, chapter)
       VALUES ($1, $2, $3)`,
      [userId, mangaId, chapter]
    ).catch(() => {}); // ha a tábla még nem létezik, nem dob hibát
  }

  res.json({ ok: true });
});

/* ===== now reading ===== */
router.get("/recent-reading", async (req, res) => {
  
  try {
    if (!req.session || !req.session.user) {
      return res.json([]);
    }
    
    const userId = req.session.user.id;
    
    const progressQuery = `
      SELECT DISTINCT ON (m.slug)
        rp.chapter,
        rp.page,
        rp.updated_at,
        m.slug AS manga_slug,
        m.title,
        m.cover_url,
        m.folder,
        l.name AS library_name,
        l.path AS library_path
      FROM reading_progress rp
      INNER JOIN manga m ON m.id = rp.manga_id
      LEFT JOIN library l ON l.id = m.library_id
      WHERE rp.user_id = $1
      ORDER BY m.slug, rp.updated_at DESC
    `;
    
    const { rows: progressRows } = await pool.query(progressQuery, [userId]);
    
    if (progressRows.length > 0) {
    }
    
    if (progressRows.length === 0) {
      return res.json([]);
    }
    
    const results = await Promise.all(
      progressRows.map(async (p) => {
        try {
          
          if (!p.library_path) {
            return null;
          }
          
          const folderName = p.folder || p.manga_slug;
          const chaptersPath = path.join(p.library_path, folderName);
          
          
          if (!fs.existsSync(chaptersPath)) {
            return null;
          }
          
          // ✅ TERMÉSZETES RENDEZÉS (számszerű)
          const folders = fs.readdirSync(chaptersPath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .sort((a, b) => parseChapterNumber(a) - parseChapterNumber(b));
          
          
          if (folders.length === 0) {
            return null;
          }
          
          const lastChapter = folders[folders.length - 1];
          
          if (p.chapter === lastChapter) {
            return null;
          }
          
          const currentIndex = folders.indexOf(p.chapter);
          
          if (currentIndex === -1) {
            return null;
          }
          
          const hasNewChapter = currentIndex < folders.length - 1;
          const nextChapter = hasNewChapter ? folders[currentIndex + 1] : null;
          
          
          return {
            slug: p.manga_slug,
            title: p.title,
            cover_url: p.cover_url,
            library: p.library_name,
            chapter: p.chapter,
            page: p.page,
            updated_at: p.updated_at,
            lastChapter,
            hasNewChapter,
            nextChapter,
            totalChapters: folders.length,
            currentIndex: currentIndex 
          };
          
        } catch (err) {
          return null;
        }
      })
    );
    
    const filtered = results.filter(Boolean);
    
    if (filtered.length > 0) {
    }
    
    // Duplikáció eltávolítása
    const deduped = {};
    filtered.forEach(item => {
      const key = item.slug;
      if (!deduped[key]) {
        deduped[key] = item;
      } else {
        const existing = deduped[key];
        if (item.library < existing.library) {
          deduped[key] = item;
        }
      }
    });
    
    const dedupedList = Object.values(deduped);
    
    // Prioritás rendezés
    const sorted = dedupedList.sort((a, b) => {
        // 1️⃣ Majdnem kész (utolsó előtti résznél)
        const aAlmostDone = a.hasNewChapter && (a.currentIndex === a.totalChapters - 2);
        const bAlmostDone = b.hasNewChapter && (b.currentIndex === b.totalChapters - 2);
  
             if (aAlmostDone && !bAlmostDone) return -1;
             if (!aAlmostDone && bAlmostDone) return 1;
  
         // 2️⃣ Legutóbb olvasott
         return new Date(b.updated_at) - new Date(a.updated_at);
     });
    
    
    res.json(sorted);
    
  } catch (err) {
    console.error("[ERROR] Recent reading:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===== LOAD PROGRESS ===== */
router.get("/:slug?", requireLogin, async (req, res) => {
  if (!req.session.user) return res.json(null);

  const slug = req.params.slug || req.query.slug;
  if (!slug) return res.json(null);
  const userId = req.session.user.id;

  const { rows } = await pool.query(
    `SELECT rp.chapter, rp.page, rp.updated_at
     FROM reading_progress rp
     JOIN manga m ON m.id = rp.manga_id
     WHERE rp.user_id = $1 AND m.slug = $2
     LIMIT 1`,
    [userId, slug]
  );

  res.json(rows[0] || null);
});

/* ===== DELETE PROGRESS ===== */
router.delete("/:slug", requireLogin, async (req, res) => {
  const userId = req.session.user?.id;
  const { slug } = req.params;

  try {
    const manga = await pool.query("SELECT id FROM manga WHERE slug = $1", [slug]);
    if (!manga.rows.length) return res.status(404).json({ error: "Manga not found" });

    const mangaId = manga.rows[0].id;

    await pool.query(
      `DELETE FROM reading_progress WHERE user_id = $1 AND manga_id = $2`,
      [userId, mangaId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE PROGRESS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
