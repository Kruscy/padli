import express from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { getPresignedUrl, mangaImageToR2Key, objectExists, listFiles, localPathToR2Key } from "../r2.js";

const router = express.Router();
/* ================= HELPERS ================= */

function extractPageNumber(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const match = base.match(/(\d+)(?!.*\d)/);
  return match ? parseInt(match[1], 10) : null;
}

// 18+ korhatár-ellenőrzés: felnőtt tartalmú (Hentai/Ecchi) mangákhoz
function isAdultVerified(birthDate) {
  if (!birthDate) return false; // nincs dátum → fail closed, nem tekintjük felnőttnek
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return false; // értelmezhetetlen dátum → fail closed
  const now = new Date();
  if (b > now) return false; // jövőbeli "születési" dátum → érvénytelen, fail closed
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  if (age > 120) return false; // irreális kor (pl. hibás/placeholder dátum) → fail closed
  return age >= 18;
}

async function isAdultManga(slug) {
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM manga m
      JOIN manga_genre mg ON mg.manga_id = m.id
      JOIN genre g ON g.id = mg.genre_id
      WHERE m.slug = $1 AND g.name IN ('Hentai','Ecchi')
    ) AS is_adult
  `, [slug]);
  return rows[0]?.is_adult || false;
}
/* ================= MANGA LIST ================= */
router.get("/manga", requireLogin, async (_req, res) => {
  try {
const { rows } = await pool.query(`
      SELECT m.title, m.slug, m.cover_url,
        COUNT(c.id)::int AS chapter_count
      FROM manga m
      LEFT JOIN chapter c ON c.manga_id = m.id
      GROUP BY m.id
      ORDER BY m.title
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});
router.get("/manga-list", requireLogin, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        m.slug,
    m.anilist_id,
        COALESCE(ARRAY_AGG(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres,
        COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
      FROM manga m
      LEFT JOIN manga_genre mg ON mg.manga_id = m.id
      LEFT JOIN genre g ON g.id = mg.genre_id
      LEFT JOIN manga_tag mt ON mt.manga_id = m.id
      LEFT JOIN tag t ON t.id = mt.tag_id
      GROUP BY m.id
    `);

    // slug → { genres, tags } map
    const result = {};
    rows.forEach(r => {
      result[r.slug] = {
        genres: r.genres,
        tags: r.tags,
        anilist_id: r.anilist_id
      };
    });

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});
/* ================= MANGA METADATA ================= */
router.get("/manga/:slug", requireLogin, async (req, res) => {
  const { slug } = req.params;

  // Duplikált slug esetén (két manga-bejegyzés ugyanazzal a slug-gal)
  // determinisztikusan a több fejezettel rendelkezőt (a "teljesebb"
  // bejegyzést) részesítjük előnyben, hogy a metaadat ne "villogjon"
  // kérésenként a két duplikátum között.
  const { rows } = await pool.query(
    `SELECT
      m.title, m.slug, m.cover_url, m.description,
      m.status, m.average_score, m.total_chapters,
      m.uploaders, m.anilist_id,
      COALESCE(ARRAY_AGG(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS genres,
      COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags,
      COUNT(DISTINCT c.id) AS chapter_count
     FROM manga m
     LEFT JOIN manga_genre mg ON mg.manga_id = m.id
     LEFT JOIN genre g ON g.id = mg.genre_id
     LEFT JOIN manga_tag mt ON mt.manga_id = m.id
     LEFT JOIN tag t ON t.id = mt.tag_id
     LEFT JOIN chapter c ON c.manga_id = m.id
     WHERE m.slug = $1
     GROUP BY m.id
     ORDER BY chapter_count DESC, m.id ASC`,
    [slug]
  );

  if (!rows.length) return res.status(404).end();
  delete rows[0].chapter_count;
  res.json(rows[0]);
});

/* ================= recommended ================= */
router.get("/manga/:slug/recommendations", requireLogin, async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT r.anilist_id, r.title, r.cover_url, lm.slug AS local_slug
       FROM recommendation r
       JOIN manga m ON m.slug = $1
       LEFT JOIN manga lm ON lm.anilist_id = r.anilist_id
       WHERE r.manga_id = m.id`,
      [slug]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});
/* ================= CHAPTER LIST ================= */

router.get("/chapters/:slug", requireLogin, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.session.user?.id;
    const userRole = req.session.user?.role;

    // ===== SZABAD-E? =====
    let isFree = true;
    try {
      if (userRole === "admin") {
        isFree = false;
      } else {
        const ps = await pool.query(
          `SELECT active FROM patreon_status WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        if (ps.rows.length && ps.rows[0].active === true) {
          isFree = false;
        }
      }
    } catch (patronErr) {
      console.error("Patreon check error:", patronErr);
      // hiba esetén marad isFree = true, de a lista megjelenik
    }

const { rows } = await pool.query(
  `SELECT c.folder, c.title, c.scanned_at, c.unlocks_at
   FROM chapter c
   JOIN manga m ON m.id = c.manga_id
   WHERE m.slug = $1
   ORDER BY
     CAST(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 1) AS INT),
     CAST(COALESCE(NULLIF(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 2), ''), '0') AS INT)`,
  [slug]
);

const now = new Date();
const result = rows.map(ch => {
  const locked = isFree && ch.unlocks_at && new Date(ch.unlocks_at) > now;
  return { ...ch, locked };
});

// ===== 18+ KORHATÁR ELLENŐRZÉS =====
let ageBlocked = false;
if (userRole !== "admin" && await isAdultManga(slug)) {
  const u = await pool.query(`SELECT birth_date FROM users WHERE id = $1`, [userId]);
  ageBlocked = !isAdultVerified(u.rows[0]?.birth_date);
}

res.json({ chapters: result, lockHours: parseInt(process.env.LOCK_HOURS || "24", 10), ageBlocked });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});
/* ================= PAGE LIST ================= */
router.get("/pages/:slug/:chapter", requireLogin, async (req, res) => {
  const { slug, chapter } = req.params;
  const userId = req.session.user?.id;
  const userRole = req.session.user?.role;

  // ===== 18+ KORHATÁR ELLENŐRZÉS =====
  // Ez a valódi biztonsági határ — nem bypass-olható, függetlenül attól,
  // hogy a fejezetlista (/chapters) mit jelzett előre a kliensnek.
  try {
    if (userRole !== "admin" && await isAdultManga(slug)) {
      const u = await pool.query(`SELECT birth_date FROM users WHERE id = $1`, [userId]);
      if (!isAdultVerified(u.rows[0]?.birth_date)) {
        return res.status(403).json({ error: "age_restricted" });
      }
    }
  } catch (ageErr) {
    console.error("Age check error:", ageErr);
    return res.status(403).json({ error: "age_restricted" }); // hiba esetén fail closed
  }

  // ===== ZÁROLÁS ELLENŐRZÉS (Patreon) =====
  try {
    if (userRole !== "admin") {
      const ps = await pool.query(
        `SELECT active FROM patreon_status WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      const isPatron = ps.rows.length && ps.rows[0].active === true;

      if (!isPatron) {

// Duplikált slug esetén (két manga-bejegyzés ugyanazzal a slug-gal)
// előfordulhat, hogy ugyanaz a fejezetnév mindkét oldalon szerepel,
// eltérő unlocks_at-tal. Csak akkor zárjuk, ha MINDEN jelölt még zárt —
// ha bármelyik duplikátum alatt már fel van oldva, ne akadályozzuk.
const chRes = await pool.query(
  `SELECT c.unlocks_at FROM chapter c
   JOIN manga m ON m.id = c.manga_id
   WHERE m.slug = $1 AND c.folder = $2`,
  [slug, chapter]
);

if (chRes.rows.length) {
  const now = new Date();
  const allLocked = chRes.rows.every(r => r.unlocks_at && new Date(r.unlocks_at) > now);
  if (allLocked) {
    return res.status(403).json({ error: "locked" });
  }
}

}
    }
  } catch (lockErr) {
    console.error("Lock check error:", lockErr);
  }

  // Duplikált slug esetén (két manga-bejegyzés ugyanazzal a slug-gal,
  // pl. két külön scan/uploader) LIMIT 1 nélkül lekérjük az ÖSSZES
  // egyező jelöltet, és azt használjuk, amelyiknél ténylegesen van fájl —
  // nem bízzuk a sorrendet a Postgres-re.
  const candidates = await pool.query(
    `
    SELECT
      l.path AS library_path,
      l.name AS library_name,
      m.folder AS manga_folder,
      m.r2_migrated
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = c.library_id
    WHERE m.slug = $1 AND c.folder = $2
    `,
    [slug, chapter]
  );

  if (!candidates.rows.length) {
    return res.status(404).json({ error: "Chapter not found" });
  }

  async function tryLoadFiles({ library_path, manga_folder, r2_migrated }) {
    const dir = path.join(library_path, manga_folder, chapter);
    if (r2_migrated) {
      const prefix = localPathToR2Key(`${library_path}/${manga_folder}/${chapter}/`.replace(/\/+/g, "/"));
      let files = (await listFiles(prefix)).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
      // Fallback: ha R2-n még nincs fent (pl. friss feltöltés scan előtt), lokálisból
      if (files.length === 0 && fs.existsSync(dir)) {
        files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
      }
      return files;
    }
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  }

  try {
    let files = [];
    let chosen = candidates.rows[0];
    for (const candidate of candidates.rows) {
      const found = await tryLoadFiles(candidate);
      if (found.length) {
        files = found;
        chosen = candidate;
        break;
      }
    }
    const { library_name } = chosen;

    const pages = files
      .map(f => ({ f, n: extractPageNumber(f) }))
      .sort((a, b) => {
        if (a.n !== null && b.n !== null) return a.n - b.n;
        if (a.n !== null) return -1;
        if (b.n !== null) return 1;
        return a.f.localeCompare(b.f, undefined, { numeric: true });
      })
      .map(p => p.f);

    if (!pages.length) {
      return res.status(404).json({ error: "Pages not found" });
    }

    // Javított képek verziói — böngésző cache-bust
    const { rows: fixRows } = await pool.query(
      `SELECT image_file, EXTRACT(EPOCH FROM fixed_at)::bigint AS v
       FROM bug_fixes
       WHERE manga_slug = $1 AND chapter = $2 AND is_applied = true`,
      [slug, chapter]
    );
    const fixVersions = {};
    for (const r of fixRows) {
      if (r.image_file) fixVersions[r.image_file] = Number(r.v);
    }

    res.json({ pages, library: library_name, fixVersions });
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: "Pages not found" });
  }
});

/* ================= IMAGE ================= */

router.get("/image/:library/:slug/:chapter/:file", async (req, res) => {
  const { library, slug, chapter, file } = req.params;

  // A library.name szűrés a legtöbb esetben már egyértelművé teszi a
  // sort, de duplikált slug esetén (ha véletlenül ugyanabban a
  // könyvtárban is előfordulna) LIMIT 1 nélkül minden jelöltet
  // megnézünk, és azt választjuk, amelyiknél tényleg létezik a fájl.
  const result = await pool.query(
    `
    SELECT
      l.path AS library_path,
      m.folder AS manga_folder,
      m.r2_migrated
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    JOIN library l ON l.id = c.library_id
    WHERE l.name = $1 AND m.slug = $2 AND c.folder = $3
    `,
    [library, slug, chapter]
  );

  if (!result.rows.length) return res.status(404).end();

  let chosen = result.rows[0];
  if (result.rows.length > 1) {
    for (const candidate of result.rows) {
      const candidatePath = path.join(candidate.library_path, candidate.manga_folder, chapter, file);
      if (candidate.r2_migrated) {
        try {
          const key = mangaImageToR2Key(candidate.library_path, candidate.manga_folder, chapter, file);
          if (await objectExists(key)) { chosen = candidate; break; }
        } catch {}
      }
      if (fs.existsSync(candidatePath)) { chosen = candidate; break; }
    }
  }

  const { library_path, manga_folder, r2_migrated } = chosen;

  // Path traversal védelem
  const baseDir = path.resolve(path.join(library_path, manga_folder, chapter));
  const imgPath = path.resolve(path.join(baseDir, file));
  if (!imgPath.startsWith(baseDir + path.sep) && imgPath !== baseDir) return res.status(403).end();

  const R2_PUBLIC = process.env.R2_PUBLIC_URL;

  function serveLocal() {
    if (!fs.existsSync(imgPath)) return res.status(404).end();
    res.sendFile(imgPath);
  }

  async function proxyR2(r2Key) {
    const url = `${R2_PUBLIC}/${r2Key}`;
    const r2Res = await fetch(url);
    if (!r2Res.ok) {
      // R2-ből nem jön → fallback lokális SSD-re (pl. új feltöltés még nem scannelt)
      serveLocal();
      return;
    }
    res.setHeader("Content-Type", r2Res.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    Readable.fromWeb(r2Res.body).pipe(res);
  }

  // R2-migrated manga: proxy R2-ről, fallback lokálisra ha nincs fent még
  if (r2_migrated) {
    const r2Key = mangaImageToR2Key(library_path, manga_folder, chapter, file);
    return proxyR2(r2Key).catch(() => serveLocal());
  }

  // R2-ről próbál elsőnek — ha ott van, proxy
  try {
    const r2Key = mangaImageToR2Key(library_path, manga_folder, chapter, file);
    if (await objectExists(r2Key)) {
      return proxyR2(r2Key).catch(() => serveLocal());
    }
  } catch (r2Err) {
    console.warn("R2 lookup failed, falling back to local:", r2Err.message);
  }

  // Fallback: lokális fájl
  serveLocal();
});

/* ================= NEXT / PREV ================= */

router.get("/chapter-nav/:slug/:chapter", requireLogin, async (req, res) => {
  const { slug, chapter } = req.params;

  const { rows } = await pool.query(
    `
    SELECT c.folder
    FROM chapter c
    JOIN manga m ON m.id = c.manga_id
    WHERE m.slug = $1
ORDER BY
  CAST(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 1) AS INT),
  CAST(COALESCE(NULLIF(SPLIT_PART(REGEXP_REPLACE(c.folder, '[^0-9\.]', '', 'g'), '.', 2), ''), '0') AS INT)
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


router.get("/featured", requireLogin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT title, slug, cover_url, description
    FROM manga
    WHERE cover_url IS NOT NULL
      AND description IS NOT NULL
  `);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // egyszerű seedelt random
  function seededRandom(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
    }
    return () => {
      h = Math.imul(48271, h) % 0x7fffffff;
      return (h & 0xfffffff) / 0xfffffff;
    };
  }

  const rand = seededRandom(today);

  const shuffled = [...rows].sort(() => rand() - 0.5);

  res.json(shuffled.slice(0, 5));
});

export default router;
