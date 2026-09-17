/**
 * Jikan (MyAnimeList) API kliens — fallback metaadat-forrás, ha az AniList
 * nem elérhető vagy rate-limitel. A visszaadott objektum szándékosan az
 * AniList GraphQL Media típusával megegyező alakú (title/coverImage/genres/
 * description/status/averageScore/chapters/tags/recommendations), hogy a
 * metadata-scan.js hívóoldali kódja forrás-függetlenül tudja kezelni.
 */
import fetch from "node-fetch";

const JIKAN_URL = "https://api.jikan.moe/v4";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Jikan publikációs státusz → a saját sémánkban használt enum
const STATUS_MAP = {
  "Publishing": "RELEASING",
  "Finished": "FINISHED",
  "On Hiatus": "HIATUS",
  "Discontinued": "CANCELLED",
  "Not yet published": "NOT_YET_RELEASED",
};

function normalize(entry) {
  if (!entry) return null;

  const genreNames = [
    ...(entry.genres || []),
    ...(entry.themes || []),
    ...(entry.demographics || []),
  ].map(g => g.name).filter(Boolean);

  return {
    id: entry.mal_id,
    title: {
      romaji: entry.title || null,
      english: entry.title_english || null,
      native: entry.title_japanese || null,
    },
    coverImage: {
      extraLarge: entry.images?.jpg?.large_image_url || null,
      large: entry.images?.jpg?.image_url || null,
    },
    genres: [...new Set(genreNames)],
    description: entry.synopsis || null,
    status: STATUS_MAP[entry.status] || null,
    averageScore: entry.score != null ? Math.round(entry.score * 10) : null, // 0-10 → 0-100
    chapters: entry.chapters || null,
    tags: [], // Jikan nem ad rangsorolt tag-eket, ezt nem pótoljuk
    recommendations: { nodes: [] }, // külön API hívás kellene, fallbacknél nem éri meg
  };
}

async function jikanFetch(path) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${JIKAN_URL}${path}`, {
        headers: { "Accept": "application/json" },
      });

      if (res.status === 429) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return await res.json();
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
  return null;
}

/** Cím alapú keresés — az első (legjobb) találatot adja vissza. */
export async function searchMangaByTitle(title) {
  const json = await jikanFetch(`/manga?q=${encodeURIComponent(title)}&limit=1`);
  const entry = json?.data?.[0];
  return normalize(entry);
}

/** Cím alapú keresés — több találatot ad vissza (pl. autocomplete dropdown-hoz). */
export async function searchMangaList(title, limit = 5) {
  const json = await jikanFetch(`/manga?q=${encodeURIComponent(title)}&limit=${limit}`);
  return (json?.data || []).map(normalize);
}

/** Konkrét MAL ID alapú lekérés. */
export async function getMangaById(malId) {
  const json = await jikanFetch(`/manga/${malId}`);
  return normalize(json?.data);
}
