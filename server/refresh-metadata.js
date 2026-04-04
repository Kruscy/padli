import { pool } from "./db.js";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

/* ================= CONFIG ================= */

const ANILIST_URL = "https://graphql.anilist.co";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

/* ================= HELPERS ================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateToHungarian(text) {
  if (!text || !DEEPL_API_KEY) return text;
  try {
    const res = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: [text], target_lang: "HU" })
    });
    const data = await res.json();
    return data.translations?.[0]?.text || text;
  } catch (err) {
    console.error("DeepL error:", err.message);
    return text;
  }
}

async function fetchWithRetry(body) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (res.status === 429) {
        console.log("⚠️ Rate limited – waiting...");
        await sleep(5000);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return await res.json();

    } catch (err) {
      console.log(`❌ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
      else throw err;
    }
  }
}

/* ================= ANILIST QUERIES ================= */

// ID alapú lekérés – ha a user kiválasztott egy konkrét művet
const QUERY_BY_ID = `
  query ($id: Int) {
    Media(id: $id, type: MANGA) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      genres
      description
      status
      averageScore
      chapters
      tags { name rank isMediaSpoiler }
      recommendations(perPage: 10) {
        nodes {
          mediaRecommendation {
            id
            title { english romaji }
            coverImage { large }
          }
        }
      }
    }
  }
`;

// Cím alapú lekérés – ha nincs konkrét ID
const QUERY_BY_TITLE = `
  query ($search: String) {
    Media(search: $search, type: MANGA) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      genres
      description
      status
      averageScore
      chapters
      tags { name rank isMediaSpoiler }
      recommendations(perPage: 10) {
        nodes {
          mediaRecommendation {
            id
            title { english romaji }
            coverImage { large }
          }
        }
      }
    }
  }
`;

/* ================= FŐ FÜGGVÉNY ================= */

/**
 * Frissíti egy manga összes AniList metaadatát.
 *
 * @param {number} mangaId  - A manga belső DB id-ja
 * @param {number|null} anilistId - Ha a user kiválasztott egy konkrét AniList művet,
 *                                  ezt küldi a frontend. Ha null, cím alapján keresünk.
 * @returns {{ anilist_id: number, title: string }}
 */
export async function refreshMetadataForManga(mangaId, anilistId = null) {
  console.log(`🔄 Metadata refresh – manga #${mangaId}, anilistId: ${anilistId ?? "auto"}`);

  /* ── 1. AniList lekérés ── */
  let media = null;

  if (anilistId) {
    const json = await fetchWithRetry({ query: QUERY_BY_ID, variables: { id: anilistId } });
    media = json?.data?.Media;
  } else {
    const mangaRes = await pool.query(
      `SELECT title FROM manga WHERE id = $1`, [mangaId]
    );
    if (!mangaRes.rowCount) throw new Error(`Manga not found: ${mangaId}`);

    const searchTitle = mangaRes.rows[0].title
      .replace(/\(.*?\)/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/[-_]/g, " ")
      .trim();

    const json = await fetchWithRetry({ query: QUERY_BY_TITLE, variables: { search: searchTitle } });
    media = json?.data?.Media;
  }

  await pool.query(`UPDATE manga SET anilist_last_try = now() WHERE id = $1`, [mangaId]);

  if (!media) {
    await pool.query(`UPDATE manga SET anilist_failed = TRUE WHERE id = $1`, [mangaId]);
    throw new Error("No AniList match found");
  }

  /* ── 2. Leírás fordítása ── */
  let description = null;
  if (media.description) {
    console.log("🌐 Translating description...");
    description = await translateToHungarian(media.description);
  }

  /* ── 3. Fő adatok mentése – FELÜLÍR, nem COALESCE ── */
  await pool.query(
    `UPDATE manga
     SET anilist_id     = $1,
         cover_url      = $2,
         description    = $3,
         status         = $4,
         average_score  = $5,
         total_chapters = $6,
         anilist_failed = FALSE
     WHERE id = $7`,
    [
      media.id,
      media.coverImage?.extraLarge || media.coverImage?.large || null,
      description,
      media.status || null,
      media.averageScore || null,
      media.chapters || null,
      mangaId
    ]
  );

  /* ── 4. Genres: töröl és újraír ── */
  await pool.query(`DELETE FROM manga_genre WHERE manga_id = $1`, [mangaId]);
  for (const genreName of media.genres || []) {
    const gRes = await pool.query(
      `INSERT INTO genre (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [genreName]
    );
    await pool.query(
      `INSERT INTO manga_genre (manga_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [mangaId, gRes.rows[0].id]
    );
  }

  /* ── 5. Tags: töröl és újraír ── */
  await pool.query(`DELETE FROM manga_tag WHERE manga_id = $1`, [mangaId]);
  for (const tag of media.tags || []) {
    if (tag.isMediaSpoiler) continue;
    const tRes = await pool.query(
      `INSERT INTO tag (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [tag.name]
    );
    await pool.query(
      `INSERT INTO manga_tag (manga_id, tag_id, rank) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [mangaId, tRes.rows[0].id, tag.rank]
    );
  }

  /* ── 6. Recommendations: töröl és újraír ── */
  await pool.query(`DELETE FROM recommendation WHERE manga_id = $1`, [mangaId]);
  for (const node of media.recommendations?.nodes || []) {
    const rec = node.mediaRecommendation;
    if (!rec) continue;
    await pool.query(
      `INSERT INTO recommendation (manga_id, anilist_id, title, cover_url) VALUES ($1, $2, $3, $4)`,
      [mangaId, rec.id, rec.title?.english || rec.title?.romaji || null, rec.coverImage?.large || null]
    );
  }

  const resultTitle = media.title?.english || media.title?.romaji;
  console.log(`✅ Metadata saved: "${resultTitle}" (AniList #${media.id})`);

  return { anilist_id: media.id, title: resultTitle };
}
