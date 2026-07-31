import express from "express";
import multer from "multer";
import crypto from "crypto";
import { ZipArchive } from "archiver";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { r2, BUCKET } from "../r2.js";
import { validateGeminiKey, invalidateKeyCache } from "../lib/gemini-client.js";

const router = express.Router();

const SUBTITLE_EXTS = new Set([".srt", ".ass"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB bőven elég egy feliratfájlnak
});

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueSlug(title) {
  const base = slugify(title) || "anime";
  let slug = base;
  let n = 2;
  while (true) {
    const { rows } = await pool.query(`SELECT 1 FROM anime WHERE slug = $1`, [slug]);
    if (!rows.length) return slug;
    slug = `${base}-${n++}`;
  }
}

// Külső szerver (pl. a felirat-feltöltő script) egy állandó API kulccsal
// azonosítja magát — nincs session/bejelentkezés, ugyanaz a minta, mint a
// gemini-proxy route-nál.
function hasValidApiKey(req) {
  const auth = req.headers["authorization"] || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = process.env.ANIME_UPLOAD_API_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ── Feltöltési jogosultság — API kulcs VAGY a manga-feltöltéssel megegyező session-jogosultság ── */
async function requireUploader(req, res, next) {
  if (hasValidApiKey(req)) return next();

  if (!req.session?.user) return res.status(401).json({ error: "Bejelentkezés szükséges" });
  try {
    const { rows } = await pool.query(
      `SELECT ps.tier, u.can_upload, u.role
       FROM users u
       LEFT JOIN patreon_status ps ON ps.user_id = u.id
       WHERE u.id = $1 LIMIT 1`,
      [req.session.user.id]
    );
    const { tier, can_upload, role } = rows[0] || {};
    if (role !== "admin" && tier !== "Admin" && tier !== "Uploader" && !can_upload) {
      return res.status(403).json({ error: "Nincs feltöltési jogosultság" });
    }
    next();
  } catch { return res.status(500).json({ error: "Auth hiba" }); }
}

function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Csak adminoknak" });
  }
  next();
}

/* ── Személyes, userhez kötött API kulcs (letöltéshez) ─────
   Külön a megosztott ANIME_UPLOAD_API_SECRET-től: ez egy adott userhez
   köthető, admin bármikor egyedileg visszavonhatja/újragenerálhatja.
   Csak a hash-t tároljuk (SHA-256), a nyers kulcsot csak generáláskor,
   egyszer adjuk vissza. ── */
function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

async function getUserByApiKey(req) {
  const auth = req.headers["authorization"] || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided) return null;
  const { rows } = await pool.query(
    `SELECT id, username FROM users WHERE anime_api_key_hash = $1`,
    [hashApiKey(provided)]
  );
  return rows[0] || null;
}

/* ── Olvasás/letöltés — megosztott API kulcs VAGY személyes userkulcs
   VAGY bejelentkezett user (a külső feltöltő szkript emiatt tud
   duplikáció nélkül rákeresni egy animére feltöltés előtt, a személyes
   kulcsos user pedig session nélkül tud böngészni/letölteni) ── */
async function requireLoginOrApiKey(req, res, next) {
  if (hasValidApiKey(req)) return next();
  if (req.session?.user) return next();

  const apiUser = await getUserByApiKey(req);
  if (apiUser) {
    req.apiKeyUser = apiUser;
    return next();
  }

  return res.status(401).json({ error: "Bejelentkezés szükséges" });
}

function episodeR2Key(animeSlug, seasonNumber, episodeNumber, ext) {
  return `anime-subtitles/${animeSlug}/season-${seasonNumber}/episode-${episodeNumber}${ext}`;
}

/* ================= PUBLIKUS LISTA ================= */
router.get("/anime", requireLoginOrApiKey, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.title, a.slug, a.cover_url,
        COUNT(e.id)::int AS episode_count
      FROM anime a
      LEFT JOIN anime_season s ON s.anime_id = a.id
      LEFT JOIN anime_episode e ON e.season_id = s.id
      GROUP BY a.id
      ORDER BY a.title
    `);
    res.json(rows);
  } catch (err) {
    console.error("ANIME LIST ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= PUBLIKUS RÉSZLET (évadok + részek) ================= */
router.get("/anime/:slug", requireLoginOrApiKey, async (req, res) => {
  try {
    const { rows: animeRows } = await pool.query(
      `SELECT id, title, slug, cover_url, anilist_id FROM anime WHERE slug = $1`,
      [req.params.slug]
    );
    if (!animeRows.length) return res.status(404).json({ error: "Nincs ilyen anime" });
    const anime = animeRows[0];

    const { rows: seasonRows } = await pool.query(
      `SELECT id, season_number FROM anime_season WHERE anime_id = $1 ORDER BY season_number`,
      [anime.id]
    );
    const { rows: episodeRows } = await pool.query(
      `SELECT id, season_id, episode_number, file_ext FROM anime_episode
       WHERE season_id = ANY($1::int[]) ORDER BY episode_number`,
      [seasonRows.map(s => s.id)]
    );

    anime.seasons = seasonRows.map(s => ({
      ...s,
      episodes: episodeRows.filter(e => e.season_id === s.id),
    }));

    res.json(anime);
  } catch (err) {
    console.error("ANIME DETAIL ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= EGY RÉSZ LETÖLTÉSE ================= */
router.get("/anime/episode/:id/download", requireLoginOrApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.r2_key, e.file_ext, e.episode_number, s.season_number, a.title
       FROM anime_episode e
       JOIN anime_season s ON s.id = e.season_id
       JOIN anime a ON a.id = s.anime_id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Nincs ilyen rész" });
    const ep = rows[0];

    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: ep.r2_key }));
    const buffer = Buffer.from(await obj.Body.transformToByteArray());

    const filename = `${slugify(ep.title)}-S${ep.season_number}E${ep.episode_number}${ep.file_ext}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(buffer);
  } catch (err) {
    console.error("ANIME EPISODE DOWNLOAD ERROR:", err);
    res.status(404).json({ error: "A fájl nem található" });
  }
});

/* ================= EGÉSZ ÉVAD LETÖLTÉSE (ZIP) ================= */
router.get("/anime/season/:id/download-all", requireLoginOrApiKey, async (req, res) => {
  try {
    const { rows: seasonRows } = await pool.query(
      `SELECT s.id, s.season_number, a.title
       FROM anime_season s JOIN anime a ON a.id = s.anime_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!seasonRows.length) return res.status(404).json({ error: "Nincs ilyen évad" });
    const season = seasonRows[0];

    const { rows: episodes } = await pool.query(
      `SELECT r2_key, file_ext, episode_number FROM anime_episode WHERE season_id = $1 ORDER BY episode_number`,
      [season.id]
    );
    if (!episodes.length) return res.status(404).json({ error: "Nincs feltöltött rész ehhez az évadhoz" });

    const zipName = `${slugify(season.title)}-S${season.season_number}.zip`;
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    res.setHeader("Content-Type", "application/zip");

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", err => { console.error("ZIP ERROR:", err); res.end(); });
    archive.pipe(res);

    for (const ep of episodes) {
      const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: ep.r2_key }));
      const buffer = Buffer.from(await obj.Body.transformToByteArray());
      archive.append(buffer, { name: `E${ep.episode_number}${ep.file_ext}` });
    }

    await archive.finalize();
  } catch (err) {
    console.error("ANIME SEASON ZIP ERROR:", err);
    if (!res.headersSent) res.status(500).json({ error: "Szerver hiba" });
  }
});

// Ha a hívó nem adott anilist_id-t / cover_url-t, magunk keressük meg
// AniList-en cím alapján — a külső feltöltő szkriptek gyakran nem küldik
// ezeket, korábban emiatt maradt kép nélkül több anime a katalógusban.
async function fetchAniListInfo(title) {
  try {
    const query = `
      query ($search: String) {
        Page(perPage: 1) {
          media(search: $search, type: ANIME) {
            id
            coverImage { large }
          }
        }
      }
    `;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { search: title } }),
    });
    const json = await res.json();
    const media = json.data?.Page?.media?.[0];
    if (!media) return { anilist_id: null, cover_url: null };
    return { anilist_id: media.id, cover_url: media.coverImage?.large || null };
  } catch (err) {
    console.error("ANILIST AUTO-FETCH ERROR:", err);
    return { anilist_id: null, cover_url: null };
  }
}

/* ================= ADMIN: ANIME LÉTREHOZÁSA ================= */
router.post("/admin/anime", requireUploader, express.json(), async (req, res) => {
  try {
    const { title, cover_url, anilist_id } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: "Hiányzó cím" });

    // Ne hozzunk létre duplikátumot, ha már van ilyen anime (anilist_id vagy
    // pontos cím egyezés alapján) — a hívó a meglévő rekordot kapja vissza.
    const { rows: existingRows } = await pool.query(
      `SELECT id, title, slug, cover_url FROM anime
       WHERE ($1::int IS NOT NULL AND anilist_id = $1) OR lower(title) = lower($2)
       LIMIT 1`,
      [anilist_id || null, title.trim()]
    );
    if (existingRows.length) return res.json(existingRows[0]);

    let finalAnilistId = anilist_id || null;
    let finalCoverUrl = cover_url || null;
    if (!finalAnilistId || !finalCoverUrl) {
      const fetched = await fetchAniListInfo(title.trim());
      finalAnilistId = finalAnilistId || fetched.anilist_id;
      finalCoverUrl = finalCoverUrl || fetched.cover_url;
    }

    const slug = await uniqueSlug(title.trim());
    const { rows } = await pool.query(
      `INSERT INTO anime (title, slug, cover_url, anilist_id) VALUES ($1,$2,$3,$4) RETURNING id, title, slug, cover_url`,
      [title.trim(), slug, finalCoverUrl, finalAnilistId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("ANIME CREATE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= ADMIN: ÉVAD LÉTREHOZÁSA ================= */
router.post("/admin/anime/:id/season", requireUploader, express.json(), async (req, res) => {
  try {
    const seasonNumber = parseInt(req.body.season_number, 10);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
      return res.status(400).json({ error: "Érvénytelen évadszám" });
    }
    const { rows } = await pool.query(
      `INSERT INTO anime_season (anime_id, season_number) VALUES ($1,$2)
       ON CONFLICT (anime_id, season_number) DO UPDATE SET season_number = EXCLUDED.season_number
       RETURNING id, season_number`,
      [req.params.id, seasonNumber]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("ANIME SEASON CREATE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= ADMIN: RÉSZ (FELIRAT) FELTÖLTÉSE ================= */
router.post("/admin/anime/season/:id/episode", requireUploader, upload.single("file"), async (req, res) => {
  try {
    const episodeNumber = parseInt(req.body.episode_number, 10);
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) {
      return res.status(400).json({ error: "Érvénytelen részszám" });
    }
    if (!req.file) return res.status(400).json({ error: "Hiányzó fájl" });

    const origName = req.file.originalname || "";
    const ext = "." + origName.split(".").pop().toLowerCase();
    if (!SUBTITLE_EXTS.has(ext)) {
      return res.status(400).json({ error: "Csak .srt vagy .ass fájl tölthető fel" });
    }

    const { rows: seasonRows } = await pool.query(
      `SELECT s.season_number, a.slug FROM anime_season s JOIN anime a ON a.id = s.anime_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!seasonRows.length) return res.status(404).json({ error: "Nincs ilyen évad" });
    const { season_number, slug } = seasonRows[0];

    const r2Key = episodeR2Key(slug, season_number, episodeNumber, ext);
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: r2Key,
      Body: req.file.buffer,
      ContentType: "text/plain; charset=utf-8",
    }));

    const { rows } = await pool.query(
      `INSERT INTO anime_episode (season_id, episode_number, file_ext, r2_key, uploaded_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (season_id, episode_number)
       DO UPDATE SET file_ext = EXCLUDED.file_ext, r2_key = EXCLUDED.r2_key,
                     uploaded_by = EXCLUDED.uploaded_by, uploaded_at = NOW()
       RETURNING id, episode_number, file_ext`,
      [req.params.id, episodeNumber, ext, r2Key, req.session?.user?.id || null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("ANIME EPISODE UPLOAD ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── R2-ből is töröljük a felirat-fájlokat, ne maradjon árva tárhely ── */
async function deleteR2Keys(keys) {
  for (const key of keys) {
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      console.error("R2 DELETE ERROR:", key, err.message);
    }
  }
}

/* ================= ADMIN: SZERKESZTÉS ================= */
router.put("/admin/anime/:id", requireAdmin, express.json(), async (req, res) => {
  try {
    const { title, cover_url, anilist_id } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: "Hiányzó cím" });
    const { rows } = await pool.query(
      `UPDATE anime SET title = $1, cover_url = $2, anilist_id = $3 WHERE id = $4
       RETURNING id, title, slug, cover_url, anilist_id`,
      [title.trim(), cover_url || null, anilist_id || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Nincs ilyen anime" });
    res.json(rows[0]);
  } catch (err) {
    console.error("ANIME UPDATE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= ADMIN: TÖRLÉSEK ================= */
router.delete("/admin/anime/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.r2_key FROM anime_episode e
       JOIN anime_season s ON s.id = e.season_id
       WHERE s.anime_id = $1`,
      [req.params.id]
    );
    await deleteR2Keys(rows.map(r => r.r2_key));
    await pool.query(`DELETE FROM anime WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("ANIME DELETE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.delete("/admin/anime/season/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r2_key FROM anime_episode WHERE season_id = $1`,
      [req.params.id]
    );
    await deleteR2Keys(rows.map(r => r.r2_key));
    await pool.query(`DELETE FROM anime_season WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("ANIME SEASON DELETE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.delete("/admin/anime/episode/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r2_key FROM anime_episode WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length) await deleteR2Keys([rows[0].r2_key]);
    await pool.query(`DELETE FROM anime_episode WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("ANIME EPISODE DELETE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= ADMIN: SZEMÉLYES LETÖLTŐ API KULCS ================= */
// Egy adott usernek generál/von vissza egy személyes Bearer-kulcsot, amivel
// (session nélkül) elérheti a felirat lista/részlet/letöltés végpontokat.
// Külön a megosztott ANIME_UPLOAD_API_SECRET-től — egyedileg visszavonható.
router.post("/admin/anime/api-key", requireAdmin, express.json(), async (req, res) => {
  try {
    const username = (req.body?.username || "").trim();
    if (!username) return res.status(400).json({ error: "Hiányzó felhasználónév" });

    const rawKey = crypto.randomBytes(32).toString("hex");
    const { rows } = await pool.query(
      `UPDATE users SET anime_api_key_hash = $1 WHERE username = $2 RETURNING id, username`,
      [hashApiKey(rawKey), username]
    );
    if (!rows.length) return res.status(404).json({ error: "Nincs ilyen felhasználó" });

    res.json({ username: rows[0].username, apiKey: rawKey });
  } catch (err) {
    console.error("ANIME API KEY GENERATE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.delete("/admin/anime/api-key/:username", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET anime_api_key_hash = NULL WHERE username = $1 RETURNING id`,
      [req.params.username]
    );
    if (!rows.length) return res.status(404).json({ error: "Nincs ilyen felhasználó" });
    res.json({ ok: true });
  } catch (err) {
    console.error("ANIME API KEY REVOKE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= GEMINI KULCS FELAJÁNLÁS (felirat-fordítás cserébe) ================= */

async function hasContributedKey(userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM gemini_keys WHERE contributed_by = $1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

router.get("/user/gemini-key-status", requireLogin, async (req, res) => {
  try {
    const contributed = await hasContributedKey(req.session.user.id);
    res.json({ contributed });
  } catch (err) {
    console.error("GEMINI KEY STATUS ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.post("/user/gemini-key", requireLogin, express.json(), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const apiKey = (req.body?.apiKey || "").trim();
    if (!apiKey) return res.status(400).json({ error: "Hiányzó API kulcs" });

    if (await hasContributedKey(userId)) {
      return res.status(400).json({ error: "Már adtál hozzá kulcsot ezzel a fiókkal" });
    }

    const check = await validateGeminiKey(apiKey);
    if (!check.valid) return res.status(400).json({ error: check.message });

    // Ha ez a kulcs már szerepel a poolban (pl. admin kézzel vette fel, mert a user
    // Discordon küldte el), ne duplikáljuk — csak kössük hozzá a fiókjához.
    const existing = await pool.query(
      `SELECT id FROM gemini_keys WHERE api_key = $1 AND contributed_by IS NULL LIMIT 1`,
      [apiKey]
    );
    if (existing.rows.length) {
      await pool.query(
        `UPDATE gemini_keys SET contributed_by = $1, label = $2 WHERE id = $3`,
        [userId, `Contributed-${req.session.user.username}`, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO gemini_keys (label, api_key, contributed_by) VALUES ($1,$2,$3)`,
        [`Contributed-${req.session.user.username}`, apiKey, userId]
      );
    }
    invalidateKeyCache();
    res.json({ ok: true });
  } catch (err) {
    console.error("GEMINI KEY CONTRIBUTE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= FELIRAT-FORDÍTÁS KÉRÉSE ================= */

router.post("/subtitle-request", requireLogin, express.json(), async (req, res) => {
  try {
    const userId = req.session.user.id;
    if (!(await hasContributedKey(userId))) {
      return res.status(403).json({ error: "Előbb adj hozzá egy Gemini API kulcsot" });
    }

    const { anilist_id, anime_title, cover_url, season_number, episode_number } = req.body || {};
    if (!anime_title || !anime_title.trim()) return res.status(400).json({ error: "Hiányzó cím" });
    const seasonNumber = parseInt(season_number, 10);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
      return res.status(400).json({ error: "Érvénytelen évadszám" });
    }
    let episodeNumber = null;
    if (episode_number !== undefined && episode_number !== null && episode_number !== "") {
      episodeNumber = parseInt(episode_number, 10);
      if (!Number.isInteger(episodeNumber) || episodeNumber < 1) {
        return res.status(400).json({ error: "Érvénytelen részszám" });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO subtitle_translation_requests
         (user_id, anilist_id, anime_title, cover_url, season_number, episode_number)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [userId, anilist_id || null, anime_title.trim(), cover_url || null, seasonNumber, episodeNumber]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error("SUBTITLE REQUEST ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ================= ADMIN: FELIRAT-KÉRÉSEK KEZELÉSE ================= */

router.get("/admin/subtitle-requests", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.anilist_id, r.anime_title, r.cover_url, r.season_number,
             r.episode_number, r.status, r.created_at, u.username
      FROM subtitle_translation_requests r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("SUBTITLE REQUESTS LIST ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.post("/admin/subtitle-requests/:id/status", requireAdmin, express.json(), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["done", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Érvénytelen státusz" });
    }
    await pool.query(
      `UPDATE subtitle_translation_requests SET status = $1 WHERE id = $2`,
      [status, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("SUBTITLE REQUEST STATUS ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

export default router;
