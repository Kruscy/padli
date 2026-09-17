/**
 * Manga-metaadat lekérés AniList elsődleges forrással, Jikan (MyAnimeList)
 * majd MangaDex fallback-kel, ha a korábbi forrás(ok) hibázik/hibáznak
 * vagy rate-limitel(nek).
 *
 * A visszaadott `media` objektum alakja megegyezik az AniList GraphQL Media
 * típusával, hogy a hívóoldali mentési logika forrás-függetlenül működjön.
 *
 * Fontos: `fetchMangaMetadata` csak akkor ad vissza `null`-t (= végleg nincs
 * találat sehol), ha MINDHÁROM forrás sikeresen válaszolt és egyik sem
 * talált semmit. Ha bármelyik oldal csak hibázott/időtúllépett (nem tudni
 * biztosan, hogy lett volna-e találat), és nincs mindhárom oldalról
 * megerősített "nincs találat", `TransientMetadataError`-t dob — ilyenkor a
 * hívó NEM jelölheti a mangát véglegesen sikertelennek, mert legközelebb
 * még sikerülhet.
 */
import fetch from "node-fetch";
import { searchMangaByTitle, getMangaById as getJikanMangaById } from "./jikan.js";
import { searchMangaByTitle as searchMangaDex, getMangaById as getMangaDexById } from "./mangadex.js";

const ANILIST_URL = "https://graphql.anilist.co";
const ANILIST_MAX_RETRIES = 3;
const ANILIST_RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MEDIA_FIELDS = `
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
`;

const QUERY_BY_SEARCH = `query ($search: String) { Media(search: $search, type: MANGA) { ${MEDIA_FIELDS} } }`;
const QUERY_BY_ID = `query ($id: Int) { Media(id: $id, type: MANGA) { ${MEDIA_FIELDS} } }`;

async function aniListFetchWithRetry(body) {
  for (let attempt = 1; attempt <= ANILIST_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        console.log("⚠️ AniList rate limited – waiting...");
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return await res.json();
    } catch (err) {
      console.log(`❌ AniList attempt ${attempt} failed: ${err.message}`);
      if (attempt < ANILIST_MAX_RETRIES) await sleep(ANILIST_RETRY_DELAY_MS);
      else throw err;
    }
  }
}

async function fetchAniList({ searchTitle, anilistId }) {
  const body = anilistId
    ? { query: QUERY_BY_ID, variables: { id: anilistId } }
    : { query: QUERY_BY_SEARCH, variables: { search: searchTitle } };
  const json = await aniListFetchWithRetry(body);
  return json?.data?.Media || null;
}

export class TransientMetadataError extends Error {}

/**
 * @param {object} opts
 * @param {string} opts.searchTitle - cím alapú kereséshez (mindig kell, fallback esetén is)
 * @param {number|null} [opts.anilistId] - ha ismert, ID alapján kérjük az AniList-et
 * @param {number|null} [opts.malId] - ha ismert (korábbi Jikan találatból), ID alapján kérjük a Jikan-t
 * @param {string|null} [opts.mangadexId] - ha ismert (korábbi MangaDex találatból), ID alapján kérjük a MangaDex-et
 * @returns {Promise<{source: "anilist"|"jikan"|"mangadex", media: object}|null>}
 */
export async function fetchMangaMetadata({ searchTitle, anilistId = null, malId = null, mangadexId = null }) {
  let confirmedNoMatchCount = 0;

  let aniListMedia = null;
  try {
    aniListMedia = await fetchAniList({ searchTitle, anilistId });
    if (!aniListMedia) confirmedNoMatchCount++;
  } catch {
    // átmeneti hiba — nem tudjuk, lett volna-e találat
  }
  if (aniListMedia) return { source: "anilist", media: aniListMedia };

  console.log("↪️ AniList nem adott találatot/hibázott — Jikan (MAL) próbálkozás...");
  let jikanMedia = null;
  try {
    jikanMedia = malId ? await getJikanMangaById(malId) : await searchMangaByTitle(searchTitle);
    if (!jikanMedia) confirmedNoMatchCount++;
  } catch {
    // átmeneti hiba a Jikan oldalán is
  }
  if (jikanMedia) return { source: "jikan", media: jikanMedia };

  console.log("↪️ Jikan is nem adott találatot/hibázott — MangaDex próbálkozás...");
  let mangadexMedia = null;
  try {
    mangadexMedia = mangadexId ? await getMangaDexById(mangadexId) : await searchMangaDex(searchTitle);
    if (!mangadexMedia) confirmedNoMatchCount++;
  } catch {
    // átmeneti hiba a MangaDex oldalán is
  }
  if (mangadexMedia) return { source: "mangadex", media: mangadexMedia };

  if (confirmedNoMatchCount === 3) {
    return null; // mindhárom forrás biztosan nem talált semmit
  }

  throw new TransientMetadataError("AniList, Jikan és MangaDex is átmenetileg elérhetetlen / hibázott");
}
