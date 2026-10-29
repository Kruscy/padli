import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { searchSeriesByTitle as searchMangaUpdates } from "./mangaupdates.js";

/* ── Már fent lévő mű felismerése új mappa létrehozásakor ──────
   A scan a mappanév alapján köti össze a fejezeteket a művel, ezért
   ha valaki egy már fent lévő művet más néven tölt fel (pl. a koreai
   romaji címmel az angol helyett), külön sorozat lesz belőle.

   Egyezés, ha a mappanév (normalizálva) megegyezik egy meglévő mű
   címével, mappanevével vagy valamelyik AniList-nevével; illetve ha
   az AniList a mappanévre olyan művet ad vissza, aminek a nevei közt
   szerepel a mappanév, és ez a mű (anilist_id) már fent van; végül ha
   a MangaUpdates a mappanévre pontosan egyező művet ad, és annak
   valamelyik neve egy meglévő mű címe/mappaneve/alternatív neve.
   Csak olyan művet nézünk, aminek van legalább egy fejezete. ── */

const ANILIST_URL = "https://graphql.anilist.co";

export function normalizeTitle(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function anilistQuery(query, variables) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`AniList HTTP ${r.status}`);
    const j = await r.json();
    if (j.errors) throw new Error(`AniList: ${j.errors[0]?.message}`);
    return j.data;
  } finally {
    clearTimeout(t);
  }
}

function mediaNames(m) {
  return [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].filter(Boolean);
}

// AniList-nevek lekérése és mentése (max. 50 azonosító / kérés).
export async function fillAltTitles(anilistIds) {
  const ids = [...new Set(anilistIds.filter(Boolean))];
  let saved = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await anilistQuery(
      `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: MANGA) { id title { romaji english native } synonyms } } }`,
      { ids: chunk }
    );
    const found = new Map((data?.Page?.media || []).map(m => [m.id, mediaNames(m)]));
    for (const id of chunk) {
      // ha az AniList nem ismeri (pl. törölt bejegyzés), üres tömb: ne kérdezzük újra
      await pool.query(`UPDATE manga SET alt_titles = $1 WHERE anilist_id = $2`, [found.get(id) || [], id]);
      saved++;
    }
  }
  return saved;
}

// Más forrásból (pl. MangaUpdates) kapott nevek hozzáfűzése a meglévőkhöz
// (ismétlés nélkül, a sorrend megmarad).
export async function mergeAltTitles(mangaId, names) {
  const clean = [...new Set((names || []).map(n => String(n || "").trim()).filter(Boolean))];
  if (!clean.length) return;
  await pool.query(
    `UPDATE manga SET alt_titles = (
       SELECT array_agg(n ORDER BY ord) FROM (
         SELECT DISTINCT ON (n) n, ord
         FROM unnest(COALESCE(alt_titles, '{}') || $2::text[]) WITH ORDINALITY AS t(n, ord)
         ORDER BY n, ord
       ) x)
     WHERE id = $1`,
    [mangaId, clean]
  );
}

let fillPromise = null;
// Azok a fejezetes művek, amiknek az AniList-nevei még nincsenek meg (pl. új mű)
async function fillMissingAltTitles() {
  if (fillPromise) return fillPromise;
  fillPromise = (async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT m.anilist_id FROM manga m
       WHERE m.anilist_id IS NOT NULL AND m.alt_titles IS NULL
         AND EXISTS (SELECT 1 FROM chapter c WHERE c.manga_id = m.id)`
    );
    if (rows.length) await fillAltTitles(rows.map(r => r.anilist_id));
  })().catch(err => console.warn("[alt-titles] pótlás hiba:", err.message))
    .finally(() => { fillPromise = null; });
  return fillPromise;
}

async function loadSeries() {
  const { rows } = await pool.query(`
    SELECT m.id, m.title, m.folder, m.slug, m.anilist_id, m.alt_titles,
           json_agg(json_build_object('library', l.name, 'path', l.path, 'chapters', x.n) ORDER BY x.n DESC) AS libraries,
           sum(x.n)::int AS chapters
    FROM manga m
    JOIN (SELECT manga_id, library_id, count(*)::int n FROM chapter GROUP BY 1, 2) x ON x.manga_id = m.id
    JOIN library l ON l.id = x.library_id
    GROUP BY m.id`);
  return rows;
}

// AniList-keresés a mappanévre; csak akkor fogadjuk el, ha a mappanév
// tényleg a találat egyik neve (a keresés egyébként hasonló nevű, de más
// művet is visszaadhat).
async function anilistIdForName(name) {
  const target = normalizeTitle(name);
  if (target.length < 3) return null;
  const data = await anilistQuery(
    `query ($s: String) { Page(perPage: 5) { media(search: $s, type: MANGA) { id title { romaji english native } synonyms } } }`,
    { s: name }
  );
  for (const m of data?.Page?.media || []) {
    if (mediaNames(m).some(n => normalizeTitle(n) === target)) return { id: m.id, names: mediaNames(m) };
  }
  return null;
}

/* A feltöltő könyvtára (abszolút útvonal) + az új mappa neve alapján.
   Visszaad: null, ha nincs egyezés; különben
   { mangaId, title, chapters, libraries, matchedBy, own, ownFolder, others } */
export async function findExistingSeries(folderName, uploaderBase) {
  const target = normalizeTitle(folderName);
  if (!target) return null;

  await fillMissingAltTitles();
  const series = await loadSeries();

  let hit = series.find(s => [s.title, s.folder, ...(s.alt_titles || [])].some(n => normalizeTitle(n) === target));
  let matchedBy = hit ? "name" : null;

  if (!hit) {
    try {
      const al = await anilistIdForName(folderName);
      if (al) {
        hit = series.find(s => s.anilist_id === al.id);
        matchedBy = hit ? "anilist" : null;
      }
    } catch (err) {
      console.warn("[duplikátum-ellenőrzés] AniList hiba:", err.message);
    }
  }

  // A MangaUpdates nevei (ha ezen át egyezett), a saját mappa kereséséhez is
  let muNames = [];
  if (!hit) {
    try {
      const mu = await searchMangaUpdates(folderName);
      if (mu) {
        const names = new Set(mu.altTitles.map(normalizeTitle).filter(n => n.length >= 3));
        hit = series.find(s => [s.title, s.folder, ...(s.alt_titles || [])].some(n => names.has(normalizeTitle(n))));
        if (hit) {
          matchedBy = "mangaupdates";
          muNames = mu.altTitles;
        }
      }
    } catch (err) {
      console.warn("[duplikátum-ellenőrzés] MangaUpdates hiba:", err.message);
    }
  }
  if (!hit) return null;

  const base = path.resolve(uploaderBase);
  const own = hit.libraries.filter(l => path.resolve(l.path) === base);
  const others = hit.libraries.filter(l => path.resolve(l.path) !== base);

  // A feltöltő saját, már meglévő mappája ehhez a műhöz (ha van)
  let ownFolder = null;
  if (own.length) {
    const names = new Set([hit.title, hit.folder, ...(hit.alt_titles || []), ...muNames].map(normalizeTitle));
    try {
      ownFolder = fs.readdirSync(base, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .find(n => names.has(normalizeTitle(n)) || n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") === hit.slug) || null;
    } catch {}
  }

  return {
    mangaId: hit.id,
    title: hit.title,
    chapters: hit.chapters,
    libraries: hit.libraries,
    matchedBy,
    own: own.length > 0,
    ownFolder,
    others: others.map(l => ({ library: l.library, chapters: l.chapters })),
  };
}
