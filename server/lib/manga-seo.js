/* ── Manga-oldalak keresőoptimalizálása (2026-11-07) ──────────
   A chapters.html?slug=… oldal a böngészőben, JS-ből tölti be a műt,
   így a Google eddig minden mangát ugyanazzal a címmel látott
   („PadlizsanFanSub – Manga”), leírás nélkül, és a sitemapben sem voltak.
   Ez a köztes réteg a kiszolgált HTML fejébe beírja a mű saját címét,
   leírását, kanonikus URL-jét, OG-adatait és strukturált adatait,
   hogy a „<cím> magyarul” keresésekre minket is megtaláljanak.
   A 18+ (Hentai/Ecchi) művek noindexet kapnak és kimaradnak a sitemapből. ── */
import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { ADULT_GENRE_EXISTS_SQL } from "./age.js";

const SITE_URL = (process.env.SITE_URL || "https://padlizsanfansub.hu").replace(/\/$/, "");
const CACHE_MS = 10 * 60 * 1000;

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s, n) => {
  const t = String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ") > n * 0.6 ? cut.lastIndexOf(" ") : n).replace(/[,.;:–-]+$/, "") + "…";
};

const metaCache = new Map(); // slug -> { at, data }

async function loadManga(slug) {
  const hit = metaCache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const { rows } = await pool.query(
    `SELECT m.id, m.title, m.slug, m.description, m.cover_url, m.alt_titles, m.status,
            ${ADULT_GENRE_EXISTS_SQL} AS is_adult,
            (SELECT count(*) FROM chapter c WHERE c.manga_id = m.id)::int AS chapters,
            (SELECT array_agg(g.name ORDER BY g.name) FROM manga_genre mg JOIN genre g ON g.id = mg.genre_id WHERE mg.manga_id = m.id) AS genres
       FROM manga m WHERE m.slug = $1 ORDER BY m.id LIMIT 1`, [slug]);
  const data = rows[0] || null;
  metaCache.set(slug, { at: Date.now(), data });
  if (metaCache.size > 2000) metaCache.delete(metaCache.keys().next().value);
  return data;
}

function headFor(m) {
  const url = `${SITE_URL}/chapters.html?slug=${encodeURIComponent(m.slug)}`;
  const title = `${m.title} magyarul – online olvasás | PadlizsanFanSub`;
  const desc = clip(`${m.title} magyarul, ingyen olvasható online a Padlizsán Fansubon${m.chapters ? ` (${m.chapters} fejezet)` : ""}. ${m.description || ""}`, 160);
  const img = m.cover_url ? (m.cover_url.startsWith("http") ? m.cover_url : SITE_URL + m.cover_url) : `${SITE_URL}/assets/favico.png`;
  const alt = (m.alt_titles || []).filter(a => a && a !== m.title).slice(0, 8);
  const ld = {
    "@context": "https://schema.org",
    "@type": "ComicSeries",
    name: m.title,
    ...(alt.length ? { alternateName: alt } : {}),
    url,
    image: img,
    description: clip(m.description, 500) || undefined,
    inLanguage: "hu",
    ...(m.genres?.length ? { genre: m.genres } : {}),
    publisher: { "@type": "Organization", name: "PadlizsanFanSub", url: SITE_URL },
  };
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="robots" content="${m.is_adult ? "noindex, follow" : "index, follow"}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="book">`,
    `<meta property="og:title" content="${esc(`${m.title} magyarul`)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:locale" content="hu_HU">`,
    `<meta property="og:site_name" content="PadlizsanFanSub">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].join("\n  ");
}

/* Express-köztes réteg az express.static ELÉ: GET /chapters.html?slug=… */
export function mangaSeoMiddleware(publicDir, transform = h => h) {
  const file = path.join(publicDir, "chapters.html");
  let tpl = null, tplMtime = 0;
  return async (req, res, next) => {
    if (req.method !== "GET" || req.path !== "/chapters.html" || typeof req.query.slug !== "string") return next();
    try {
      const st = fs.statSync(file);
      if (!tpl || st.mtimeMs !== tplMtime) { tpl = transform(fs.readFileSync(file, "utf8")); tplMtime = st.mtimeMs; }
      const m = await loadManga(req.query.slug.slice(0, 200));
      if (!m) return next();
      const html = tpl.replace(/<title>[^<]*<\/title>/, headFor(m));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.send(html);
    } catch (err) {
      console.warn("[manga-seo]", err.message);
      next(); // hiba esetén a sima statikus oldal megy ki
    }
  };
}

/* Sitemap-bejegyzések: nem 18+, legalább egy fejezettel; lastmod = legutóbbi fejezet */
export async function mangaSitemapEntries() {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (m.slug) m.slug, max(c.scanned_at) AS last
      FROM manga m JOIN chapter c ON c.manga_id = m.id
     WHERE NOT ${ADULT_GENRE_EXISTS_SQL}
     GROUP BY m.id, m.slug
     ORDER BY m.slug, max(c.scanned_at) DESC`);
  return rows.map(r => ({
    loc: `${SITE_URL}/chapters.html?slug=${encodeURIComponent(r.slug)}`,
    lastmod: r.last ? new Date(r.last).toISOString().split("T")[0] : null,
  }));
}
