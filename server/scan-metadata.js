import { pool } from "./db.js";
import fetch from "node-fetch";

/* ================= CONFIG ================= */

const ANILIST_URL = "https://graphql.anilist.co";
const REQUEST_DELAY_MS = 700; // rate limit safe

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

/* ================= ANILIST QUERY ================= */

const QUERY = `
query ($search: String) {
  Media(search: $search, type: MANGA) {
    id
    title {
      romaji
      english
      native
    }
    coverImage {
      extraLarge
      large
    }
    genres
    description
  }
}
`;

/* ================= MAIN ================= */

async function scanMetadata() {
  console.log("🧠 Starting AniList metadata scan\n");

  const mangas = await pool.query(`
    SELECT id, title
    FROM manga
    WHERE anilist_id IS NULL
    ORDER BY id
  `);

  console.log(`📚 Mangas to process: ${mangas.rowCount}\n`);

  for (const manga of mangas.rows) {
    const searchTitle = cleanTitle(manga.title);

    console.log(`🔍 Searching AniList for: "${searchTitle}"`);

    let response;
    try {
      response = await fetch(ANILIST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { search: searchTitle }
        })
      });
    } catch (err) {
      console.error("❌ Network error:", err.message);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      console.error(`❌ AniList HTTP error: ${response.status}`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const json = await response.json();
    const media = json?.data?.Media;

    if (!media) {
      console.log("⚠️ No match found\n");
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    /* ================= SAVE MANGA ================= */

    await pool.query(
      `
      UPDATE manga
      SET
        anilist_id = $1,
        cover_url = $2,
        description = $3
      WHERE id = $4
      `,
      [
        media.id,
        media.coverImage?.extraLarge || media.coverImage?.large || null,
        media.description || null,
        manga.id
      ]
    );

    /* ================= SAVE GENRES ================= */

    for (const genreName of media.genres || []) {
      const gRes = await pool.query(
        `
        INSERT INTO genre (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        `,
        [genreName]
      );

      const genreId = gRes.rows[0].id;

      await pool.query(
        `
        INSERT INTO manga_genre (manga_id, genre_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [manga.id, genreId]
      );
    }

    console.log("✅ Metadata saved\n");
    await sleep(REQUEST_DELAY_MS);
  }

  console.log("🎉 AniList metadata scan finished");
}

/* ================= RUN ================= */

scanMetadata()
  .catch(err => {
    console.error("❌ Metadata scan failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
