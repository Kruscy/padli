/**
 * MangaDex API kliens — második fallback (AniList → Jikan → MangaDex), ha
 * mindkét korábbi forrás hibázik. Tisztán manga-adatbázis (nincs anime-
 * keveredés a találatokban), jó rate-limitekkel.
 *
 * FONTOS: a MangaDex ID-k UUID stringek, nem számok (ellentétben az AniList
 * és MAL numerikus ID-ivel) — ezért külön `mangadex_id TEXT` oszlopban
 * tároljuk, nem az `mal_id`/`anilist_id` INTEGER mezőkben.
 *
 * A visszaadott objektum alakja megegyezik az AniList/Jikan normalizált
 * Media típusával, hogy a hívóoldali kód forrás-függetlenül működjön.
 */
import fetch from "node-fetch";

const MANGADEX_URL = "https://api.mangadex.org";
const COVER_BASE = "https://uploads.mangadex.org/covers";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const STATUS_MAP = {
  ongoing: "RELEASING",
  completed: "FINISHED",
  hiatus: "HIATUS",
  cancelled: "CANCELLED",
};

function pickTitle(titleObj, altTitles) {
  if (!titleObj) return null;
  if (titleObj.en) return titleObj.en;
  const altEn = (altTitles || []).map(t => t.en).find(Boolean);
  if (altEn) return altEn;
  const first = Object.values(titleObj)[0];
  return first || null;
}

async function mdFetch(path) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${MANGADEX_URL}${path}`, {
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

/** Pontszám külön hívással (0-10 skála → 0-100, mint AniList/Jikan esetén). Best effort — hiba esetén null. */
async function fetchRating(id) {
  try {
    const json = await mdFetch(`/statistics/manga/${id}`);
    const stat = json?.statistics?.[id];
    const rating = stat?.rating?.bayesian ?? stat?.rating?.average;
    return rating != null ? Math.round(rating * 10) : null;
  } catch {
    return null;
  }
}

function normalize(entry) {
  if (!entry) return null;
  const attr = entry.attributes;
  if (!attr) return null;

  const coverRel = (entry.relationships || []).find(r => r.type === "cover_art");
  const coverFile = coverRel?.attributes?.fileName;
  const coverUrl = coverFile ? `${COVER_BASE}/${entry.id}/${coverFile}` : null;

  const genreNames = (attr.tags || [])
    .filter(t => t.attributes?.group === "genre" || t.attributes?.group === "theme")
    .map(t => t.attributes?.name?.en)
    .filter(Boolean);

  const lastChapter = attr.lastChapter ? parseInt(attr.lastChapter, 10) : null;
  const description = attr.description?.en || Object.values(attr.description || {})[0] || null;

  return {
    id: entry.id, // UUID string!
    title: {
      romaji: pickTitle(attr.title, attr.altTitles),
      english: attr.title?.en || null,
      native: attr.title?.ja || null,
    },
    coverImage: { extraLarge: coverUrl, large: coverUrl },
    genres: [...new Set(genreNames)],
    description,
    status: STATUS_MAP[attr.status] || null,
    averageScore: null, // a hívó tölti fel fetchRating-gel (külön kérés)
    chapters: Number.isFinite(lastChapter) ? lastChapter : null,
    tags: [],
    recommendations: { nodes: [] },
  };
}

/** Cím alapú keresés — több találat (autocomplete dropdown-hoz). */
export async function searchMangaList(title, limit = 5) {
  const json = await mdFetch(
    `/manga?title=${encodeURIComponent(title)}&limit=${limit}&includes[]=cover_art`
  );
  const results = (json?.data || []).map(normalize).filter(Boolean);
  await Promise.all(results.map(async r => { r.averageScore = await fetchRating(r.id); }));
  return results;
}

/** Cím alapú keresés — az első (legjobb) találat. */
export async function searchMangaByTitle(title) {
  const results = await searchMangaList(title, 1);
  return results[0] || null;
}

/** Konkrét MangaDex UUID alapú lekérés. */
export async function getMangaById(mangadexId) {
  const json = await mdFetch(`/manga/${mangadexId}?includes[]=cover_art`);
  const media = normalize(json?.data);
  if (media) media.averageScore = await fetchRating(media.id);
  return media;
}
