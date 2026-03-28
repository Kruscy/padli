import { pool } from "./db.js";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

/* ================= CONFIG ================= */

const ANILIST_URL = "https://graphql.anilist.co";
const REQUEST_DELAY_MS = 1200;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

/* ================= HELPERS ================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanTitle(title) {
  return title
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[-_]/g, " ")
    .trim();
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
      body: JSON.stringify({
        text: [text],
        target_lang: "HU"
      })
    });

    const data = await res.json();
    return data.translations?.[0]?.text || text;
  } catch (err) {
    console.error("DeepL error:", err.message);
    return text;
  }
}

/* ================= ANILIST QUERY ================= */

const QUERY = `
query ($search: String) {
  Media(search: $search, type: MANGA) {
    id
    title { romaji english native }
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

/* ================= FETCH WITH RETRY ================= */

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

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();

    } catch (err) {
      console.log(`❌ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
}

/* ================= MAIN ================= */

async function scanMetadata() {
  console.log("🧠 Starting AniList metadata scan\n");

  const mangas = await pool.query(`
    SELECT id, title
    FROM manga
    WHERE anilist_failed = FALSE
      AND (
        anilist_id IS NULL
        OR cover_url IS NULL
        OR description IS NULL
        OR status IS NULL
        OR average_score IS NULL
      )
    ORDER BY id
  `);

  const total = mangas.rowCount;
  console.log(`📚 Mangas to process: ${total}\n`);

  let processed = 0;
  let success = 0;
  let failed = 0;

  for (const manga of mangas.rows) {
    processed++;
    const searchTitle = cleanTitle(manga.title);

    console.log(`\n[${processed}/${total}] 🔍 Searching: "${searchTitle}"`);

    try {
      const json = await fetchWithRetry({
        query: QUERY,
        variables: { search: searchTitle }
      });

      const media = json?.data?.Media;

      await pool.query(
        `UPDATE manga SET anilist_last_try = now() WHERE id = $1`,
        [manga.id]
      );

      if (!media) {
        console.log("⚠️ No match found → marking as failed");
        await pool.query(
          `UPDATE manga SET anilist_failed = TRUE WHERE id = $1`,
          [manga.id]
        );
        failed++;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      /* ===== TRANSLATE DESCRIPTION ===== */
      let description = null;
      if (media.description) {
        console.log("🌐 Translating description...");
        description = await translateToHungarian(media.description);
      }

      /* ===== SAVE MAIN DATA ===== */
      await pool.query(
        `UPDATE manga
         SET anilist_id = $1,
             cover_url = COALESCE(cover_url, $2),
             description = COALESCE(description, $3),
             status = COALESCE(status, $4),
             average_score = COALESCE(average_score, $5),
             total_chapters = COALESCE(total_chapters, $6),
             anilist_failed = FALSE
         WHERE id = $7`,
        [
          media.id,
          media.coverImage?.extraLarge || media.coverImage?.large || null,
          description,
          media.status || null,
          media.averageScore || null,
          media.chapters || null,
          manga.id
        ]
      );

      /* ===== SAVE GENRES ===== */
      for (const genreName of media.genres || []) {
        const gRes = await pool.query(
          `INSERT INTO genre (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [genreName]
        );
        await pool.query(
          `INSERT INTO manga_genre (manga_id, genre_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [manga.id, gRes.rows[0].id]
        );
      }

      /* ===== SAVE TAGS ===== */
      for (const tag of media.tags || []) {
        if (tag.isMediaSpoiler) continue;
        const tRes = await pool.query(
          `INSERT INTO tag (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tag.name]
        );
        await pool.query(
          `INSERT INTO manga_tag (manga_id, tag_id, rank) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [manga.id, tRes.rows[0].id, tag.rank]
        );
      }

      /* ===== SAVE RECOMMENDATIONS ===== */
      await pool.query(
        `DELETE FROM recommendation WHERE manga_id = $1`,
        [manga.id]
      );
      for (const node of media.recommendations?.nodes || []) {
        const rec = node.mediaRecommendation;
        if (!rec) continue;
        await pool.query(
          `INSERT INTO recommendation (manga_id, anilist_id, title, cover_url)
           VALUES ($1, $2, $3, $4)`,
          [
            manga.id,
            rec.id,
            rec.title?.english || rec.title?.romaji || null,
            rec.coverImage?.large || null
          ]
        );
      }

      console.log("✅ Metadata saved");
      success++;

    } catch (err) {
      console.log("❌ Permanent failure → marking as failed");
      await pool.query(
        `UPDATE manga
         SET anilist_failed = TRUE,
             anilist_last_try = now()
         WHERE id = $1`,
        [manga.id]
      );
      failed++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\n🎉 Scan finished");
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total processed: ${processed}`);
}

/* ================= RUN ================= */

scanMetadata()
  .catch(err => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
