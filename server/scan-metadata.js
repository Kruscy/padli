import { pool } from "./db.js";
import fetch from "node-fetch";

/* ================= CONFIG ================= */

const ANILIST_URL = "https://graphql.anilist.co";
const REQUEST_DELAY_MS = 1200;       // Biztonságos tempó
const MAX_RETRIES = 3;               // Retry count
const RETRY_DELAY_MS = 2000;         // Retry várakozás

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
    WHERE anilist_id IS NULL
      AND anilist_failed = FALSE
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

    console.log(
      `\n[${processed}/${total}] 🔍 Searching: "${searchTitle}"`
    );

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

      /* ===== SAVE MAIN DATA ===== */

      await pool.query(
        `
        UPDATE manga
        SET
          anilist_id = $1,
          cover_url = $2,
          description = $3,
          anilist_failed = FALSE
        WHERE id = $4
        `,
        [
          media.id,
          media.coverImage?.extraLarge ||
          media.coverImage?.large ||
          null,
          media.description || null,
          manga.id
        ]
      );

      /* ===== SAVE GENRES ===== */

      for (const genreName of media.genres || []) {
        const gRes = await pool.query(
          `
          INSERT INTO genre (name)
          VALUES ($1)
          ON CONFLICT (name)
          DO UPDATE SET name = EXCLUDED.name
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

      console.log("✅ Metadata saved");
      success++;

    } catch (err) {
      console.log("❌ Permanent failure → marking as failed");
      await pool.query(
        `
        UPDATE manga
        SET anilist_failed = TRUE,
            anilist_last_try = now()
        WHERE id = $1
        `,
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
