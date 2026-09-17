import { pool } from "./db.js";
import dotenv from "dotenv";
import { autoClaimWishlistForManga } from "./lib/wishlist-auto-claim.js";
import { translateToHungarian } from "./lib/translate.js";
import { fetchMangaMetadata } from "./lib/metadata-source.js";
dotenv.config();

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

  const mangaRes = await pool.query(
    `SELECT title, anilist_id, mal_id, mangadex_id, uploaders FROM manga WHERE id = $1`, [mangaId]
  );
  if (!mangaRes.rowCount) throw new Error(`Manga not found: ${mangaId}`);
  const mangaRow = mangaRes.rows[0];

  const searchTitle = mangaRow.title
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[-_]/g, " ")
    .trim();

  /* ── 1. Metaadat lekérés — AniList elsődleges, Jikan majd MangaDex fallback ── */
  const result = await fetchMangaMetadata({
    searchTitle,
    anilistId: anilistId || mangaRow.anilist_id,
    malId: mangaRow.mal_id,
    mangadexId: mangaRow.mangadex_id,
  });

  await pool.query(`UPDATE manga SET anilist_last_try = now() WHERE id = $1`, [mangaId]);

  if (!result) {
    // Mindhárom forrás biztosan nem talált semmit — ez a "no match" eset
    // marad TransientMetadataError esetén NEM jelöljük failed-nek, az a
    // hívóhoz (admin.js) propagál hibaként, hogy tudjon róla.
    await pool.query(`UPDATE manga SET anilist_failed = TRUE WHERE id = $1`, [mangaId]);
    throw new Error("Nincs találat sem AniList-en, sem MyAnimeList-en, sem MangaDex-en");
  }

  const { source, media } = result;
  console.log(`📡 Forrás: ${source}`);

  /* ── 2. Leírás fordítása ── */
  let description = null;
  if (media.description) {
    console.log("🌐 Translating description...");
    description = await translateToHungarian(media.description);
  }

  /* ── 3. Fő adatok mentése – FELÜLÍR, nem COALESCE ──
     Az anilist_id előző állapotát azért nézzük meg mentés előtt,
     hogy tudjuk: most kapta-e meg ELŐSZÖR (NULL → érték) — csak
     ekkor fut le a kívánságlista auto-claim, ne minden refresh-nél. */
  const hadNoAnilistId = mangaRow.anilist_id == null;
  const hadNoMalId = mangaRow.mal_id == null;
  const hadNoMangadexId = mangaRow.mangadex_id == null;
  const prevUploaders = mangaRow.uploaders;

  await pool.query(
    `UPDATE manga
     SET anilist_id     = COALESCE($1, anilist_id),
         mal_id         = COALESCE($2, mal_id),
         mangadex_id    = COALESCE($3, mangadex_id),
         metadata_source = $4,
         cover_url      = $5,
         description    = $6,
         status         = $7,
         average_score  = $8,
         total_chapters = $9,
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
        uploaders: prevUploaders,
      });
      if (claimResult.claimed.length) {
        console.log(`🍆 Auto-claim: ${claimResult.claimed.length} claim létrehozva a kívánságlistán`);
      }
    } catch (err) {
      console.error("Auto-claim error:", err);
    }
  }

  const SOURCE_LABEL = { anilist: "AniList", jikan: "MAL", mangadex: "MangaDex" };
  const resultTitle = media.title?.english || media.title?.romaji;
  console.log(`✅ Metadata saved: "${resultTitle}" (${SOURCE_LABEL[source]} #${media.id})`);

  return {
    anilist_id: source === "anilist" ? media.id : null,
    mal_id: source === "jikan" ? media.id : null,
    mangadex_id: source === "mangadex" ? media.id : null,
    source,
    title: resultTitle,
  };
}
