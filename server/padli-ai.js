import fetch from "node-fetch";
import { pool as dbPool } from "./db.js";
import { sendToDiscord } from "./discord-bot.js";
import fs from "fs";
import path from "path";
import config from "./padli-config.js";

const OLLAMA_URL    = config.general.ollamaUrl;
const OLLAMA_MODEL  = config.general.ollamaModel;
const ANILIST_URL   = "https://graphql.anilist.co";
const KAMRAFY_URL   = "https://kamrafy.hu/api/v1/recommend";
const KAMRAFY_KEY   = process.env.KAMRAFY_API_KEY || "";
const JIKAN_URL     = "https://api.jikan.moe/v4";
const MANGADEX_URL  = "https://api.mangadex.org";
const KITSU_URL     = "https://kitsu.io/api/edge";
const SHIKIMORI_URL = "https://shikimori.one/api";
export const REPLY_DELAY_MS = config.replyDelay.questionMs;
const BOT_NAMES = config.bot.triggerNames;
const LOG = "\uD83C\uDF46"; // 🍆

/* ── DB CONFIG + KARAKTEREK CACHE ───────────────────────── */
let dbConfig = {};        // padli_config tábla értékei
let dbReplies = {};       // padli_replies tábla – típusonként csoportosítva
let dbTagWords = {};      // padli_tag_words – tag_name -> words[]
let dbGenreWords = {};      // padli_genre_words -  genre_name -> words[] (opcionális)
let dbCharacters = [];    // padli_characters + stories
let configLoadedAt = 0;
let dbAliases = {};   // padli_aliases tábla - alias -> title
const CONFIG_TTL = 5 * 60 * 1000; // 5 perc

async function loadDbConfig() {
  if (Date.now() - configLoadedAt < CONFIG_TTL) return;
  try {
    // Config értékek
    const { rows: cfgRows } = await dbPool.query(
      "SELECT key, value FROM padli_config"
    );
    cfgRows.forEach(r => {
      try { dbConfig[r.key] = JSON.parse(r.value); } catch { dbConfig[r.key] = r.value; }
    });

    // Válasz variációk
    const { rows: repRows } = await dbPool.query(
      "SELECT type, text FROM padli_replies WHERE active = true"
    );
    dbReplies = {};
    repRows.forEach(r => {
      (dbReplies[r.type] = dbReplies[r.type] || []).push(r.text);
    });

    // Tag szavak
    const { rows: tagRows } = await dbPool.query(
      "SELECT tag_name, words FROM padli_tag_words"
    );
    dbTagWords = {};
    tagRows.forEach(r => { dbTagWords[r.tag_name.toLowerCase()] = r.words; });

    // Karakterek + történetek
    const { rows: charRows } = await dbPool.query(
      "SELECT c.id, c.name, c.description, c.personality, " +
      "COALESCE(json_agg(s ORDER BY s.id) FILTER (WHERE s.id IS NOT NULL AND s.active = true), '[]') AS stories " +
      "FROM padli_characters c " +
      "LEFT JOIN padli_stories s ON s.character_id = c.id " +
      "WHERE c.active = true GROUP BY c.id ORDER BY c.id"
    );
    dbCharacters = charRows;
    // Alias-ok betöltése DB-ből
    const { rows: aliasRows } = await dbPool.query(
      "SELECT alias, title FROM padli_aliases WHERE active = true ORDER BY alias"
    );
    dbAliases = {};
    aliasRows.forEach(r => { dbAliases[r.alias] = r.title; });
    plog("DB_CONFIG", "alias-ok betoltve: " + aliasRows.length);
// Genre-k betöltése a config genre táblából (ha van padli_genre_words tábla)
    // Ha nincs DB genre → marad a statikus config.genres
    try {
      const { rows: genreRows } = await dbPool.query(
        "SELECT genre_name, words FROM padli_genre_words ORDER BY genre_name"
      );
      if (genreRows.length > 0) {
        dbGenreWords = {};
        genreRows.forEach(r => { dbGenreWords[r.genre_name] = r.words; });
        plog("DB_CONFIG", "genre szavak betoltve: " + genreRows.length);
      }
    } catch {
      // Tábla nem létezik → statikus config.genres marad, nem baj
    }
    configLoadedAt = Date.now();
    plog("DB_CONFIG", "betoltve: " + cfgRows.length + " config, " + charRows.length + " karakter, " + tagRows.length + " tag");
  } catch (err) {
    console.error(LOG + " DB config load error: " + err.message);
  }
}

// Config újratöltés jelzés kezelése
process.on("padli-config-reload", () => {
  configLoadedAt = 0;
  plog("DB_CONFIG", "reload jelzes fogadva");
});

// DB config értéket vesz ki, ha nincs → a statikus configból
function getCfg(key, fallback) {
  return dbConfig[key] !== undefined ? dbConfig[key] : fallback;
}

// DB válasz variáció, ha nincs → statikus config
function getReply(type) {
  const arr = dbReplies[type];
  if (arr && arr.length) return arr[Math.floor(Math.random() * arr.length)];
  // Fallback a statikus configra
  const fb = config.fixedReplies[type];
  if (Array.isArray(fb)) return fb[Math.floor(Math.random() * fb.length)];
  return fb || null;
}

// Karakterek system prompt kibővítése
function buildCharacterContext() {
  if (!dbCharacters.length) return "";
  let ctx = "\n\nISMERT KARAKTEREK A KÖZÖSSÉGBŐL (ezeket ismered, róluk tudasz beszélni):";
  for (const char of dbCharacters) {
    ctx += "\n- " + char.name;
    if (char.description) ctx += ": " + char.description;
    if (char.personality) ctx += " [Személyiség: " + char.personality + "]";
    if (char.stories && char.stories.length) {
      ctx += " | Történetek: " + char.stories.map(s => s.title).join(", ");
    }
  }
  return ctx;
}

// Teljes system prompt DB karakterekkel kiegészítve
function getSystemPrompt() {
  const base = config.systemPrompt;
  const charCtx = buildCharacterContext();
  return base + charCtx;
}

/* ── LOG ────────────────────────────────────────────────── */
function ensureLogDir() {
  if (!fs.existsSync(config.log.dir)) fs.mkdirSync(config.log.dir, { recursive: true });
}
function getLogFile() {
  ensureLogDir();
  try {
    const files = fs.readdirSync(config.log.dir).filter(f => f.startsWith("padli-") && f.endsWith(".log"));
    const cutoff = Date.now() - config.log.maxDays * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const fp = path.join(config.log.dir, file);
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
    }
  } catch {}
  const today = new Date().toISOString().slice(0, 10);
  let lf = path.join(config.log.dir, "padli-" + today + ".log");
  try {
    if (fs.existsSync(lf) && fs.statSync(lf).size >= config.log.maxSizeMb * 1024 * 1024)
      lf = path.join(config.log.dir, "padli-" + today + "-" + Date.now() + ".log");
  } catch {}
  return lf;
}
function padliLog(entry) {
  try {
    fs.appendFileSync(getLogFile(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {}
}
function plog(tag, msg) {
  console.log(LOG + " [" + tag + "] " + msg);
}

/* ── SEGÉD ──────────────────────────────────────────────── */
function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeQuery(str) {
  if (!str || !config.features.enableQueryNormalization) return str;
  let s = str.trim().toLowerCase().replace(/\s+/g, " ");
  if (config.normalization.removeAccents)
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return s;
}

function fillTemplate(tpl, vars) {
  let r = tpl;
  for (const [k, v] of Object.entries(vars)) r = r.replace("{" + k + "}", v || "");
  if (/\{[a-z]+\}/.test(r)) return null;
  return r;
}

function sanitizeInput(str) {
  if (!str || !config.features.enableSecurity) return str;
  let s = str.slice(0, config.security.maxInputLength);
  if (config.security.stripHtml) s = s.replace(/<[^>]*>/g, "");
  if (config.security.preventPromptInjection) {
    const lower = s.toLowerCase();
    if (config.security.injectionPatterns.some(p => lower.includes(p))) {
      padliLog({ event: "security_blocked", input: s.slice(0, 80) });
      return null;
    }
  }
  return s;
}

function checkEdgeCase(str) {
  if (!config.features.enableEdgeCaseHandling || !str) return null;
  if (!str.trim()) return config.edgeCases.emptyReply;
  if (/^[\p{Emoji}\s]+$/u.test(str.trim())) return config.edgeCases.emojiReply;
  return null;
}

function applyLLMSafety(reply) {
  if (!reply || !config.features.enableLLMSafety) return reply;
  // Kamrafy recept válasz: ne szűrjük, megőrizzük a linkeket és sortöréseket
  if (reply.includes("kamrafy.hu")) return reply;
  const s = config.llmSafety;
  let r = reply;
  // qwen3/deepseek thinking blokk eltávolítása
  r = r.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  r = r.replace(/^[\s\S]*?<\/think>/i, "").trim();
  if (s.stripSelfName)  r = r.replace(/^Padli[!,]?\s*/i, "").trim();
  if (s.stripNewlines)  r = r.replace(/\n{2,}/g, " ").replace(/\n/g, " ").trim();
  if (s.maxResponseChars && r.length > s.maxResponseChars) {
    const sentences = r.match(/[^.!?]+[.!?]+/g) || [r];
    r = sentences.slice(0, s.enforceSentenceLimit).join(" ").trim();
    if (r.length > s.maxResponseChars) r = r.slice(0, s.maxResponseChars).trim() + "...";
  }
  return r;
}

/* ── CACHE ──────────────────────────────────────────────── */
const searchCache = new Map();
function cacheGet(key) {
  if (!config.features.enableCache || !config.cache.cacheSearchResults) return null;
  const e = searchCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > config.cache.ttlMs) { searchCache.delete(key); return null; }
  plog("CACHE", "hit: " + key);
  return e.result;
}
function cacheSet(key, result) {
  if (!config.features.enableCache || !config.cache.cacheSearchResults) return;
  if (searchCache.size >= config.cache.maxSize) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) searchCache.delete(oldest[0]);
  }
  searchCache.set(key, { result, ts: Date.now() });
}

/* ── ANALYTICS ──────────────────────────────────────────── */
const analytics = { intents: {}, misses: [], queries: {} };
function trackAnalytics(type, value) {
  if (!config.analytics.enabled) return;
  if (type === "intent") analytics.intents[value] = (analytics.intents[value] || 0) + 1;
  else if (type === "miss") {
    analytics.misses.push({ query: value, ts: Date.now() });
    if (analytics.misses.length > 100) analytics.misses.shift();
  } else if (type === "query") {
    analytics.queries[value] = (analytics.queries[value] || 0) + 1;
  }
}
export function getAnalytics() { return analytics; }

/* ── TOPIC MEMORY ───────────────────────────────────────── */
const topicMemory = new Map();
function setTopicMemory(userKey, searchTerm) {
  if (!config.features.enableTopicMemory || !userKey || !searchTerm) return;
  topicMemory.set(userKey, { searchTerm, ts: Date.now() });
}
function getTopicMemory(userKey) {
  if (!config.features.enableTopicMemory || !userKey) return null;
  const e = topicMemory.get(userKey);
  if (!e) return null;
  if (Date.now() - e.ts > config.context.topicExpireMs) { topicMemory.delete(userKey); return null; }
  return e.searchTerm;
}

/* ── ALIAS ──────────────────────────────────────────────── */
function resolveAlias(term) {
  if (!term) return term;
  const lower = normalizeQuery(term) || term.toLowerCase().trim();
 
  // 1. DB alias-ok (prioritás - admin felületen szerkeszthetők)
  if (dbAliases[lower]) return dbAliases[lower];
 
  // Részleges egyezés: "jjk manga" → "Jujutsu Kaisen manga"
  for (const [alias, resolved] of Object.entries(dbAliases)) {
    if (lower.startsWith(alias + " ") || lower.endsWith(" " + alias)) {
      return resolved;
    }
  }
  // 2. Statikus config alias-ok (fallback, ha DB üres)
  if (config.aliases[lower]) return config.aliases[lower];
  for (const [alias, resolved] of Object.entries(config.aliases)) {
    if (lower === alias || lower.startsWith(alias + " ") || lower.endsWith(" " + alias))
      return resolved;
  }
 
  return term;
}

function expandWithSynonyms(term) {
  if (!term || !config.features.enableSynonyms) return term;
  const lower = term.toLowerCase();
  for (const [key, syns] of Object.entries(config.synonyms || {})) {
    if (lower.includes(key)) {
      const better = syns.find(s => s.length > key.length);
      if (better) return term.replace(new RegExp(key, "gi"), better);
    }
  }
  return term;
}

/* ── INTENT SCORING ─────────────────────────────────────── */
function scoreIntents(question) {
  // Normalizált szövegen futtatjuk az intent scoringot – ékezetek nélkül
  const l = question.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const scores = {};
  const triggered = {};

  const adultMatches = config.adultTriggers.filter(w => l.includes(w));
  if (adultMatches.length) {
    scores.adult = config.intentScoring.adult * adultMatches.length;
    triggered.adult = adultMatches;
  }

  const { keywords, priceWith, lockWith } = config.patreonTriggers;
  let patreonScore = 0;
  const patreonHits = [];
  if (keywords.some(w => l.includes(w))) { patreonScore += config.intentScoring.patreon; patreonHits.push("keyword"); }
  if (l.includes("mennyibe") && priceWith.some(w => l.includes(w))) { patreonScore += 1.0; patreonHits.push("price"); }
  if (l.includes("lakat") && lockWith.some(w => l.includes(w))) { patreonScore += 1.0; patreonHits.push("lock"); }
  if (patreonScore > 0) { scores.patreon = patreonScore; triggered.patreon = patreonHits; }

  const availMatches = config.availabilityTriggers.filter(w => l.includes(w));
  if (availMatches.length) {
    scores.availability = config.intentScoring.availability * Math.min(availMatches.length, 2);
    triggered.availability = availMatches;
  }

  const { count, tags, knowWith } = config.dbInfoTriggers;
  let dbScore = 0;
  if (count.some(w => l.includes(w))) dbScore += config.intentScoring.dbInfo;
  if (tags.some(w => l.includes(w))) dbScore += config.intentScoring.dbInfo;
  if (l.includes("ismersz") && knowWith.some(w => l.includes(w))) dbScore += config.intentScoring.dbInfo;
  if (dbScore > 0) { scores.dbInfo = dbScore; triggered.dbInfo = ["matched"]; }

  const recMatches = config.recommendationTriggers.filter(w => l.includes(w));
  // Extra: "tudsz ajánlani", "ajánlasz nekem" is recommendation
  const hasRecommendVerb = ["ajanl","ajanlasz","ajanlj","javasolj","mondj"].some(w => l.includes(w));
  const hasMediaNoun = ["manga","manhwa","manhua","anime","sorozat","webtoon"].some(w => l.includes(w));
  if (recMatches.length || (hasRecommendVerb && hasMediaNoun)) {
    const base = recMatches.length ? config.intentScoring.recommendation * Math.min(recMatches.length, 2) : config.intentScoring.recommendation;
    scores.recommendation = base;
    triggered.recommendation = recMatches.length ? recMatches : ["verb+noun"];
  }

  if (!config.mangaAnimeKeywords.some(w => l.includes(w))) {
    for (const k of Object.keys(scores)) scores[k] = (scores[k] || 0) + config.intentScoring.offTopicPenalty;
  }

  if (config.debug.logIntentScores && Object.keys(scores).length > 0) {
    const scoreStr = Object.entries(scores).map(([k, v]) => k + ":" + v.toFixed(1)).join(" | ");
    plog("INTENT_SCORES", scoreStr);
    padliLog({ event: "intent_scores", scores, triggered });
  }

  return { scores, triggered };
}

function resolveIntent(scores) {
  if (!Object.keys(scores).length) return null;
  for (const intent of config.intentPriority) {
    if (scores[intent] !== undefined && scores[intent] >= config.intentScoring.threshold)
      return intent;
  }
  return null;
}

/* ── NEGATÍV INTENT ─────────────────────────────────────── */
function filterNegatedGenres(question, genres) {
  if (!config.features.enableNegation || !genres.length) return genres;
  const words = question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/);
  return genres.filter(genre => {
    const entry = config.genres.find(g => g.genre === genre);
    if (!entry) return true;
    for (const trigger of entry.words) {
      const idx = words.findIndex(w => w.includes(trigger));
      if (idx === -1) continue;
      const preceding = words.slice(Math.max(0, idx - config.negation.window), idx);
      if (preceding.some(w => config.negation.words.includes(w))) {
        plog("NEGATION", genre + " kiszurve");
        padliLog({ event: "negation_filtered", genre });
        return false;
      }
    }
    return true;
  });
}

/* ── SAJÁT DB ───────────────────────────────────────────── */
async function searchLocalDB(searchTerm) {
  const cacheKey = "db:" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const { rows } = await dbPool.query(
      "SELECT m.title, m.slug, m.status, m.average_score, COUNT(DISTINCT c.id) AS chapter_count " +
      "FROM manga m LEFT JOIN chapter c ON c.manga_id = m.id " +
      "WHERE m.title ILIKE $1 GROUP BY m.id LIMIT 1",
      ["%" + searchTerm + "%"]
    );
    const result = rows[0] || null;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) { console.error(LOG + " Local DB error: " + err.message); return null; }
}

async function searchLocalDBFuzzy(searchTerm) {
  const exact = await searchLocalDB(searchTerm);
  if (exact) return exact;
  const cacheKey = "fuzzy:" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const words = searchTerm.split(/\s+/).length;
    const threshold = (words <= config.search.shortQueryMaxWords)
      ? config.search.fuzzyThresholdShort
      : config.search.fuzzyThreshold;
    const { rows } = await dbPool.query(
      "SELECT m.title, m.slug, m.status, m.average_score, COUNT(DISTINCT c.id) AS chapter_count, " +
      "similarity(m.title, $1) AS sim FROM manga m LEFT JOIN chapter c ON c.manga_id = m.id " +
      "WHERE similarity(m.title, $1) > " + threshold + " GROUP BY m.id ORDER BY sim DESC LIMIT 1",
      [searchTerm]
    );
    if (rows[0]) plog("FUZZY", rows[0].title + " (sim:" + (rows[0].sim || 0).toFixed(2) + ")");
    const result = rows[0] || null;
    cacheSet(cacheKey, result);
    return result;
  } catch { return await searchLocalDB(searchTerm); }
}

async function getDBStats() {
  try {
    const { rows } = await dbPool.query(
      "SELECT COUNT(*) AS total, COUNT(DISTINCT c.manga_id) AS with_chapters " +
      "FROM manga m LEFT JOIN chapter c ON c.manga_id = m.id"
    );
    return rows[0];
  } catch { return null; }
}

async function getDBTags() {
  try {
    const { rows: genres } = await dbPool.query(
      "SELECT g.name FROM genre g JOIN manga_genre mg ON mg.genre_id = g.id " +
      "GROUP BY g.name ORDER BY COUNT(*) DESC LIMIT 15"
    );
    const { rows: tags } = await dbPool.query(
      "SELECT t.name FROM tag t JOIN manga_tag mt ON mt.tag_id = t.id " +
      "GROUP BY t.name ORDER BY COUNT(*) DESC LIMIT 15"
    );
    return { genres: genres.map(r => r.name), tags: tags.map(r => r.name) };
  } catch { return null; }
}

const recommendedTitles = new Set();

async function searchLocalByGenreTag(genres) {
  if (!genres.length) return null;
  const cacheKey = "genre:" + genres.join(",");
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const limit = config.recommendation.maxResults * 2;
    let rows = [];

    // Minden genre-t külön próbálunk – subquery-vel hogy biztosan megtalálja
    for (const genre of genres) {
      if (rows.length >= limit) break;

      // 1. Keresés genre táblában (exact) – subquery-vel kerüljük a DISTINCT+ORDER BY konfliktust
      const { rows: r1 } = await dbPool.query(
        "SELECT title, slug, average_score, chapter_count FROM (" +
        "SELECT m.title, m.slug, m.average_score, COUNT(DISTINCT c.id) AS chapter_count " +
        "FROM manga m " +
        "INNER JOIN manga_genre mg ON mg.manga_id = m.id " +
        "INNER JOIN genre g ON g.id = mg.genre_id " +
        "LEFT JOIN chapter c ON c.manga_id = m.id " +
        "WHERE LOWER(g.name) = LOWER($1) " +
        "GROUP BY m.id) sub ORDER BY RANDOM() LIMIT " + limit,
        [genre]
      );

      if (r1.length) {
        rows = [...rows, ...r1.filter(r => !rows.some(x => x.title === r.title))];
        console.log(LOG + " [GENRE_DB] " + genre + " -> " + r1.length + " talalat (genre tabla)");
        continue;
      }

      // 2. Keresés tag táblában (exact)
      const { rows: r2 } = await dbPool.query(
        "SELECT title, slug, average_score, chapter_count FROM (" +
        "SELECT m.title, m.slug, m.average_score, COUNT(DISTINCT c.id) AS chapter_count " +
        "FROM manga m " +
        "INNER JOIN manga_tag mt ON mt.manga_id = m.id " +
        "INNER JOIN tag t ON t.id = mt.tag_id " +
        "LEFT JOIN chapter c ON c.manga_id = m.id " +
        "WHERE LOWER(t.name) = LOWER($1) " +
        "GROUP BY m.id) sub ORDER BY RANDOM() LIMIT " + limit,
        [genre]
      );

      if (r2.length) {
        rows = [...rows, ...r2.filter(r => !rows.some(x => x.title === r.title))];
        console.log(LOG + " [GENRE_DB] " + genre + " -> " + r2.length + " talalat (tag tabla)");
        continue;
      }

      // 3. ILIKE fallback
      const { rows: r3 } = await dbPool.query(
        "SELECT title, slug, average_score, chapter_count FROM (" +
        "SELECT m.title, m.slug, m.average_score, COUNT(DISTINCT c.id) AS chapter_count " +
        "FROM manga m " +
        "LEFT JOIN manga_genre mg ON mg.manga_id = m.id " +
        "LEFT JOIN genre g ON g.id = mg.genre_id " +
        "LEFT JOIN manga_tag mt ON mt.manga_id = m.id " +
        "LEFT JOIN tag t ON t.id = mt.tag_id " +
        "LEFT JOIN chapter c ON c.manga_id = m.id " +
        "WHERE g.name ILIKE $1 OR t.name ILIKE $1 " +
        "GROUP BY m.id) sub ORDER BY RANDOM() LIMIT " + limit,
        ["%" + genre + "%"]
      );

      if (r3.length) {
        rows = [...rows, ...r3.filter(r => !rows.some(x => x.title === r.title))];
        console.log(LOG + " [GENRE_DB] " + genre + " -> " + r3.length + " talalat (ILIKE fallback)");
      } else {
        console.log(LOG + " [GENRE_DB] " + genre + " -> 0 talalat");
        padliLog({ event: "genre_miss", genre });
      }
    }

    const result = rows.slice(0, limit);
    if (result.length) cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error(LOG + " Genre search error: " + err.message);
    padliLog({ event: "genre_error", error: err.message, genres });
    return null;
  }
}

/* ── RELEVANCIA ─────────────────────────────────────────── */
function isTitleRelevant(foundTitle, searchTerm) {
  if (!foundTitle || !searchTerm) return false;
  const found  = foundTitle.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const search = searchTerm.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (found === search || found.includes(search) || search.includes(found)) return true;
  const sw = search.split(/\s+/).filter(w => w.length > 2);
  const fw = found.split(/\s+/);
  if (!sw.length) return false;
  const matches = sw.filter(w => fw.some(f => f === w || f.includes(w) || w.includes(f))).length;
  const required = sw.length === 1 ? 1 : sw.length === 2 ? 2 : Math.ceil(sw.length * 0.6);
  return matches >= required;
}

/* ── MEDIA TIPUS ────────────────────────────────────────── */
function detectMediaType(question) {
  const lower = question.toLowerCase();
  if (config.mediaTypes.movie.some(w => lower.includes(w))) return "movie";
  if (config.mediaTypes.anime.some(w => lower.includes(w))) return "anime";
  return "manga";
}

/* ── API: ANILIST ───────────────────────────────────────── */
async function searchAniList(searchTerm, mediaType) {
  const cacheKey = "anilist:" + mediaType + ":" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  const isMovie = mediaType === "movie";
  const animeQ = (mediaType === "anime" || mediaType === "movie") ?
    "anime: Page(perPage:1) { media(search:$search, type:ANIME" + (isMovie ? ", format_in:[MOVIE,OVA,ONA,SPECIAL]" : "") + ") { id title{romaji english} synonyms format episodes status averageScore description(asHtml:false) genres tags{name} }}" : "";
  const mangaQ = mediaType === "manga" ?
    "manga: Page(perPage:1) { media(search:$search, type:MANGA) { id title{romaji english} synonyms chapters status averageScore description(asHtml:false) genres tags{name} }}" : "";
  try {
    const res = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: "query($search:String){" + animeQ + mangaQ + "}", variables: { search: searchTerm } })
    });
    const data = await res.json();
    const anime = data?.data?.anime?.media?.[0] || null;
    const manga = data?.data?.manga?.media?.[0] || null;
    const ok = (item) => item && (
      isTitleRelevant(item?.title?.english || "", searchTerm) ||
      isTitleRelevant(item?.title?.romaji || "", searchTerm) ||
      (item?.synonyms || []).some(s => isTitleRelevant(s, searchTerm))
    );
    const result = { anime: ok(anime) ? anime : null, manga: ok(manga) ? manga : null };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) { console.error(LOG + " AniList error: " + err.message); return null; }
}

/* ── API: ANILIST KARAKTER KERESÉS ──────────────────────── */
async function searchAniListCharacter(searchTerm) {
  const cacheKey = "anilist:char:" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const query = `query($search:String){
      Page(perPage:3) {
        characters(search:$search) {
          name { full native alternative }
          description(asHtml:false)
          media(perPage:2) {
            nodes { title { romaji english } type }
          }
        }
      }
    }`;
    const res = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables: { search: searchTerm } })
    });
    const data = await res.json();
    const chars = data?.data?.Page?.characters || [];
    if (!chars.length) { cacheSet(cacheKey, null); return null; }
    // Relevancia ellenőrzés
    const norm = searchTerm.toLowerCase();
    const found = chars.find(c => {
      const names = [c.name?.full, c.name?.native, ...(c.name?.alternative || [])];
      return names.some(n => n && isTitleRelevant(n, norm));
    }) || chars[0];
    const result = {
      name: found.name?.full || found.name?.native || searchTerm,
      description: (found.description || "").slice(0, 300),
      media: (found.media?.nodes || []).slice(0, 2).map(m => m.title?.english || m.title?.romaji).filter(Boolean)
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) { console.error(LOG + " AniList char error: " + err.message); return null; }
}
/* ── API: JIKAN ─────────────────────────────────────────── */
async function searchJikan(searchTerm, mediaType) {
  const cacheKey = "jikan:" + mediaType + ":" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const isMovie = mediaType === "movie";
    const [mr, ar] = await Promise.all([
      mediaType === "manga" ? fetch(JIKAN_URL + "/manga?q=" + encodeURIComponent(searchTerm) + "&limit=1&sfw") : Promise.resolve(null),
      (mediaType === "anime" || mediaType === "movie") ? fetch(JIKAN_URL + "/anime?q=" + encodeURIComponent(searchTerm) + "&limit=1&sfw" + (isMovie ? "&type=movie" : "")) : Promise.resolve(null)
    ]);
    const [md, ad] = await Promise.all([mr ? mr.json() : Promise.resolve(null), ar ? ar.json() : Promise.resolve(null)]);
    const manga = md?.data?.[0], anime = ad?.data?.[0];
    const mangaOk = manga && isTitleRelevant(manga?.title_english || manga?.title || "", searchTerm);
    const animeOk = anime && isTitleRelevant(anime?.title_english || anime?.title || "", searchTerm);
    if (!mangaOk && !animeOk) { cacheSet(cacheKey, null); return null; }
    const item = mangaOk ? manga : anime;
    const result = {
      type: mangaOk ? "manga" : (isMovie ? (item.type || "movie") : "anime"),
      title: item.title_english || item.title, mal_id: item.mal_id || null,
      score: item.score ? item.score + "/10" : "N/A",
      count: [item.chapters ? item.chapters + " fejezet" : "", item.volumes ? item.volumes + " kotet" : ""].filter(Boolean).join(", ") || (item.episodes ? item.episodes + " ep" : ""),
      status: item.status || "", desc: (item.synopsis || "").substring(0, 120)
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) { console.error(LOG + " Jikan error: " + err.message); return null; }
}

/* ── API: MANGADEX ──────────────────────────────────────── */
async function searchMangaDex(searchTerm) {
  const cacheKey = "mangadex:" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const res = await fetch(MANGADEX_URL + "/manga?title=" + encodeURIComponent(searchTerm) + "&limit=1&order[relevance]=desc", { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.data?.[0];
    if (!item) return null;
    const title = item.attributes?.title?.en || Object.values(item.attributes?.title || {})[0] || "";
    if (!isTitleRelevant(title, searchTerm)) { cacheSet(cacheKey, null); return null; }
    const result = {
      title, status: item.attributes?.status || "",
      chap: item.attributes?.lastChapter ? item.attributes.lastChapter + ". fejezet" : "",
      genres: (item.attributes?.tags || []).filter(t => t.attributes?.group === "genre").map(t => t.attributes?.name?.en || "").filter(Boolean).slice(0, 3).join(", ")
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) { console.error(LOG + " MangaDex error: " + err.message); return null; }
}

/* ── API: KITSU ─────────────────────────────────────────── */
async function searchKitsu(searchTerm, mediaType) {
  const cacheKey = "kitsu:" + mediaType + ":" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const [ar, mr] = await Promise.all([
      (mediaType === "anime" || mediaType === "movie") ? fetch(KITSU_URL + "/anime?filter[text]=" + encodeURIComponent(searchTerm) + "&page[limit]=1") : Promise.resolve(null),
      mediaType === "manga" ? fetch(KITSU_URL + "/manga?filter[text]=" + encodeURIComponent(searchTerm) + "&page[limit]=1") : Promise.resolve(null)
    ]);
    const [ad, mdd] = await Promise.all([ar ? ar.json() : Promise.resolve(null), mr ? mr.json() : Promise.resolve(null)]);
    const anime = ad?.data?.[0], manga = mdd?.data?.[0];
    const animeOk = anime && isTitleRelevant(anime?.attributes?.canonicalTitle || "", searchTerm);
    const mangaOk = manga && isTitleRelevant(manga?.attributes?.canonicalTitle || "", searchTerm);
    if (!animeOk && !mangaOk) { cacheSet(cacheKey, null); return null; }
    const item = mangaOk ? manga : anime, attr = item.attributes;
    const result = {
      type: mangaOk ? "manga" : "anime", title: attr?.canonicalTitle,
      score: attr?.averageRating ? parseFloat(attr.averageRating).toFixed(1) + "/100" : "N/A",
      count: attr?.chapterCount ? attr.chapterCount + " fejezet" : attr?.episodeCount ? attr.episodeCount + " ep" : "",
      status: attr?.status || ""
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) { console.error(LOG + " Kitsu error: " + err.message); return null; }
}

/* ── API: SHIKIMORI ─────────────────────────────────────── */
async function searchShikimori(searchTerm) {
  const cacheKey = "shiki:" + searchTerm;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const [ar, mr] = await Promise.all([
      fetch(SHIKIMORI_URL + "/animes?search=" + encodeURIComponent(searchTerm) + "&limit=1", { headers: { "User-Agent": "PadlizsanFanSub/1.0" } }),
      fetch(SHIKIMORI_URL + "/mangas?search=" + encodeURIComponent(searchTerm) + "&limit=1", { headers: { "User-Agent": "PadlizsanFanSub/1.0" } })
    ]);
    const [ad, md] = await Promise.all([ar.json(), mr.json()]);
    const anime = Array.isArray(ad) ? ad[0] : null, manga = Array.isArray(md) ? md[0] : null;
    const animeOk = anime && isTitleRelevant(anime.name || "", searchTerm);
    const mangaOk = manga && isTitleRelevant(manga.name || "", searchTerm);
    if (!animeOk && !mangaOk) { cacheSet(cacheKey, null); return null; }
    const item = mangaOk ? manga : anime;
    const result = {
      type: mangaOk ? "manga" : "anime", title: item.name,
      score: item.score ? item.score + "/10" : "N/A",
      count: item.chapters ? item.chapters + " fejezet" : item.episodes ? item.episodes + " ep" : ""
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) { console.error(LOG + " Shikimori error: " + err.message); return null; }
}

/* ── KAMRAFY RECEPT API ─────────────────────────────────── */
const RECIPE_KEYWORDS = [
  "recept","főzz","főzzek","főzzünk","főzni","főztem","főzzél","sütni","süssek",
  "étel","ételek","kalória","kcal","vega","vegetáriánus","desszert","sütemény",
  "leves","mit főzzek","mit süssek","hozzávalók","hozzávalókból","kamrafy",
  "befőzés","tepsis","krumpliból","csirkéből","marhából","tojásból","tejfölből",
  "reggelire","reggeli ötlet","reggelit","vacsorára","vacsorát","ebédre","ebédet",
  "enni","ennivaló","mit egyek","mit együnk","mit quyek","főételt","főétel",
  "gyors vacsora","gyors ebéd","ebéd ötlet","vacsora ötlet",
];

function isRecipeQuestion(text) {
  const l = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return RECIPE_KEYWORDS.some(k =>
    l.includes(k.normalize("NFD").replace(/[̀-ͯ]/g, ""))
  );
}

function parseKamrafyRequest(question) {
  const l = question.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const body = {};

  // Hozzávalók kinyerése: "van krumpli tojás tejföl" / "krumpliból és tojásból"
  const ingMatch = question.match(/(?:van\s+otthon|van\s+|otthon\s+van|hozzávalók?[:\s]+)([^.?!]{5,60})/i);
  if (ingMatch) {
    const rawIngs = ingMatch[1].replace(/\b(és|meg|valamint|is)\b/gi, ",").split(/[,;]/);
    const cleaned = rawIngs.map(s => s.replace(/\b(ból|ből|ból|ből|t|k)\b/g, "").trim()).filter(s => s.length > 2);
    if (cleaned.length) body.ingredients = cleaned;
  }

  // Nehézség
  if (l.includes("konnyu") || l.includes("egyszeru") || l.includes("gyors")) body.filters = { ...(body.filters||{}), difficulty: "könnyű" };
  else if (l.includes("nehez") || l.includes("bonyolult")) body.filters = { ...(body.filters||{}), difficulty: "nehéz" };

  // Időkorlát
  const timeMatch = l.match(/(\d+)\s*perc/);
  if (timeMatch) body.filters = { ...(body.filters||{}), max_total_time: parseInt(timeMatch[1]) };
  else if (l.includes("gyors")) body.filters = { ...(body.filters||{}), max_total_time: 30 };

  // Kategória
  const cats = { leves: "leves", desszert: "desszert", sutes: "sütemény", tepi: "tepsis", befoz: "befőzés" };
  for (const [k, v] of Object.entries(cats)) {
    if (l.includes(k)) { body.filters = { ...(body.filters||{}), category: v }; break; }
  }

  // Query – eredeti kérdés padli nélkül
  body.query = question.replace(/padli[,!]?\s*/gi, "").trim().slice(0, 200);
  body.limit = 5;
  return body;
}

async function kamrafyApiCall(body) {
  const res = await fetch(KAMRAFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": KAMRAFY_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.recipes || [];
}

async function searchKamrafy(question) {
  if (!KAMRAFY_KEY) return null;
  const cacheKey = "kamrafy:" + question.slice(0, 60);
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const body = parseKamrafyRequest(question);
    plog("KAMRAFY", "keres: " + JSON.stringify(body).slice(0, 120));

    // 1. Próbálkozás az eredeti body-val
    let recipes = await kamrafyApiCall(body);

    // 2. Ha 0 találat: Ollama generál konkrét keresőkifejezést
    if (!recipes.length) {
      plog("KAMRAFY", "0 talalat, Ollama query-t general...");
      const ollamaRaw = await askOllama([
        { role: "system", content: "Felad: a kérdésből kinyerni 1-3 rövid magyar ételnevet vagy alapanyagnevet, vesszővel elválasztva. CSAK az étel/alapanyag nevét írjuk, semmi egyebet! Példák: 'tojás, kenyér', 'csirkemell', 'leves, zöldség'. NE írjunk mondatot, NE adjunk magyarázatot." },
        { role: "user", content: question.replace(/padli[,!]?\s*/gi, "").trim().slice(0, 100) }
      ]);
      if (ollamaRaw) {
        // Csak rövid, reálisan étel-szerű szavakat fogadunk el
        const raw = ollamaRaw.replace(/[^a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ0-9,; -]/g, "");
        const terms = raw
          .split(/[,;\/\n]/)
          .map(s => s.trim())
          .filter(s => s.length >= 3 && s.length <= 15);
        // Minden termnél próbáljuk az eredeti szót ÉS az első szótagot is
        const toTry = [];
        for (const t of terms.slice(0, 3)) {
          toTry.push(t);
          if (t.includes(" ")) toTry.push(t.split(" ")[0]); // "csirke mell" → "csirke"
        }
        for (const term of toTry.slice(0, 5)) {
          plog("KAMRAFY", "fallback query: " + term);
          recipes = await kamrafyApiCall({ query: term, limit: 5 });
          if (recipes.length) break;
        }
      }
    }

    if (!recipes.length) return null;
    cacheSet(cacheKey, recipes);
    return recipes;
  } catch (err) {
    console.error(LOG + " Kamrafy error: " + err.message);
    return null;
  }
}

/* ── OLLAMA ─────────────────────────────────────────────── */
async function askOllama(messages) {
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL, messages, stream: false,
        options: { temperature: config.general.temperature, num_predict: config.general.maxTokens }
      }),
      signal: AbortSignal.timeout(config.general.ollamaTimeoutMs)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return applyLLMSafety(data?.message?.content?.trim() || null);
  } catch (err) {
    console.error(LOG + " Ollama error: " + err.message);
    return config.fallback.enabled ? config.fallback.message : null;
  }
}

/* ── TRIGGEREK ──────────────────────────────────────────── */
export function isDirectMention(content) {
  return BOT_NAMES.some(name => content.toLowerCase().includes(name));
}
export function isQuestion(content) { return content.trim().endsWith("?"); }

/* ── GENRE KINYERES ─────────────────────────────────────── */
function extractGenreTags(question) {
  const l = question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// 1. Statikus config genre-k - de ha van DB override, azt használja
  const found = config.genres.filter(({ genre, words }) => {
    const activeWords = dbGenreWords[genre] ? [...words, ...dbGenreWords[genre]] : words;
    return activeWords.some(w => l.includes(w));
  }).map(({ genre }) => genre);
  // 2. DB tag szavak – ha a user szava egyezik a tag szó listájával
  for (const [tagName, words] of Object.entries(dbTagWords)) {
    if (!found.map(f => f.toLowerCase()).includes(tagName.toLowerCase())) {
      if (words.some(w => l.includes(w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) {
        found.push(tagName);
        plog("TAG_WORD_MATCH", tagName + " -> " + l.slice(0,40));
      }
    }
  }

  return config.features.enableNegation ? filterNegatedGenres(question, found) : found;
}

/* ── CIM KINYERESE ──────────────────────────────────────── */
const HU_STOP = new Set([
  "es","vagy","hogy","nem","ne","van","mar","hany","hol","mikor","miert","padli",
  "reszes","epizodos","fejezetes","fejezet","epizod","resz","reszbol","all",
  "mirol","szol","ismered","ismersz","is","mi","az","ez","be","ki","le","fel",
  "meg","ra","de","ha","mert","igy","ugy","mennyi","befejezett","folyamatban",
  "tart","kiado","foszereplo","manga","anime","sorozat","season","series",
  "a","egy","el","jon","jott","volt","lesz","lett","foszereploje","fohoes",
  "szereploje","karaktere","kiadoja","hogyan","milyen","melyik","mekkora",
  "tudom","tudod","tudja","olvasni","olvashato","nezni","latni","talalni",
  "film","movie","ova","ona","special","mozi","mennyibe","mennyit","kerul",
  "fizet","fizetni","elofizetes","patreon","forint","osszeg","ar","ingyen",
  "dolgozol","tudnod","kellene","kell","mondj","valami","ajanl","javasolj",
  "olvassak","nezzek","ehhez","olyan","hasonlo","barmelyik","linket","adsz",
  "tagek","genre","mufaj","ismersz","linken","erem","gondolok","csak",
  // Érzelem / állapot szavak
  "boldog","szomoru","merges","ideges","faradt","orulsz","orulok",
  "szereted","szeretsz","tetszik","tetszett","jol","rosszul","unatkozol",
  "unatkozom","nevetsz","nevetek","baj","bajod","bajom",
  // Időhatározók
  "mostmar","mostantol","azota","regota","ujra","megint","ismet","vegre",
  // Rövid kérdőszavak amik véletlenül mangacímet találnak
  "mit","miket","miben","mihez","mivel","mire","min",
  "kit","kinek","kivel","kihez","kire","kin","kik",
  "ugye","ugyan","persze","nyilvan","igen","nos","hat",
  // Köszönések / általános megszólítások
  "szia","hello","hali","szep","jo","te","ti","mi","ok",
  // Technológia szavak amik nem mangacímek
  "internet","explorer","browser","bongeszo","hasznalsz","hasznal",
  // Társalgás szavak
  "tarsalogni","beszelgetni","csevegni","ebedrol","ebed","vacsorarol",
  "vacsorarol","reggeli","etelrol","itelrol",
  // Egyéb logból szedett false positive-ok
  "csinaltal","csinaltal","fuleket","csinaltal","kaptuk","kaptam","kaptad",
]);

function extractSearchTerm(question) {
  const cleaned = question.replace(/\bpadli\b[,]?\s*/gi, "").replace(/[?!]/g, "").trim();

  // Explicit típusmegjelölés: "manga: One Piece"
  const explicit = cleaned.match(/(?:anime|manga|manhwa|karakter|film|ova|ona)[:\s]+(.+?)$/i);
  if (explicit) return explicit[1].trim().replace(/\s*(manga|anime|film)\s*$/i, "").trim();

  // "hány részes/fejezetes a X" – teljes cím kell az "a/az" után
  const hanyMatch = cleaned.match(/(?:hany|hány)\s+(?:reszes|fejezetes|epizodos|resz|fejezet|epizod)[^\wáéíóöőúüűÁÉÍÓÖŐÚÜŰ]+(?:a|az)\s+(.+)$/i);
  if (hanyMatch) return hanyMatch[1].trim();

  // "miről szól / ismered / mesélj X"
  const aboutMatch = cleaned.match(/(?:mesélj|mi az?|mi a|ismered|miről szól)[^\wáéíóöőúüűÁÉÍÓÖŐÚÜŰ]+([A-ZÁÉÍÓÖŐÚÜŰ][^\s!,]{1,}(?:\s[^\s!,]{1,}){0,5})/);
  if (aboutMatch) return aboutMatch[1].replace(/\s*(manga|anime)\s*$/i, "").trim();

  // Többszavas nagybetűs cím
  const MULTI_EXCLUDE = new Set(["Padli","Szia","Igen","Nem","Van","Hany","Hol","Te","Ti",
    "Ez","Az","Internet","Ugye","Persze","Most","Boldog","Baj","Ebed","Vacsora",
    "Szomoru","Faradt","Merges","Tarsalogni","Csinaltal"]);
  const multi = cleaned.match(/([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ0-9\-]{1,}(?:\s(?:of|the|to|a|an|no|wa|ga|de|or|and|on|in|SSS|[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ0-9\-]{1,})){1,6})/);
  if (multi && !MULTI_EXCLUDE.has(multi[1].split(" ")[0]))
    return multi[1].replace(/\s*(manga|anime)\s*$/i, "").trim();

  // Token alapú fallback – min 3 karakter, stop szavak kiszűrve
  const tokens = cleaned.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/).filter(w => w.length >= 3 && !HU_STOP.has(w));
  if (tokens.length > 0) return tokens.slice(0, 4).join(" ");
  return null;
}

/* ── KONTEXTUS ──────────────────────────────────────────── */
function buildContext(local, anilist, jikan, mangadex, kitsu, shikimori) {
  let ctx = "";
  if (local) {
    const chaps = local.chapter_count > 0
      ? local.chapter_count + " fejezet olvasható nálunk"
      : "szerepel nálunk de nincs feltöltött fejezet";
    const score = local.average_score ? " | értékelés: " + (local.average_score / 10).toFixed(1) + "/10" : "";
    ctx += "\n[FONTOS – PadliDB (SAJÁT OLDALUNK): \"" + local.title + "\" MEGVAN – " + chaps + score + "]";
  }
  const aniItem = anilist?.anime || anilist?.manga;
  if (aniItem) {
    const type = anilist?.anime ? "anime" : "manga";
    const title = aniItem.title?.english || aniItem.title?.romaji;
    const score = aniItem.averageScore ? (aniItem.averageScore / 10).toFixed(1) + "/10" : "ismeretlen";
    const format = aniItem.format ? " [" + aniItem.format + "]" : "";
    const count = aniItem.episodes
      ? "Epizódok száma: " + aniItem.episodes
      : aniItem.chapters
        ? "Fejezetek száma: " + aniItem.chapters
        : "fejezetek száma ismeretlen";
    const status = aniItem.status === "FINISHED" ? "befejezett" : aniItem.status === "RELEASING" ? "folyamatban" : (aniItem.status || "");
    const genres = (aniItem.genres || []).slice(0, 4).join(", ");
    const desc = (aniItem.description || "").replace(/<[^>]*>/g, "").substring(0, 150);
    ctx += "\n[AniList: " + type + format + " – \"" + title + "\" | Pontszám: " + score + " | " + count + " | Állapot: " + status + " | Műfaj: " + genres + " | " + desc + "]";
  }
  if (jikan)     ctx += "\n[MAL: " + jikan.type + " – \"" + jikan.title + "\" | Pontszám: " + jikan.score + " | " + jikan.count + " | " + jikan.status + "]";
  if (mangadex)  ctx += "\n[MangaDex: \"" + mangadex.title + "\" | " + mangadex.status + " | " + mangadex.chap + " | Műfaj: " + mangadex.genres + "]";
  if (kitsu)     ctx += "\n[Kitsu: \"" + kitsu.title + "\" | Pontszám: " + kitsu.score + " | " + kitsu.count + "]";
  if (shikimori) ctx += "\n[Shikimori: \"" + shikimori.title + "\" | Pontszám: " + shikimori.score + " | " + shikimori.count + "]";
  return ctx;
}

/* ── HISTORY ────────────────────────────────────────────── */
function buildHistory(conversationHistory, searchTerm) {
  const history = [];
  const recent = conversationHistory.slice(-config.context.contextWindow);
  for (const m of recent) {
    if (m.author === "Padli") {
      // Padli válaszát csak akkor vesszük be ha:
      // 1. Kapcsolódik az aktuális témához
      // 2. NEM tartalmazza az eredeti kérdés szövegét (self-echo szűrés)
      const firstWord = searchTerm?.toLowerCase().split(" ")[0];
      const isRelated = !searchTerm || !firstWord || m.content.toLowerCase().includes(firstWord);
      // Max 80 karakter, és ne legyen benne kérdőjel (ne vegyük be a visszakérdezéseket)
      const isClean = m.content.length < 200 && !m.content.startsWith(m.content.slice(0, 20));
      if (isRelated && isClean) {
        history.push({ role: "assistant", content: m.content.slice(0, 150) });
      }
    } else {
      const uc = m.content.replace(/padli[,]?\s*/gi, "").trim();
      // Csak rövid, értelmes user üzeneteket veszünk be
      if (uc.length > 1 && uc.length < 150) {
        history.push({ role: "user", content: uc });
      }
    }
  }
  return history.slice(-4); // max 4 üzenet a history-ban
}

/* ── VALASZ GENERAAS ────────────────────────────────────── */
async function generateReply(question, conversationHistory, userKey) {
  conversationHistory = conversationHistory || [];
  userKey = userKey || null;

  // DB config betöltés (cache-elt, 5 percenként frissül)
  await loadDbConfig();

  const { scores } = scoreIntents(question);
  const intent = resolveIntent(scores);
  plog("INTENT", "-> " + (intent || "search"));
  trackAnalytics("intent", intent || "search");

  if (intent === "adult") {
    plog("ADULT", "ollamanak atadva lazan");
    padliLog({ event: "adult_soft", query: question });
    return await askOllama([
      { role: "system", content: getSystemPrompt() },
      { role: "user", content: "Reagalj erre termeszetesen es lazan, 1-2 mondatban magyarul: " +
        question.replace(/padli[,]?\s*/gi,"").trim() +
        "\n[Ha valami felnottos vagy pikans temajú kerdes, reagalj humorosan, NE mondd hogy nem tudsz segiteni. Ha lehet, tereld manga/anime temara.]" }
    ]);
  }

  if (intent === "patreon") {
    plog("PATREON", "fix valasz");
    padliLog({ event: "patreon_question", query: question });
    return config.fixedReplies.patreon
      .replace("{price}", config.bot.patreonPriceText)
      .replace("{url}", config.bot.patreonUrl);
  }

  if (intent === "dbInfo") {
    plog("DB_INFO", "adatbazis info");
    padliLog({ event: "db_info_question", query: question });
    const l = question.toLowerCase();
    if (config.dbInfoTriggers.tags.some(w => l.includes(w))) {
      const tags = await getDBTags();
      if (tags) return "Nalunk a fobb mufajok: " + tags.genres.slice(0, 8).join(", ") + ". Tagek: " + tags.tags.slice(0, 8).join(", ") + ".";
    }
    const stats = await getDBStats();
    if (stats) return "Az oldalon jelenleg " + stats.total + " manga/manhwa/manhua szerepel, ebbol " + stats.with_chapters + " olvashato fejezettel.";
    return getRandomItem(config.fixedReplies.noData);
  }

  let searchTerm = extractSearchTerm(question);
  if (searchTerm) {
    searchTerm = expandWithSynonyms(searchTerm);
    const resolved = resolveAlias(searchTerm);
    if (resolved !== searchTerm) {
      plog("ALIAS", searchTerm + " -> " + resolved);
      padliLog({ event: "alias_resolved", original: searchTerm, resolved });
      searchTerm = resolved;
    }
  }

  const availabilityQ = intent === "availability";
  const mediaType = detectMediaType(question);

  if (!searchTerm) {
     const refWords = ["hány részes","hány epizód","hány fejezet","főszereplő","miről szól",
  "mikor jön","befejezett","és az","és a","ki írta","és hány","az is",
  "mesel","mesélj","mesélj még","mesélj róla","mondjal","mondjal még",
  "mire képes","mit tud","ki ez","ki ő","ő is","róla","belőle","erről"];    
    if (refWords.some(w => question.toLowerCase().includes(w))) {
      const remembered = getTopicMemory(userKey);
      if (remembered) {
        searchTerm = remembered;
        // Ha a remembered érték egy saját karakter neve, jelöljük meg
        const isRememberedChar = dbCharacters.some(c =>
          c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .includes(remembered.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""))
        );
        if (isRememberedChar) {
          // Karakter kérdés triggerelése topic memory-ból
          const norm = remembered.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
          const dbChar = dbCharacters.find(c => {
            const cNorm = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
            return cNorm.includes(norm) || norm.includes(cNorm);
          });
          if (dbChar) {
            const stories = (dbChar.stories || []).slice(0, 2).map(s => s.title + ": " + s.content.slice(0, 150)).join(" | ");
            const charCtx = "[SAJÁT KÖZÖSSÉGI KARAKTER: \"" + dbChar.name + "\" - " + (dbChar.description || "") +
              (dbChar.personality ? " | Személyiség: " + dbChar.personality : "") +
              (stories ? " | Történetek: " + stories : "") + "]";
            return await askOllama([
              { role: "system", content: getSystemPrompt() },
              { role: "user", content: "Válaszolj magyarul, 1-2 mondatban: " + question + "\n" + charCtx }
            ]);
          }
        }

        const age = Math.round((Date.now() - (topicMemory.get(userKey)?.ts || 0)) / 1000);
        plog("TOPIC_MEMORY", searchTerm + " (" + age + "mp regebbi)");
        padliLog({ event: "topic_memory_hit", searchTerm, age });
      } else {
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
          const t = extractSearchTerm(conversationHistory[i].content);
          if (t && t.length > 2 && t.toLowerCase() !== "padli") {
            searchTerm = resolveAlias(t);
            plog("HISTORY_FALLBACK", searchTerm);
            padliLog({ event: "history_fallback", searchTerm });
            break;
          }
        }
      }
    }
  }

  plog("SEARCH", "\"" + searchTerm + "\" | tipus: " + mediaType + " | intent: " + (intent || "search"));
  padliLog({ event: "search_start", query: question, searchTerm, mediaType, intent: intent || "search" });
  if (searchTerm) { trackAnalytics("query", searchTerm); setTopicMemory(userKey, searchTerm); }

  // ── KAMRAFY RECEPT ──────────────────────────────────────
  if (isRecipeQuestion(question)) {
    plog("KAMRAFY", "recept kérdés: " + question.slice(0, 60));
    const recipes = await searchKamrafy(question);
    if (recipes && recipes.length) {
      const top = recipes.slice(0, 2);
      const recipeCtx = top.map((r, i) => {
        const time = r.total_time ? r.total_time + " perc" : (r.prep_time || r.cook_time ? ((r.prep_time||0)+(r.cook_time||0)) + " perc" : null);
        const parts = [
          "Cím: " + r.title,
          time ? "Idő: " + time : null,
          r.calories_per_serving ? "Kalória: " + r.calories_per_serving + " kcal/adag" : null,
          r.difficulty ? "Nehézség: " + r.difficulty : null,
          r.description ? "Leírás: " + r.description.slice(0, 100) : null,
          "Link: " + r.url,
        ].filter(Boolean);
        return (i+1) + ". recept:\n" + parts.join("\n");
      }).join("\n\n");

      const ollamaReply = await askOllama([
        { role: "system", content: "Te Padli vagy, a PadlizsanFanSub manga/anime közösségi bot. Ha receptet kérnek, ajánlasz 1-2 ételt a Kamrafy.hu-ról barátságosan, magyarul. Az ajánlásban mindig szerepeljen a recept neve és a kamrafy.hu link." },
        { role: "user", content: "A kérdés: \"" + question.replace(/padli[,!]?\s*/gi,"").trim() + "\"\n\nEzek a Kamrafy.hu receptjei:\n" + recipeCtx + "\n\nAjánld be őket 2-4 mondatban, és minden receptnél add meg a linket!" }
      ]);

      // Garantáljuk hogy a linkek benne vannak, ha Ollama kihagyta
      let reply = ollamaReply || "";
      top.forEach(r => {
        if (r.url && !reply.includes(r.url)) {
          reply += "\n" + r.title + ": " + r.url;
        }
      });
      return reply;
    }
    return "Sajnos most nem találok megfelelő receptet a Kamrafy.hu adatbázisában – próbálj pontosabban fogalmazni (pl. írd le mi van otthon, vagy milyen ételt szeretnél)!";
  }

  if (availabilityQ && searchTerm) {
    plog("AVAILABILITY", "\"" + searchTerm + "\"");
    const local = await searchLocalDBFuzzy(searchTerm);
    if (local) {
      plog("AVAILABILITY", "megtalalt: " + local.title);
      const chaps = local.chapter_count > 0 ? local.chapter_count + " fejezet van feltoltve" : "de meg nincs feltoltve fejezet";
      const score = local.average_score ? " (" + (local.average_score / 10).toFixed(1) + "/10)" : "";
      const tpl = getRandomItem(config.fixedReplies.found);
      return fillTemplate(tpl, { title: local.title, chaps: chaps + score }) ||
        "Igen, a \"" + local.title + "\" megvan nalunk – " + chaps + score + "! \uD83D\uDCD6";
    }
    plog("AVAILABILITY", "nem talalhato: " + searchTerm);
    const tpl = getRandomItem(config.fixedReplies.notFound);
    return fillTemplate(tpl, { term: searchTerm }) || "Sajnos a \"" + searchTerm + "\" nincs meg nalunk.";
  }

  if (intent === "recommendation" && !isRecipeQuestion(question)) {
    const genres = extractGenreTags(question);
    plog("RECOMMEND", "genre-k: [" + (genres.join(",") || "nincs") + "]");
    padliLog({ event: "recommendation_question", query: question, genres });
    if (genres.length > 0) {
      const recs = await searchLocalByGenreTag(genres);
      if (recs && recs.length > 0) {
        const filtered = config.recommendation.avoidRepeats ? recs.filter(r => !recommendedTitles.has(r.title)) : recs;
        const maxRes = getCfg("maxResults", config.recommendation.maxResults);
        const toShow = (filtered.length > 0 ? filtered : recs).slice(0, maxRes);
        toShow.forEach(r => recommendedTitles.add(r.title));
        plog("RECOMMEND", toShow.length + " talalat: " + toShow.map(r => r.title).join(", "));
        const list = toShow.map(r => {
          const s = r.average_score ? " (" + (r.average_score / 10).toFixed(1) + "/10)" : "";
          const c = r.chapter_count > 0 ? ", " + r.chapter_count + " fejezet" : "";
          return "\"" + r.title + "\"" + s + c;
        }).join(", ");
        // Visszaadja a listát – az Ollama NEM kap szerepet ebben, direktben adjuk vissza
        return "Nálunk elérhető " + genres[0] + " manhwa/manga: " + list + " \uD83D\uDCD6";
      }
    }
    // Ha nincs genre találat: kérdezzük meg melyik genre-t keresi pontosabban
    // NE adjunk random mangát ami nem illik a genre-hez
    if (genres.length > 0) {
      return "Sajnos " + genres[0] + " kategóriában most nem találok nálunk olvasható mangát. Próbálj más műfajt, vagy kérdezz rá egy konkrét címre!";
    }
    // Ha genre sem volt: random ajánlás a DB-ből
    try {
      const { rows } = await dbPool.query(
        "SELECT m.title, m.average_score, COUNT(DISTINCT c.id) AS chapter_count " +
        "FROM manga m LEFT JOIN chapter c ON c.manga_id = m.id " +
        "GROUP BY m.id HAVING COUNT(DISTINCT c.id) > 0 ORDER BY m.average_score DESC NULLS LAST LIMIT 5"
      );
      if (rows.length > 0) {
        const list = rows.map(r => "\"" + r.title + "\"" + (r.average_score ? " (" + (r.average_score / 10).toFixed(1) + "/10)" : "")).join(", ");
        return "Nálunk a legjobban értékelt sorozatok: " + list + " \uD83D\uDCD6";
      }
    } catch {}
    return "Mondd meg milyen műfajt keresel és megpróbálom megtalálni nálunk!";
  }

  if (!searchTerm) {
    plog("NO_TERM", "nincs keresesi kifejezes");

    const qNormLower = normalizeQuery(question) || "";

    // Ha Padliról magáról kérdeznek (érzések, frissítés, hogy van stb.)
    const isPadliSelfQ = [
      "boldog","szomoru","faradt","ideges","merges","hogy vagy","mi ujsag",
      "kaptál","frissitett","frissítés","orulsz","örülsz","mit tudsz",
      "mit csinalsz","te vagy","ki vagy","magadrol","ujitottak","fejlesztett",
      "unatkozol","nevetsz","szeretsz","tetszik","baj vagy","internet explorer",
      "hasznalsz","ugye","igaze","biztos"
    ].some(w => qNormLower.includes(normalizeQuery(w) || w));

    if (isPadliSelfQ) {
      plog("PADLI_SELF", "magáról kérdeznek");
      return await askOllama([
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: "Válaszolj magyarul, lazán és személyesen erre: " +
          question.replace(/padli[,]?\s*/gi,"").trim() +
          "\n[Ez rólad szól. Te Padli vagy, a PadlizsanFanSub manga/anime bot. Reagálj természetesen, 1-2 mondatban. NE emlegesd Gokut, Petőfit vagy más karaktert hacsak nem kérdeznek róluk konkrétan.]" }
      ]);
    }

    // Általános off-topic / csevegés – history NÉLKÜL küldünk, hogy ne szivárogjon be
    // előző karakter/manga kontextus
    return await askOllama([
      { role: "system", content: getSystemPrompt() },
      { role: "user", content: "Reagálj természetesen és barátságosan erre az üzenetre, 1-2 mondatban magyarul: " +
        question.replace(/padli[,]?\s*/gi,"").trim().slice(0, 80) +
        "\n[NE idézd vissza amit a user írt. NE emlegesd Gokut, Petőfit vagy más karaktert. Ha hülyéskedik, hülyéskedj vissza. Ha off-topic, lazán tereld manga/anime felé.]" }
    ]);
  }
// ── KARAKTER KÉRDÉS DETEKTÁLÁS ──────────────────────────
  const charTriggers = ["ki az","ki ez","ki a","ki volt","mesélj","mondjal","tudod ki","ismered","karakter","szereplő","főhős","protagonista"];
  const isCharQuestion = charTriggers.some(w => question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").includes(w.normalize("NFD").replace(/[\u0300-\u036f]/g,"")));

  if (isCharQuestion && searchTerm) {
    // 1. Saját DB karakterek közt keresünk (fuzzy, részleges egyezés)
    const norm = searchTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const dbChar = dbCharacters.find(c => {
      const cNorm = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      return cNorm.includes(norm) || norm.includes(cNorm) || norm.split(" ").some(w => w.length > 2 && cNorm.includes(w));
    });

    if (dbChar) {
        plog("CHAR_DB", "talalat: " + dbChar.name);
      padliLog({ event: "char_db_hit", name: dbChar.name, query: question });
      // Topic memory-ba a karakter neve kerül, hogy a következő kérdés is rátaláljon
      if (userKey) setTopicMemory(userKey, dbChar.name);

      const stories = (dbChar.stories || []).slice(0, 2).map(s => s.title + ": " + s.content.slice(0, 150)).join(" | ");
      const charCtx = "[SAJÁT KÖZÖSSÉGI KARAKTER: \"" + dbChar.name + "\"-" + (dbChar.description || "") +
        (dbChar.personality ? " | Személyiség: " + dbChar.personality : "") +
        (stories ? " | Történetek: " + stories : "") + "]";
      return await askOllama([
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: "Válaszolj magyarul, 1-2 mondatban: " + question + "\n" + charCtx }
      ]);
    }

    // 2. Ha nincs saját DB-ben → AniList karakter keresés
    plog("CHAR_ANILIST", "keresem: " + searchTerm);
    const aniChar = await searchAniListCharacter(searchTerm);
    if (aniChar) {
      padliLog({ event: "char_anilist_hit", name: aniChar.name, query: question });
      const mediaStr = aniChar.media.length ? " | Megjelenik: " + aniChar.media.join(", ") : "";
      const charCtx = "[AniList karakter: \"" + aniChar.name + "\" - " + aniChar.description + mediaStr + "]";
      return await askOllama([
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: "Válaszolj magyarul, 1-2 mondatban: " + question + "\n" + charCtx }
      ]);
    }
  }
  plog("API_SEARCH", "\"" + searchTerm + "\" | tipus: " + mediaType);
  const [localResult, anilistResult] = await Promise.all([
    searchLocalDBFuzzy(searchTerm),
    searchAniList(searchTerm, mediaType)
  ]);
  const [jikanResult, mangadexResult, kitsuResult, shikimoriResult] = await Promise.all([
    searchJikan(searchTerm, mediaType),
    mediaType === "manga" ? searchMangaDex(searchTerm) : Promise.resolve(null),
    searchKitsu(searchTerm, mediaType),
    searchShikimori(searchTerm)
  ]);

  const logFinds = [];
  if (localResult) logFinds.push({ source: "PadliDB", title: localResult.title, id: localResult.slug, chapters: String(localResult.chapter_count) });
  const aniItem = anilistResult?.anime || anilistResult?.manga;
  if (aniItem) logFinds.push({ source: "AniList", type: anilistResult?.anime ? "anime" : "manga", title: aniItem.title?.english || aniItem.title?.romaji, id: aniItem.id || null, chapters: aniItem.chapters || null, episodes: aniItem.episodes || null });
  if (jikanResult)     logFinds.push({ source: "MAL",       title: jikanResult.title,    id: jikanResult.mal_id });
  if (mangadexResult)  logFinds.push({ source: "MangaDex",  title: mangadexResult.title });
  if (kitsuResult)     logFinds.push({ source: "Kitsu",     title: kitsuResult.title });
  if (shikimoriResult) logFinds.push({ source: "Shikimori", title: shikimoriResult.title });

  plog("API_RESULT", "DB:" + !!localResult + " | AL:" + !!(anilistResult?.anime || anilistResult?.manga) + " | MAL:" + !!jikanResult + " | MD:" + !!mangadexResult + " | KT:" + !!kitsuResult + " | SH:" + !!shikimoriResult);
  padliLog({ event: "search_result", searchTerm, mediaType, found: logFinds.length > 0, results: logFinds });

  let contextStr = buildContext(localResult, anilistResult, jikanResult, mangadexResult, kitsuResult, shikimoriResult);
  if (!contextStr) {
    trackAnalytics("miss", searchTerm);
    padliLog({ event: "no_data", searchTerm });
    contextStr = "\n[A keresők nem találtak eredményt erre: \"" + searchTerm + "\". " +
      "NE találj ki adatokat. NE ismételd vissza amit a user írt. " +
      "Kérdezz rá lazán hogy pontosítsa – más cím vagy műfaj. Csak 1 mondat.]";
  }

  const history = buildHistory(conversationHistory, searchTerm);
  const msgs = [{ role: "system", content: getSystemPrompt() }, ...history];
  // Az adatokat expliciten adjuk meg, ne találjon ki semmit
  const cleanQ = "Az alábbi adatok alapján válaszolj magyarul, maximum 2 rövid mondatban. " +
    "Csak a megadott adatokat használd, ne találj ki semmit. " +
    "Ha PadliDB adat van, emeld ki hogy nálunk megvan." +
    contextStr;
  if (msgs[msgs.length - 1]?.role === "user") msgs[msgs.length - 1].content = cleanQ;
  else msgs.push({ role: "user", content: cleanQ });

  return await askOllama(msgs);
}

/* ── UZENET KULDES ──────────────────────────────────────── */
async function sendPadliMessage(reply, broadcastFn) {
  if (!reply) return;
  reply = applyLLMSafety(reply);
  if (!reply) return;
  const timestamp = Date.now();
  broadcastFn({ type: "message", source: "web", author: "Padli", displayName: "Padli", authorId: null, avatar: "/assets/favico.png", content: reply, timestamp });
  try { await dbPool.query("INSERT INTO chat_messages(source,author,author_id,avatar,content) VALUES('web','Padli',NULL,'/assets/favico.png',$1)", [reply]); } catch {}
  try { await sendToDiscord("Padli", reply); } catch {}
  padliLog({ event: "reply_sent", reply: reply.substring(0, 200) });
  console.log(LOG + " Padli: " + reply.substring(0, 80));
}

/* ── FO HANDLER ─────────────────────────────────────────── */
const recentMessages  = [];
const pendingTimers   = new Map();
const lastReplyTime   = new Map();
const mutedUsers      = new Map();
const lastUserMsg     = new Map();
const processingUsers = new Set();

export async function handleChatMessageForAI(msg, broadcastFn) {
  const { content: rawContent, author, source } = msg;
  if (author === "Padli") return;

  const content = sanitizeInput(rawContent);
  if (!content) return;

  if (isDirectMention(content)) {
    const edgeReply = checkEdgeCase(content);
    if (edgeReply) { await sendPadliMessage(edgeReply, broadcastFn); return; }
  }

  recentMessages.push({ content, author, source: source || "web" });
  if (recentMessages.length > config.context.maxMessages) recentMessages.shift();

  if (pendingTimers.size > 0) {
    for (const t of pendingTimers.values()) clearTimeout(t);
    pendingTimers.clear();
  }

  if (!isDirectMention(content) && !isQuestion(content)) return;

  const userKey = (source || "web") + ":" + author;

  if (mutedUsers.has(userKey) && Date.now() < mutedUsers.get(userKey)) {
    console.log(LOG + " Mute: " + author); return;
  } else { mutedUsers.delete(userKey); }

  const lastMsg = lastUserMsg.get(userKey);
  if (lastMsg && lastMsg.content === content && Date.now() - lastMsg.ts < config.antiSpam.duplicateWindowMs) {
    console.log(LOG + " Duplikat: " + author); return;
  }
  lastUserMsg.set(userKey, { content, ts: Date.now() });

  const now = Date.now();
  if (!lastReplyTime.has(userKey + "_msgs")) lastReplyTime.set(userKey + "_msgs", []);
  const msgs = lastReplyTime.get(userKey + "_msgs").filter(t => now - t < 60000);
  msgs.push(now); lastReplyTime.set(userKey + "_msgs", msgs);
  if (msgs.length > config.antiSpam.maxMessagesPerMinute) {
    console.log(LOG + " Rate limit -> mute: " + author);
    mutedUsers.set(userKey, now + config.antiSpam.muteDurationMs);
    return;
  }

  if (now - (lastReplyTime.get(userKey) || 0) < config.antiSpam.spamCooldownMs) {
    console.log(LOG + " Cooldown: " + author); return;
  }

  const isOffTopic = !config.mangaAnimeKeywords.some(w => content.toLowerCase().includes(w));

  if (isDirectMention(content)) {
    if (isOffTopic) {
      padliLog({ event: "offtopic", query: content, author });
      // Off-topic: ne fix szöveg, hanem az Ollama lazán reagál
      const offReply = await askOllama([
        { role: "system", content: getSystemPrompt() + "\nHa nem manga/anime témáról kérdeznek: lazán reagálj, hülyéskedj ha kell, tereld vissza a témára. NE ismételd vissza amit a user írt. Max 1-2 mondat." },
        { role: "user", content: "Reagálj erre természetesen és lazán, NE idézd vissza: " + content.replace(/padli[,]?\s*/gi,"").trim() }
      ]);
      if (offReply) { await sendPadliMessage(offReply, broadcastFn); lastReplyTime.set(userKey, Date.now()); }
      return;
    }
    processingUsers.add(userKey);
    try {
      plog("HANDLER", "kozvetlen megszolitas: " + author);
      padliLog({ event: "direct_mention", author, query: content.slice(0, 80) });
      const reply = await generateReply(content, [...recentMessages], userKey);
      if (reply) { await sendPadliMessage(reply, broadcastFn); lastReplyTime.set(userKey, Date.now()); }
    } finally { processingUsers.delete(userKey); }
    return;
  }

  // Kérdőjeles üzenet VAGY manga témájú üzenet → 15mp várakozás
  if (isQuestion(content) || !isOffTopic) {
    if (isOffTopic) return;
    plog("HANDLER", "kerdes/tema, " + config.replyDelay.questionMs / 1000 + "mp varakozas");
    const timerId = Symbol();
    const snapshot = [...recentMessages];
    const timer = setTimeout(async () => {
      pendingTimers.delete(timerId);
      const reply = await generateReply(content, snapshot, null);
      if (reply) await sendPadliMessage(reply, broadcastFn);
    }, config.replyDelay.questionMs);
    pendingTimers.set(timerId, timer);
  }
}
