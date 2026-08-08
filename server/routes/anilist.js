import { pool } from "../db.js";
import express from "express";
import fetch from "node-fetch";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();
import fs from "fs";
import path from "path";
const LOG_DIR = "/opt/padli/logs";
// ===== LOG DIR BIZTOS LÉTREHOZÁS =====
if (!fs.existsSync(LOG_DIR)) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log("📁 LOG DIR CREATED:", LOG_DIR);
  } catch (err) {
    console.error("❌ LOG DIR CREATE ERROR:", err);
  }
}

// ===== LOG FILE KIVÁLASZTÁS =====
function getLogFile() {
  let index = 1;

  while (true) {
    const filePath = path.join(LOG_DIR, `queue_${index}.log`);

    // ha nincs még ilyen file → ezt használjuk
    if (!fs.existsSync(filePath)) {
      return filePath;
    }

    // ha létezik, megnézzük a méretét
    const stat = fs.statSync(filePath);

    // ha kisebb mint 10MB → ide írunk
    if (stat.size < 10 * 1024 * 1024) {
      return filePath;
    }

    // ha tele → következő fájl
    index++;
  }
}

// ===== LOG ÍRÁS =====
function writeLog(message) {
  try {
    // biztos legyen mappa
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const file = getLogFile();

    const line = `[${new Date().toISOString()}] ${message}\n`;

    fs.appendFileSync(file, line);

  } catch (err) {
    console.error("LOG ERROR:", err);
  }
}

// ===== 30 NAPOS TAKARÍTÁS =====
function cleanOldLogs() {
  try {
    const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      // Csak fájlokat törlünk — a LOG_DIR-ben lévő alkönyvtárakat (pl.
      // padli-api/) unlinkSync nem tudja törölni (EISDIR), ez korábban
      // minden egyes futásnál hibát dobott és megszakította a ciklust,
      // emiatt a nála később listázott fájlok sosem lettek letakarítva.
      if (!entry.isFile()) continue;

      const full = path.join(LOG_DIR, entry.name);
      try {
        const stat = fs.statSync(full);
        const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays > 30) {
          fs.unlinkSync(full);
        }
      } catch (err) {
        // Egy fájl hibája (pl. verseny-feltétel, jogosultság) ne
        // szakítsa meg a többi fájl takarítását.
        console.error(`CLEAN LOG ERROR (${entry.name}):`, err.message);
      }
    }
  } catch (err) {
    console.error("CLEAN LOG ERROR:", err);
  }
}

function parseChapter(chapter) {
  if (!chapter) return null;

  // kisbetű + spacek törlése
  let clean = chapter.toLowerCase().trim();

  // minden nem szám + pont törlés
  clean = clean.replace(/[^0-9.]/g, "");

  if (!clean) return null;

  const num = parseFloat(clean);

  if (isNaN(num)) return null;

  return {
    raw: chapter,
    cleaned: clean,
    float: num,
    progress: Math.floor(num) // <-- EZ KELL ANILISTNEK
  };
}

router.get("/search", requireLogin, async (req, res) => {
  try {
    const q = req.query.q;
    // Alapértelmezés MANGA — a meglévő manga-kereső hívók viselkedése változatlan.
    const isAnime = req.query.type === "anime";
    const anilistType = isAnime ? "ANIME" : "MANGA";
    const countField = isAnime ? "episodes" : "chapters";

    if (!q || q.length < 2) {
      return res.json([]);
    }

    const query = `
      query ($search: String) {
        Page(perPage: 5) {
          media(search: $search, type: ${anilistType}) {
            id
            title { romaji english }
            coverImage { medium }
            ${countField}
          }
        }
      }
    `;

    const api = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { search: q }
      })
    });

    const json = await api.json();

if (!json.data) {
  console.error("ANILIST SEARCH BAD RESPONSE:", json);
  return res.json([]);
}
    res.json(json.data.Page.media);

  } catch (err) {
    console.error("ANILIST SEARCH ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/connect", requireLogin, (req, res) => {
  const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${process.env.ANILIST_CLIENT_ID}&response_type=code&redirect_uri=${process.env.ANILIST_REDIRECT}`;
  res.redirect(url);
});

router.get("/callback", requireLogin, async (req, res) => {
  try {
    const { code } = req.query;
      if (!code) {
        return res.redirect("/settings.html?error=anilist");
      }
    const tokenRes = await fetch("https://anilist.co/api/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: process.env.ANILIST_CLIENT_ID,
        client_secret: process.env.ANILIST_CLIENT_SECRET,
        redirect_uri: process.env.ANILIST_REDIRECT,
        code
      })
    });

console.log("SESSION:", req.session);

const data = await tokenRes.json();

if (!data.access_token) {
  console.error("ANILIST TOKEN ERROR:", data);
  return res.redirect("/settings.html?error=anilist");
}
    await pool.query(`
      UPDATE users
      SET anilist_token = $1,
          anilist_connected = true
      WHERE id = $2
    `, [data.access_token, req.session.user.id]);

    res.redirect("/settings.html");

  } catch (err) {
    console.error("ANILIST CALLBACK ERROR:", err);
    res.redirect("/settings.html");
  }
});

router.get("/status", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    // 🔥 user adatok
    const userRes = await pool.query(`
      SELECT anilist_connected, anilist_token
      FROM users
      WHERE id = $1
    `, [userId]);

    // 🔥 queue adatok
    const queueRes = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE processed = false) as pending
      FROM anilist_queue
      WHERE user_id = $1
    `, [userId]);

    const user = userRes.rows[0];

    res.json({
      connected: user?.anilist_connected || false,
      hasToken: !!user?.anilist_token,
      pending: parseInt(queueRes.rows[0].pending, 10) || 0
    });

  } catch (err) {
    console.error("ANILIST STATUS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
router.post("/disconnect", requireLogin, async (req, res) => {
  await pool.query(`
    UPDATE users
    SET anilist_token = NULL,
        anilist_connected = false
    WHERE id = $1
  `, [req.session.user.id]);
console.log("ANILIST DISCONNECTED:", req.session.user.id);
  res.json({ success: true });
});

export async function syncToAniList(userId, anilistId, progress) {

  if (!anilistId || progress == null) return;

  progress = Math.floor(progress);

  try {
    const { rows } = await pool.query(`
      SELECT anilist_token
      FROM users
      WHERE id = $1
    `, [userId]);

    const token = rows[0]?.anilist_token;
    if (!token) return;

    const query = `
      mutation ($mediaId: Int, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, progress: $progress) {
          id
          progress
        }
      }
    `;

    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        query,
        variables: {
          mediaId: anilistId,
          progress
        }
      })
    });

    const json = await res.json();

    if (json.errors) {
      console.error("ANILIST API ERROR:", json.errors);
    }

  } catch (err) {
    console.error("ANILIST SYNC ERROR:", err);
  }
}

router.post("/queue", requireLogin, async (req, res) => {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "No user" });
    }

    const { slug, chapter } = req.body;

    if (!slug || !chapter) {
      return res.status(400).json({ error: "Missing data" });
    }

    // ===== USER =====
    const userRes = await pool.query(`
      SELECT anilist_token, anilist_connected, username
      FROM users
      WHERE id = $1
    `, [userId]);

    if (!userRes.rows.length) {
      return res.json({ ok: true });
    }

    const user = userRes.rows[0];

    // ❗ CSAK ANILIST USER
    if (!user.anilist_connected) {
      return res.json({ ok: true });
    }

    // ===== MANGA =====
    // Duplikált slug esetén (két manga-bejegyzés ugyanazzal a slug-gal)
    // azt részesítjük előnyben, amelyiknél TÉNYLEGESEN be van állítva
    // az anilist_id — különben a szinkron feleslegesen kihagyná azt a
    // felhasználót, akinél a "rossz" (anilist_id nélküli) duplikátum
    // jönne ki elsőnek.
    const mangaRes = await pool.query(`
      SELECT anilist_id, title
      FROM manga
      WHERE slug = $1
      ORDER BY (anilist_id IS NOT NULL) DESC, id ASC
    `, [slug]);

    if (!mangaRes.rows.length) {
      writeLog(`❌ NINCS SLUG: ${slug} | USER:${user.username}`);
      return res.json({ ok: true });
    }

    const manga = mangaRes.rows[0];

    if (!manga.anilist_id) {
      writeLog(`❌ NINCS ANILIST ID: ${manga.title} | USER:${user.username}`);
      return res.json({ ok: true });
    }

    const anilistId = manga.anilist_id;

    // ===== CHAPTER PARSE (FIX!!!) =====
    const parsed = parseChapter(chapter);

    if (!parsed) {
      writeLog(`❌ PARSE FAIL | ${slug} | RAW:${chapter}`);
      return res.json({ ok: true });
    }

    const progress = parsed.progress;

    // ===== LOG CLEAN =====
    cleanOldLogs();

    // ===== DUPLIKÁCIÓ TÖRLÉS =====
    await pool.query(`
      DELETE FROM anilist_queue
      WHERE user_id = $1
        AND processed = false
        AND anilist_id = $2
    `, [userId, anilistId]);

const existing = await pool.query(`
  SELECT progress
  FROM anilist_queue
  WHERE user_id = $1
    AND anilist_id = $2
  ORDER BY created_at DESC
  LIMIT 1
`, [userId, anilistId]);


if (existing.rows.length) {
  const lastProgress = existing.rows[0].progress;

  if (lastProgress === progress) {
    return res.json({ ok: true });
  }

  if (lastProgress > progress) {
    return res.json({ ok: true });
  }
}

    // ===== INSERT =====
    await pool.query(`
      INSERT INTO anilist_queue (user_id, anilist_id, progress)
      VALUES ($1, $2, $3)
    `, [userId, anilistId, progress]);
   // ===== LOG WRITE =====
    writeLog(
      `USER:${user.username} | ${slug} | RAW:${parsed.raw} | CLEAN:${parsed.cleaned} | PROGRESS:${progress}`
    );


    res.json({ ok: true });

  } catch (err) {
    console.error("ANILIST QUEUE ERROR:", err);
    writeLog(`💥 ERROR: ${err.message}`);
    res.status(500).json({ error: "Server error" });
  }
});


/* ================= COMPARE (Padli vs AniList progress) ================= */
router.get("/compare", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const userRes = await pool.query(
      `SELECT anilist_connected, anilist_token FROM users WHERE id = $1`,
      [userId]
    );
    const user = userRes.rows[0];
    if (!user?.anilist_connected || !user?.anilist_token) {
      return res.status(400).json({ error: "not_connected" });
    }
    const token = user.anilist_token;

    const progressRes = await pool.query(`
      SELECT m.anilist_id, m.slug, m.title, m.cover_url, rp.chapter
      FROM reading_progress rp
      JOIN manga m ON m.id = rp.manga_id
      WHERE rp.user_id = $1 AND m.anilist_id IS NOT NULL
    `, [userId]);

    if (!progressRes.rows.length) {
      return res.json({ mismatches: [] });
    }

    // Viewer AniList user ID lekérdezése
    const viewerRes = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: `query { Viewer { id } }` }),
    });
    const viewerJson = await viewerRes.json();
    const anilistUserId = viewerJson?.data?.Viewer?.id;
    if (!anilistUserId) {
      console.error("ANILIST COMPARE — Viewer lekérdezés sikertelen:", viewerJson);
      return res.status(502).json({ error: "anilist_unavailable" });
    }

    // Teljes manga-lista lekérdezése egy hívással (nem mangánként)
    const listRes = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `query ($userId: Int) {
          MediaListCollection(userId: $userId, type: MANGA) {
            lists { entries { mediaId progress } }
          }
        }`,
        variables: { userId: anilistUserId },
      }),
    });
    const listJson = await listRes.json();
    const anilistProgressMap = new Map();
    for (const list of listJson?.data?.MediaListCollection?.lists || []) {
      for (const entry of list.entries || []) {
        anilistProgressMap.set(entry.mediaId, entry.progress);
      }
    }

    const mismatches = [];
    for (const row of progressRes.rows) {
      const parsed = parseChapter(row.chapter);
      if (!parsed) continue;
      const anilistProgress = anilistProgressMap.get(row.anilist_id);
      if (anilistProgress == null) continue; // AniList-en nincs bejegyzés, nincs mit egyeztetni
      if (anilistProgress === parsed.progress) continue; // egyezik

      mismatches.push({
        slug: row.slug,
        title: row.title,
        cover_url: row.cover_url,
        anilist_id: row.anilist_id,
        padliChapter: row.chapter,
        padliProgress: parsed.progress,
        anilistProgress,
      });
    }

    res.json({ mismatches });

  } catch (err) {
    console.error("ANILIST COMPARE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= APPLY SYNC (user döntések alkalmazása) ================= */
router.post("/apply-sync", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const resolutions = Array.isArray(req.body?.resolutions) ? req.body.resolutions : [];

    const applied = [];
    const failed = [];

    for (const item of resolutions) {
      const { slug, anilist_id, resolution, padliProgress, anilistProgress } = item || {};
      if (!slug || !anilist_id || !resolution) {
        failed.push({ slug, reason: "invalid_item" });
        continue;
      }

      if (resolution === "padli") {
        // Padli értéke nyer → push AniList felé, ugyanaz a dedup minta, mint a /queue endpointban
        await pool.query(
          `DELETE FROM anilist_queue WHERE user_id = $1 AND processed = false AND anilist_id = $2`,
          [userId, anilist_id]
        );
        await pool.query(
          `INSERT INTO anilist_queue (user_id, anilist_id, progress) VALUES ($1, $2, $3)`,
          [userId, anilist_id, Math.floor(padliProgress)]
        );
        applied.push({ slug, resolution });
        continue;
      }

      if (resolution === "anilist") {
        // AniList értéke nyer → keresünk egy megfelelő fejezet-mappát a Padli-n
        const mangaRes = await pool.query(`SELECT id FROM manga WHERE slug = $1 LIMIT 1`, [slug]);
        const mangaId = mangaRes.rows[0]?.id;
        if (!mangaId) {
          failed.push({ slug, reason: "manga_not_found" });
          continue;
        }

        const chapterRes = await pool.query(`SELECT folder FROM chapter WHERE manga_id = $1`, [mangaId]);
        const target = Math.floor(anilistProgress);
        let matched = null;
        for (const { folder } of chapterRes.rows) {
          const parsed = parseChapter(folder);
          if (!parsed || parsed.progress !== target) continue;
          // pontos, tört nélküli egyezést preferáljuk (pl. "Ch280" a "Ch280.5" helyett)
          if (!matched || (parsed.float === target && matched.float !== target)) {
            matched = { folder, float: parsed.float };
          }
        }

        if (!matched) {
          failed.push({ slug, reason: "chapter_not_found" });
          continue;
        }

        const prev = await pool.query(
          `SELECT chapter FROM reading_progress WHERE user_id = $1 AND manga_id = $2`,
          [userId, mangaId]
        );
        const prevChapter = prev.rows[0]?.chapter || null;

        await pool.query(
          `INSERT INTO reading_progress (user_id, manga_id, chapter, page)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (user_id, manga_id)
           DO UPDATE SET chapter = EXCLUDED.chapter, page = EXCLUDED.page, updated_at = now()`,
          [userId, mangaId, matched.folder]
        );

        if (prevChapter !== matched.folder) {
          await pool.query(
            `INSERT INTO chapter_reads (user_id, manga_id, chapter) VALUES ($1, $2, $3)`,
            [userId, mangaId, matched.folder]
          ).catch(() => {});
        }

        applied.push({ slug, resolution, chapter: matched.folder });
        continue;
      }

      failed.push({ slug, reason: "invalid_resolution" });
    }

    res.json({ applied, failed });

  } catch (err) {
    console.error("ANILIST APPLY-SYNC ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
