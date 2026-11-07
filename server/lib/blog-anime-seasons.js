/* ── Időszerű blogtémák: anime-adaptációk (2026-11-07) ─────────
   1) Szezon-előzetes: a következő anime-szezon (tél/tavasz/nyár/ősz)
      manga-, manhwa- és manhua-alapú animéi — a szezon kezdete előtt
      legfeljebb 21 nappal (vagy ha lemaradt, a szezon első 14 napjában).
   2) Szezonon kívüli manhwa/manhua: koreai/kínai képregényből készült
      anime, ami az elmúlt 21 napban indult (vagy 7 napon belül indul),
      és még egyik bejegyzésünk sem írt róla.
   Az adatok az AniList-ből jönnek; a GPT csak a megadott tényekből
   dolgozhat (a saját tudása elavult — kitalált dátumok ellen).
   Melyik animéről írtunk már: blog_anime_covered tábla. ── */
import { pool } from "../db.js";

const ANILIST = "https://graphql.anilist.co";
const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];      // jan, ápr, júl, okt
const SEASON_HU = { WINTER: "téli", SPRING: "tavaszi", SUMMER: "nyári", FALL: "őszi" };
const SEASON_SLUG = { WINTER: "tel", SPRING: "tavasz", SUMMER: "nyar", FALL: "osz" };
const KIND_HU = { manga: "japán manga", manhwa: "koreai manhwa", manhua: "kínai manhua" };
const MONTH_HU = ["január", "február", "március", "április", "május", "június", "július",
                  "augusztus", "szeptember", "október", "november", "december"];
const FORMAT_HU = { TV: "TV-sorozat", TV_SHORT: "rövid TV-sorozat", ONA: "online sorozat (ONA)", MOVIE: "film", OVA: "OVA", SPECIAL: "különkiadás" };
const ANIME_FORMATS = new Set(["TV", "TV_SHORT", "ONA", "MOVIE"]);

const PREVIEW_DAYS_BEFORE = 21;
const PREVIEW_DAYS_AFTER = 14;
const OFFSEASON_LOOKBACK_DAYS = 21;
const OFFSEASON_LOOKAHEAD_DAYS = 7;
const OFFSEASON_MIN_POPULARITY = 150; // AniList-követők; az ismeretlen donghuák ne töltsék meg a blogot
const SITE_URL = process.env.SITE_URL || "";

const MEDIA_FIELDS = `id title{romaji english} format source countryOfOrigin
  startDate{year month day} episodes genres popularity description(asHtml:false) siteUrl
  studios(isMain:true){nodes{name}}
  relations{edges{relationType node{id type format countryOfOrigin title{romaji english}}}}`;

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS blog_anime_covered (
    anilist_id integer NOT NULL,
    post_slug  text    NOT NULL,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (anilist_id, post_slug))`);
  tableReady = true;
}

async function anilist(query, variables) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429) { await new Promise(res => setTimeout(res, 65000)); continue; }
    const j = await r.json();
    if (j.errors) throw new Error("AniList: " + j.errors.map(e => e.message).join("; "));
    return j.data;
  }
  throw new Error("AniList: túl sok kérés");
}

async function fetchPages(query, variables, maxPages = 4) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const d = await anilist(query, { ...variables, page });
    out.push(...d.Page.media);
    if (!d.Page.pageInfo.hasNextPage) break;
  }
  return out;
}

/* Az anime alapműve: a SOURCE (vagy ADAPTATION) kapcsolatú képregény.
   format MANGA/ONE_SHOT — a light novel (NOVEL) nem számít. */
export function classifySource(m) {
  const edges = m.relations?.edges || [];
  // Eredeti anime / light novel / játék alapú műnél a kapcsolódó manga a
  // feldolgozás, nem az alapmű (pl. ghost – end of night: ORIGINAL)
  if (m.source && !["MANGA", "WEB_MANGA", "OTHER"].includes(m.source)) return null;
  const isComic = e => e.node.type === "MANGA" && ["MANGA", "ONE_SHOT"].includes(e.node.format);
  // Az AniList néha ADAPTATION-nek jelöli az alapművet (pl. SSS-Class Revival Hunter: source OTHER)
  const src = edges.find(e => e.relationType === "SOURCE" && isComic(e))
           || edges.find(e => e.relationType === "ADAPTATION" && isComic(e));
  if (!src) {
    if (m.source === "MANGA" || m.source === "WEB_MANGA") {
      const c = m.countryOfOrigin;
      return { kind: c === "KR" ? "manhwa" : (c === "CN" || c === "TW") ? "manhua" : "manga", sourceId: null, sourceTitle: null };
    }
    return null;
  }
  const c = src.node.countryOfOrigin;
  return {
    kind: c === "KR" ? "manhwa" : (c === "CN" || c === "TW") ? "manhua" : "manga",
    sourceId: src.node.id,
    sourceTitle: src.node.title.english || src.node.title.romaji,
  };
}

const stripDesc = s => (s || "").replace(/<[^>]*>/g, " ").replace(/\(Source:[^)]*\)/gi, "")
  .replace(/\s+/g, " ").trim().slice(0, 350);

function fmtDate(d) {
  if (!d?.year) return "még nincs bejelentve";
  if (!d.month) return `${d.year}`;
  if (!d.day) return `${d.year}. ${MONTH_HU[d.month - 1]} (pontos nap még nincs)`;
  return `${d.year}. ${MONTH_HU[d.month - 1]} ${d.day}.`;
}

// Saját könyvtárunkban megvan-e az alapmű. Az AniList-en egy manhwának több
// bejegyzése is lehet (pl. Overgeared: 117460 és 105664 ALTERNATIVE), ezért
// minden kapcsolódó képregény-azonosítót, majd a címeket is nézzük.
const normTitle = t => String(t || "").toLowerCase()
  .replace(/\s*(season\s*\d+|\d+(st|nd|rd|th)\s*season|part\s*\d+|\(\d{4}\))\s*/gi, " ")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
async function attachLocal(items) {
  const ids = [...new Set(items.flatMap(i => i.matchIds))];
  const titles = [...new Set(items.flatMap(i => i.matchTitles.map(normTitle)).filter(t => t.length >= 4))];
  const { rows } = await pool.query(
    `SELECT id, slug, title, anilist_id, alt_titles FROM manga
      WHERE anilist_id = ANY($1)
         OR lower(regexp_replace(title, '[^[:alnum:]]+', ' ', 'g')) = ANY($2)
         OR EXISTS (SELECT 1 FROM unnest(alt_titles) a WHERE lower(regexp_replace(a, '[^[:alnum:]]+', ' ', 'g')) = ANY($2))
      ORDER BY id`, [ids, titles]);
  const norm = t => normTitle(t);
  for (const it of items) {
    const tset = new Set(it.matchTitles.map(norm));
    const local = rows.find(r => r.anilist_id && it.matchIds.includes(r.anilist_id))
               || rows.find(r => tset.has(norm(r.title)) || (r.alt_titles || []).some(a => tset.has(norm(a))));
    if (local) it.local = { title: local.title, url: `${SITE_URL}/chapters.html?slug=${encodeURIComponent(local.slug)}` };
  }
  return items;
}

function toItem(m, cls) {
  const comics = (m.relations?.edges || []).filter(e => e.node.type === "MANGA" && ["MANGA", "ONE_SHOT"].includes(e.node.format)
    && ["SOURCE", "ADAPTATION", "ALTERNATIVE"].includes(e.relationType));
  return {
    matchIds: comics.map(e => e.node.id),
    matchTitles: [cls.sourceTitle, ...comics.flatMap(e => [e.node.title.english, e.node.title.romaji]),
                  m.title.english, m.title.romaji].filter(Boolean),
    anilistId: m.id,
    title: m.title.english || m.title.romaji,
    romaji: m.title.romaji,
    format: FORMAT_HU[m.format] || m.format,
    kind: cls.kind,
    sourceId: cls.sourceId,
    sourceTitle: cls.sourceTitle,
    start: m.startDate,
    startText: fmtDate(m.startDate),
    episodes: m.episodes,
    studio: m.studios?.nodes?.[0]?.name || null,
    genres: (m.genres || []).slice(0, 4),
    description: stripDesc(m.description),
    popularity: m.popularity,
    local: null,
  };
}

/* ── Szezon-számítás ───────────────────────────────────── */
function seasonStart(season, year) {
  return new Date(Date.UTC(year, SEASONS.indexOf(season) * 3, 1));
}
function seasonOf(date) {
  const idx = Math.floor(date.getUTCMonth() / 3);
  return { season: SEASONS[idx], year: date.getUTCFullYear() };
}
function nextSeason({ season, year }) {
  const idx = SEASONS.indexOf(season);
  return idx === 3 ? { season: "WINTER", year: year + 1 } : { season: SEASONS[idx + 1], year };
}
const DAY = 86400e3;

export function seasonPreviewSlug({ season, year }) {
  return `anime-szezon-${year}-${SEASON_SLUG[season]}-manga-manhwa-manhua-adaptaciok`;
}

/* Melyik szezonról esedékes előzetes? (null = egyikről sem) */
export function duePreviewSeason(today) {
  const cur = seasonOf(today), nxt = nextSeason(cur);
  const tNext = seasonStart(nxt.season, nxt.year).getTime();
  if (tNext - today.getTime() <= PREVIEW_DAYS_BEFORE * DAY) return nxt;
  const tCur = seasonStart(cur.season, cur.year).getTime();
  if (today.getTime() - tCur <= PREVIEW_DAYS_AFTER * DAY) return cur;
  return null;
}

async function getSeasonAdaptations({ season, year }) {
  const q = `query($season:MediaSeason,$year:Int,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
    media(season:$season,seasonYear:$year,type:ANIME,isAdult:false,sort:POPULARITY_DESC){${MEDIA_FIELDS}}}}`;
  const media = await fetchPages(q, { season, year }, 3);
  const items = [];
  for (const m of media) {
    if (!ANIME_FORMATS.has(m.format)) continue;
    const cls = classifySource(m);
    if (cls) items.push(toItem(m, cls));
  }
  // Japán mangából rengeteg van: a 25 legnépszerűbb; manhwa/manhua mind
  const jp = items.filter(i => i.kind === "manga").slice(0, 25);
  const other = items.filter(i => i.kind !== "manga");
  return attachLocal([...jp, ...other]);
}

const fuzzy = d => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

async function getRecentKrCnAdaptations(today) {
  const from = new Date(today.getTime() - OFFSEASON_LOOKBACK_DAYS * DAY);
  const to = new Date(today.getTime() + OFFSEASON_LOOKAHEAD_DAYS * DAY);
  const q = `query($from:FuzzyDateInt,$to:FuzzyDateInt,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
    media(type:ANIME,isAdult:false,startDate_greater:$from,startDate_lesser:$to,sort:POPULARITY_DESC){${MEDIA_FIELDS}}}}`;
  const media = await fetchPages(q, { from: fuzzy(from) - 1, to: fuzzy(to) + 1 }, 4);
  const items = [];
  for (const m of media) {
    if (!ANIME_FORMATS.has(m.format) || !m.startDate?.day) continue; // csak biztos dátummal
    if ((m.popularity || 0) < OFFSEASON_MIN_POPULARITY) continue;   // szinte senki nem követi
    const cls = classifySource(m);
    if (cls && cls.kind !== "manga") items.push(toItem(m, cls));
  }
  return items;
}

/* ── Promptok ──────────────────────────────────────────── */
function factsBlock(items) {
  return items.map(i => JSON.stringify({
    anime_cim: i.title,
    japan_cim: i.romaji !== i.title ? i.romaji : undefined,
    alapmu: i.sourceTitle || undefined,
    alapmu_tipusa: KIND_HU[i.kind],
    forma: i.format,
    premier: i.startText,
    epizodok: i.episodes || undefined,
    studio: i.studio || undefined,
    mufajok: i.genres.join(", ") || undefined,
    leiras_angolul: i.description || undefined,
    magyarul_olvashato_nalunk: i.local ? { cim: i.local.title, link: i.local.url } : undefined,
  })).join("\n");
}

const FACT_RULES = `SZIGORÚ SZABÁLYOK:
- KIZÁRÓLAG a lenti adatokat használd. A saját tudásod ezekről a címekről elavult lehet: ne találj ki premierdátumot, stúdiót, epizódszámot, streaming-platformot, szinkronhangot vagy cselekményrészletet, ami nincs az adatokban.
- Ha egy adat hiányzik, ne említsd, vagy írd, hogy még nincs bejelentve.
- A leírásokat (angolul vannak) magyarul, saját szavaiddal foglald össze 1–3 mondatban.
- Ahol "magyarul_olvashato_nalunk" szerepel, ott írd ki kiemelten, hogy az alapmű magyarul olvasható a Padlizsán Fansubon, és pontosan a megadott linket használd: <a href="LINK">cím</a>. Más linket ne találj ki.
- A címeket írd az angol címükön, mellette zárójelben a japán/eredeti címet, ha meg van adva.`;

export function buildPreviewTopic(target, items, today = new Date()) {
  const { season, year } = target;
  const sHu = SEASON_HU[season];
  const running = today.getTime() >= seasonStart(season, year).getTime(); // a szezon már fut
  const title = `${year} ${sHu} anime szezon – Manga-, manhwa- és manhua-adaptációk`;
  const counts = { manga: 0, manhwa: 0, manhua: 0 };
  items.forEach(i => counts[i.kind]++);
  const local = items.filter(i => i.local);
  const localNames = local.map(i => i.local.title);
  return {
    // meta description / bevezető: a keresőben ez jelenik meg
    excerpt: (`A ${year} ${sHu} anime szezon manga-, manhwa- és manhua-adaptációi premierdátumokkal és stúdiókkal` +
      (localNames.length ? `. Magyarul olvasható alapművek nálunk: ${localNames.slice(0, 3).join(", ")}${localNames.length > 3 ? " és még több" : ""}.` : ".")).slice(0, 300),
    slug: seasonPreviewSlug(target),
    title,
    category: "hir",
    tags: [`${sHu} anime szezon ${year}`, "anime adaptáció", "manhwa anime", "manga anime",
           ...localNames.slice(0, 6).map(n => `${n} magyarul`)],
    imageSubject: `a group of original anime characters gathered in a cozy room watching a big screen showing a colorful anime premiere, ${
      { WINTER: "snowy winter evening outside the window", SPRING: "cherry blossoms drifting outside the window", SUMMER: "bright summer sunset and fireworks outside the window", FALL: "autumn leaves falling outside the window" }[season]}`,
    coveredIds: items.map(i => i.anilistId),
    tableItems: items,
    temperature: 0.5,
    prompt: `Írj egy 1300-1700 szavas, SEO-optimalizált magyar nyelvű hírösszefoglaló blogbejegyzést a Padlizsán Fansub weboldalra.

Cím: "${title}"
Téma: a ${year} ${sHu} anime szezonban (${MONTH_HU[SEASONS.indexOf(season) * 3]}–${MONTH_HU[SEASONS.indexOf(season) * 3 + 2]}) ${running ? "már futó (elindult)" : "induló"} animék, amelyek mangából, manhwából vagy manhuából készülnek.${running ? `
FONTOS: a szezon már ELKEZDŐDÖTT (ma ${today.getUTCFullYear()}. ${MONTH_HU[today.getUTCMonth()]} ${today.getUTCDate()}.). Múlt időben írj a már elindult sorozatokról ("elindult", "fut"), ne előzetesként.` : ""}
Ebben a szezonban az adatok szerint ${counts.manga} japán manga-, ${counts.manhwa} koreai manhwa- és ${counts.manhua} kínai manhua-adaptáció van a listán${local.length ? `, közülük ${local.length} alapműve magyarul is olvasható nálunk` : ""}.

Felépítés:
1. Bevezető (100-150 szó) a szezonról.
2. Közvetlenül a bevezető után írd be pontosan ezt a sort, külön: <!--PREMIER_TABLE-->  (ide kerül automatikusan a teljes premier-táblázat).
3. ${counts.manhwa + counts.manhua ? "„Manhwa- és manhua-adaptációk” szekció — ezek kerüljenek előre, mindegyik saját H3-mal." : "Ha nincs manhwa/manhua-adaptáció, egy mondatban jelezd."}
4. „A szezon legvártabb manga-adaptációi” — a japán mangák közül a 8-10 legnépszerűbb (a lista népszerűség szerint rendezett), saját H3-mal; a többit csak a táblázat sorolja.
${local.length ? `5. „${running ? "Olvasd tovább magyarul" : "Olvasd el előre magyarul"}” szekció: a nálunk elérhető alapművek, mindegyik saját H3-mal, aminek a szövege PONTOSAN "<alapmű címe> magyarul" (pl. "${localNames[0]} magyarul"), alatta 2-3 mondat: hol tart az anime, és hogy a történet a ${"manhwában/mangában"} jóval előrébb jár, magyarul a linken olvasható.\n6.` : "5."} Rövid FAQ (3-4 kérdés), pl. mikor kezdődik a ${sHu} szezon, melyik manhwából lesz anime.

Kulcsszavak természetesen: ${sHu} anime szezon ${year}, anime adaptáció, manhwa anime, manga anime, új anime${localNames.length ? ", valamint minden nálunk olvasható címnél: \"<cím> magyarul\", \"<cím> anime\"" : ""}.

${FACT_RULES}

ADATOK (soronként egy anime, JSON):
${factsBlock(items)}

Formázás: HTML (h2, h3, p, ul/li, strong, a). Ne legyen html/body wrapper.`,
  };
}

function buildOffseasonTopic(items, today) {
  const one = items.length === 1 ? items[0] : null;
  const kinds = [...new Set(items.map(i => i.kind))];
  const kindWord = kinds.length === 2 ? "manhwa- és manhua" : kinds[0];
  const title = one
    ? `Animét kapott a(z) ${one.sourceTitle || one.title} ${one.kind} – ${one.title} anime`
    : `Szezonon kívül induló ${kindWord}-animék – ${today.getUTCFullYear()}. ${MONTH_HU[today.getUTCMonth()]}`;
  const slugBase = one ? `${one.title}-${one.kind}-anime-adaptacio` : `szezonon-kivuli-${kinds.join("-")}-animek-${today.toISOString().slice(0, 10)}`;
  return {
    slug: slugify(slugBase).slice(0, 90),
    title,
    category: "hir",
    tags: ["manhwa anime", "manhua anime", "anime adaptáció", ...items.slice(0, 3).map(i => i.title)],
    imageSubject: one
      ? `an original anime hero stepping out of a glowing vertical webtoon smartphone screen into an animated TV scene, ${one.genres.join(", ") || "action"} atmosphere`
      : "original anime characters stepping out of glowing vertical webtoon phone screens into a cinema screen, celebration of new anime premieres",
    coveredIds: items.map(i => i.anilistId),
    tableItems: items,
    temperature: 0.5,
    prompt: `Írj egy ${one ? "700-1000" : "900-1300"} szavas, SEO-optimalizált magyar nyelvű hírbejegyzést a Padlizsán Fansub weboldalra.

Cím: "${title}"
Téma: ${one ? "egy koreai manhwából / kínai manhuából készült anime, amely" : "koreai manhwákból / kínai manhuákból készült animék, amelyek"} a szokásos negyedéves anime-szezonon kívül, év közben ${one ? "indult el (vagy indul hamarosan)" : "indultak el (vagy indulnak hamarosan)"}.

Felépítés:
1. Bevezető: mi indult, mikor, miért érdekes (a manhwa/manhua-adaptációk egyre gyakrabban jelennek meg szezonon kívül, pl. online platformokon).
2. Közvetlenül a bevezető után írd be pontosan ezt a sort, külön: <!--PREMIER_TABLE-->
3. ${one ? "Miről szól (az adatok alapján), mit érdemes tudni az alapműről." : "Címenként egy H3: miről szól, mit érdemes tudni az alapműről."}
4. Ha valamelyik alapmű magyarul olvasható nálunk, külön kiemelve hívd fel rá a figyelmet a megadott linkkel.
5. Rövid FAQ (2-3 kérdés).

${FACT_RULES}

ADATOK (soronként egy anime, JSON):
${factsBlock(items)}

Formázás: HTML (h2, h3, p, ul/li, strong, a). Ne legyen html/body wrapper.`,
  };
}

function slugify(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const escHtml = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* A premier-táblázatot a kód rakja össze (nem a GPT), hogy a dátumok pontosak legyenek. */
export function premierTableHtml(items) {
  const order = { manhwa: 0, manhua: 1, manga: 2 };
  const sorted = [...items].sort((a, b) => order[a.kind] - order[b.kind]
    || (a.start?.month || 13) - (b.start?.month || 13) || (a.start?.day || 99) - (b.start?.day || 99));
  const rows = sorted.map(i => `<tr><td><strong>${escHtml(i.title)}</strong>${i.sourceTitle && i.sourceTitle !== i.title ? `<br><small>alapmű: ${escHtml(i.sourceTitle)}</small>` : ""}</td>` +
    `<td>${escHtml(KIND_HU[i.kind])}</td><td>${escHtml(i.format)}</td><td>${escHtml(i.startText)}</td><td>${escHtml(i.studio || "–")}</td>` +
    `<td>${i.local ? `<a href="${escHtml(i.local.url)}">Olvasd magyarul</a>` : "–"}</td></tr>`).join("\n");
  return `<h2>Premier-naptár</h2>
<div class="table-wrap"><table>
<thead><tr><th>Anime</th><th>Alapmű</th><th>Forma</th><th>Premier</th><th>Stúdió</th><th>Nálunk</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<p><small>Forrás: AniList, a bejegyzés készítésekor. A premierdátumok változhatnak.</small></p>`;
}

export function insertPremierTable(content, items) {
  const table = premierTableHtml(items);
  if (content.includes("<!--PREMIER_TABLE-->")) return content.replace("<!--PREMIER_TABLE-->", table);
  // ha a GPT kihagyta a jelölőt: az első H2 elé (vagy a végére)
  const i = content.indexOf("<h2");
  return i > 0 ? content.slice(0, i) + table + "\n" + content.slice(i) : content + "\n" + table;
}

export async function markCovered(ids, slug) {
  await ensureTable();
  for (const id of ids) {
    await pool.query("INSERT INTO blog_anime_covered (anilist_id, post_slug) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, slug]);
  }
}

/* ── Fő belépési pont: van-e most esedékes időszerű téma? ── */
export async function pickTimelyTopic(today = new Date()) {
  await ensureTable();

  // 1) Szezon-előzetes
  const target = duePreviewSeason(today);
  if (target) {
    const slug = seasonPreviewSlug(target);
    const { rowCount } = await pool.query("SELECT 1 FROM blog_posts WHERE slug=$1", [slug]);
    if (!rowCount) {
      const items = await getSeasonAdaptations(target);
      if (items.length >= 3) return buildPreviewTopic(target, items, today);
      console.log(`[BlogAnime] ${slug}: még csak ${items.length} adaptáció az AniList-en, később próbáljuk`);
    }
  }

  // 2) Szezonon kívüli manhwa/manhua-anime, amiről még nem írtunk
  const recent = await getRecentKrCnAdaptations(today);
  if (recent.length) {
    const { rows } = await pool.query("SELECT anilist_id FROM blog_anime_covered WHERE anilist_id = ANY($1)", [recent.map(i => i.anilistId)]);
    const covered = new Set(rows.map(r => r.anilist_id));
    const fresh = recent.filter(i => !covered.has(i.anilistId)).slice(0, 6);
    if (fresh.length) {
      const topic = buildOffseasonTopic(await attachLocal(fresh), today);
      const { rowCount } = await pool.query("SELECT 1 FROM blog_posts WHERE slug=$1", [topic.slug]);
      if (!rowCount) return topic;
    }
  }
  return null;
}

/* Kézi indítás: "FALL-2026" → az adott szezon bejegyzése (CLI --season=) */
export async function seasonTopic(spec, today = new Date()) {
  const [season, y] = String(spec).toUpperCase().split("-");
  if (!SEASONS.includes(season) || !/^\d{4}$/.test(y)) throw new Error(`Rossz szezon: ${spec} (pl. FALL-2026)`);
  const target = { season, year: Number(y) };
  const items = await getSeasonAdaptations(target);
  if (!items.length) throw new Error("Nincs adaptáció az AniList-en ehhez a szezonhoz");
  return buildPreviewTopic(target, items, today);
}
