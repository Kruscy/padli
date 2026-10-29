/**
 * MangaUpdates API kliens — harmadik fallback (AniList → Jikan → MangaDex →
 * MangaUpdates). Ingyenes, kulcs nélküli; a kevésbé ismert manhwák is
 * gyakran szerepelnek benne, és sok alternatív címet ad ("associated").
 *
 * A keresés csak PONTOS (normalizált) címegyezést fogad el — a találati lista
 * egyébként hasonló nevű, de más műveket is visszaad.
 *
 * A visszaadott objektum alakja megegyezik az AniList/Jikan/MangaDex
 * normalizált Media típusával, plusz `altTitles` (a mű összes ismert neve).
 */
import fetch from "node-fetch";

const MU_URL = "https://api.mangaupdates.com/v1";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
// Regények, doujinshik nem a mi műveink
const SKIP_TYPES = new Set(["Novel", "Doujinshi", "Artbook"]);
// Az oldal a 18+ tartalmat a Hentai/Ecchi műfajból ismeri fel (lib/age.js)
const ADULT_GENRES = new Set(["Adult", "Smut", "Hentai"]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Ugyanaz, mint a manga-duplicates.js normalizeTitle-je (körkörös import nélkül)
function normalizeTitle(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function muFetch(path, body = null) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${MU_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: { "Accept": "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        timeout: 10000,
      });
      if (res.status === 429) {
        await sleep(RETRY_DELAY_MS * 2);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
      else throw err;
    }
  }
  return null;
}

function mapStatus(s) {
  if (s.completed) return "FINISHED";
  const txt = String(s.status || "");
  if (/ongoing/i.test(txt)) return "RELEASING";
  if (/hiatus/i.test(txt)) return "HIATUS";
  if (/cancel|discontinued|dropped/i.test(txt)) return "CANCELLED";
  if (/complete/i.test(txt)) return "FINISHED";
  return null;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function normalize(s) {
  if (!s) return null;
  const genres = (s.genres || []).map(g => g.genre).filter(Boolean);
  if (genres.some(g => ADULT_GENRES.has(g))) genres.push("Hentai");
  const cover = s.image?.url?.original || null;
  const latest = Number(s.latest_chapter) || parseInt(String(s.status || ""), 10) || null;
  const altTitles = [s.title, ...(s.associated || []).map(a => a.title)]
    .map(decodeEntities).filter(Boolean);

  return {
    id: s.series_id,
    title: { romaji: decodeEntities(s.title), english: decodeEntities(s.title), native: null },
    altTitles: [...new Set(altTitles)],
    coverImage: { extraLarge: cover, large: cover },
    genres: [...new Set(genres)],
    description: s.description || null,
    status: mapStatus(s),
    // 0-10 skála → 0-100, mint a többi forrásnál; szavazat nélkül nincs értelme
    averageScore: s.rating_votes > 0 && s.bayesian_rating ? Math.round(s.bayesian_rating * 10) : null,
    chapters: s.completed && latest ? latest : null,
    tags: [],
    recommendations: { nodes: [] },
  };
}

/** Konkrét MangaUpdates series_id alapú lekérés. */
export async function getSeriesById(id) {
  return normalize(await muFetch(`/series/${id}`));
}

/**
 * Cím alapú keresés — csak pontos névegyezést fogad el (a fő címre vagy
 * arra az alternatív címre, amin a találat jött). null = biztosan nincs.
 */
export async function searchSeriesByTitle(title) {
  const target = normalizeTitle(title);
  if (target.length < 3) return null;
  const json = await muFetch(`/series/search`, { search: title, perpage: 10 });
  const hit = (json?.results || []).find(r =>
    !SKIP_TYPES.has(r.record?.type) &&
    [r.record?.title, r.hit_title].some(n => normalizeTitle(decodeEntities(n)) === target)
  );
  if (!hit) return null;
  return getSeriesById(hit.record.series_id);
}
