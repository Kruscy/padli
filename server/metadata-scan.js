import { pool } from "./db.js";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { autoClaimWishlistForManga } from "./lib/wishlist-auto-claim.js";
import { translateToHungarian } from "./lib/translate.js";
import { fetchMangaMetadata, TransientMetadataError } from "./lib/metadata-source.js";
dotenv.config();

/* ================= CONFIG ================= */

const ANILIST_URL = "https://graphql.anilist.co";
const REQUEST_DELAY_MS = 1200;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

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
    SELECT id, title, anilist_id, mal_id, mangadex_id, uploaders
    FROM manga
    WHERE anilist_failed = FALSE
      AND (
        (anilist_id IS NULL AND mal_id IS NULL AND mangadex_id IS NULL)
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
    const hadNoAnilistId = manga.anilist_id == null;
    const hadNoMalId = manga.mal_id == null;
    const hadNoMangadexId = manga.mangadex_id == null;
    const searchTitle = cleanTitle(manga.title);

    console.log(`\n[${processed}/${total}] 🔍 Searching: "${searchTitle}"`);

    try {
      const result = await fetchMangaMetadata({
        searchTitle,
        anilistId: manga.anilist_id,
        malId: manga.mal_id,
        mangadexId: manga.mangadex_id,
      });

      await pool.query(
        `UPDATE manga SET anilist_last_try = now() WHERE id = $1`,
        [manga.id]
      );

      if (!result) {
        console.log("⚠️ No match found on any source → marking as failed");
        await pool.query(
          `UPDATE manga SET anilist_failed = TRUE WHERE id = $1`,
          [manga.id]
        );
        failed++;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const { source, media } = result;
      console.log(`📡 Forrás: ${source}`);

      /* ===== TRANSLATE DESCRIPTION ===== */
      let description = null;
      if (media.description) {
        console.log("🌐 Translating description...");
        description = await translateToHungarian(media.description);
      }

      /* ===== SAVE MAIN DATA ===== */
      await pool.query(
        `UPDATE manga
         SET anilist_id = COALESCE($1, anilist_id),
             mal_id = COALESCE($2, mal_id),
             mangadex_id = COALESCE($3, mangadex_id),
             metadata_source = $4,
             cover_url = COALESCE(cover_url, $5),
             description = COALESCE(description, $6),
             status = COALESCE(status, $7),
             average_score = COALESCE(average_score, $8),
             total_chapters = COALESCE(total_chapters, $9),
             anilist_failed = FALSE
         WHERE id = $10`,
        [
          source === "anilist" ? media.id : null,
          source === "jikan" ? media.id : null,
          source === "mangadex" ? media.id : null,
          source,
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

      /* ===== KÍVÁNSÁGLISTA AUTO-CLAIM =====
         Csak akkor fut, ha a manga ÉPP MOST kapta meg ELŐSZÖR az adott
         forrás ID-ját — a wishlist-auto-claim mindhárom ID-teret (AniList,
         MAL, MangaDex) tudja már egyeztetni. */
      const gotNewId =
        (source === "anilist" && hadNoAnilistId) ||
        (source === "jikan" && hadNoMalId) ||
        (source === "mangadex" && hadNoMangadexId);
      if (gotNewId && media.id) {
        try {
          const claimResult = await autoClaimWishlistForManga({
            anilist_id: source === "anilist" ? media.id : null,
            mal_id: source === "jikan" ? media.id : null,
            mangadex_id: source === "mangadex" ? media.id : null,
            uploaders: manga.uploaders,
          });
          if (claimResult.claimed.length) {
            console.log(`🍆 Auto-claim: ${claimResult.claimed.length} claim létrehozva a kívánságlistán`);
          }
        } catch (err) {
          console.error("Auto-claim error:", err);
        }
      }

      console.log("✅ Metadata saved");
      success++;

    } catch (err) {
      if (err instanceof TransientMetadataError) {
        // Átmeneti hiba (pl. AniList jelenlegi túlterheltsége) — NEM
        // jelöljük véglegesen sikertelennek, a következő scan újra
        // megpróbálja majd.
        console.log(`⏳ Átmeneti hiba, újrapróbáljuk legközelebb: ${err.message}`);
        await pool.query(
          `UPDATE manga SET anilist_last_try = now() WHERE id = $1`,
          [manga.id]
        );
      } else {
        console.log(`❌ Váratlan hiba mentés közben: ${err.message}`);
        await pool.query(
          `UPDATE manga SET anilist_last_try = now() WHERE id = $1`,
          [manga.id]
        );
      }
      failed++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\n🎉 Scan finished");
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total processed: ${processed}`);
}

/* ================= SINGLE MANGA REFRESH (export) ================= */
 
export async function refreshMetadataForManga(mangaId, anilistId = null) {
  let media = null;
 
  if (anilistId) {
    // Ha van konkrét AniList ID, azzal keresünk – nem kell találgatni cím alapján
    const ID_QUERY = `
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
    const json = await fetchWithRetry({ query: ID_QUERY, variables: { id: anilistId } });
    media = json?.data?.Media;
  } else {
    // Nincs ID → cím alapján keresünk (a fent definiált QUERY változóval)
    const mangaRes = await pool.query(
      `SELECT title FROM manga WHERE id = $1`, [mangaId]
    );
    if (!mangaRes.rowCount) throw new Error(`Manga not found: ${mangaId}`);
    const searchTitle = cleanTitle(mangaRes.rows[0].title);
    const json = await fetchWithRetry({ query: QUERY, variables: { search: searchTitle } });
    media = json?.data?.Media;
  }
 
  await pool.query(`UPDATE manga SET anilist_last_try = now() WHERE id = $1`, [mangaId]);
 
  if (!media) {
    await pool.query(`UPDATE manga SET anilist_failed = TRUE WHERE id = $1`, [mangaId]);
    throw new Error("No AniList match found");
  }
 
  let description = null;
  if (media.description) {
    description = await translateToHungarian(media.description);
  }
 
  // FELÜLÍR mindent – ez szándékos frissítés, nem COALESCE!
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
 
  // Genres: töröl és újraír
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
 
  // Tags: töröl és újraír
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
 
  // Recommendations: töröl és újraír
  await pool.query(`DELETE FROM recommendation WHERE manga_id = $1`, [mangaId]);
  for (const node of media.recommendations?.nodes || []) {
    const rec = node.mediaRecommendation;
    if (!rec) continue;
    await pool.query(
      `INSERT INTO recommendation (manga_id, anilist_id, title, cover_url) VALUES ($1, $2, $3, $4)`,
      [mangaId, rec.id, rec.title?.english || rec.title?.romaji || null, rec.coverImage?.large || null]
    );
  }
 
  return { anilist_id: media.id, title: media.title?.english || media.title?.romaji };
}
/* ================= RUN ================= */
export { scanMetadata };
