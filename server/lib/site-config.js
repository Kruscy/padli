/* ── Oldal-beállítások (white-label) ───────────────────────────
   Az oldal neve, címe, tulajdonosa stb. egy helyen. Forrás (erősebb
   felülírja a gyengébbet): beépített alapérték < környezeti változó <
   site_settings tábla (a telepítő varázsló és az admin felület írja).

   getSite() szinkron, a memóriában tartott értékeket adja; az adatbázist
   loadSiteSettings() olvassa be (induláskor és mentés után). ── */
import { pool } from "../db.js";

// Az eredeti oldal értékei: a HTML-sablonokban ezek szerepelnek, a
// kiszolgáláskor ezeket cseréljük a beállítottakra (lásd brandHtml)
export const DEFAULT_SITE = Object.freeze({
  name: "PadlizsanFanSub",
  url: "https://padlizsanfansub.hu",
  patreonUrl: "https://patreon.com/Padlizsanfansub",
});

const KEYS = ["name", "url", "patreonUrl", "ownerUserId", "description"];

function fromEnv() {
  const env = process.env;
  return {
    name: env.SITE_NAME || DEFAULT_SITE.name,
    url: env.SITE_URL || env.BASE_URL || DEFAULT_SITE.url,
    // Az eredeti oldal Patreonja csak az eredeti címmel jár együtt
    patreonUrl: env.PATREON_URL ?? null,
    ownerUserId: env.OWNER_USER_ID || null,
    description: env.SITE_DESCRIPTION || "",
  };
}

let dbValues = {};

function normalize(site) {
  const url = String(site.url || DEFAULT_SITE.url).trim().replace(/\/+$/, "");
  const patreonUrl = site.patreonUrl ?? (url === DEFAULT_SITE.url ? DEFAULT_SITE.patreonUrl : "");
  const owner = Number(site.ownerUserId);
  return {
    name: String(site.name || DEFAULT_SITE.name).trim(),
    url,
    host: (() => { try { return new URL(url).host; } catch { return ""; } })(),
    patreonUrl: String(patreonUrl || "").trim(),
    ownerUserId: Number.isInteger(owner) && owner > 0 ? owner : null,
    description: String(site.description || ""),
  };
}

export function getSite() {
  return normalize({ ...fromEnv(), ...dbValues });
}

// A tulajdonosi fiók (kézi scan, biztonsági napló, értesítések). Nincs
// alapértelmezése: egy friss telepítésen nem kaphatja meg véletlenül egy
// tetszőleges azonosítójú felhasználó.
export function getOwnerUserId() {
  return getSite().ownerUserId;
}
export function isOwner(userId) {
  const owner = getOwnerUserId();
  return owner != null && Number(userId) === owner;
}

export async function loadSiteSettings() {
  try {
    const { rows } = await pool.query(`SELECT key, value FROM site_settings`);
    dbValues = Object.fromEntries(rows.filter(r => KEYS.includes(r.key) && r.value != null).map(r => [r.key, r.value]));
  } catch (err) {
    // Régi adatbázis (a tábla még nincs meg): marad a környezeti beállítás
    if (err.code !== "42P01") console.error("[site] beállítások betöltése:", err.message);
  }
  return getSite();
}

export async function saveSiteSettings(values, db = pool) {
  for (const [key, value] of Object.entries(values)) {
    if (!KEYS.includes(key)) continue;
    await db.query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value == null ? null : String(value)]
    );
  }
  return loadSiteSettings();
}

// Csak a nyilvánosan is látható értékek (a frontend / HTML-meta kapja)
export function publicSite() {
  const { name, url, patreonUrl, description } = getSite();
  return { name, url, patreonUrl, description };
}

/* ── Márkacsere ────────────────────────────────────────────────
   A HTML-oldalak, e-mail-sablonok és a generált blog az eredeti oldal
   nevét / címét tartalmazzák. Kiszolgáláskor (és levélküldéskor) ezeket a
   beállított értékekre cseréljük — az eredeti telepítésen (alapértékek)
   a szöveg változatlan marad. ── */
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DEFAULT_HOST = new URL(DEFAULT_SITE.url).host;
const PATREON_RE = /https?:\/\/(?:www\.)?patreon\.com\/Padlizsanfansub\b/gi;
const URL_RE = /https?:\/\/(?:www\.)?padlizsanfansub\.hu/gi;
const HOST_RE = /\b(?:www\.)?padlizsanfansub\.hu\b/gi;
const NAME_RE = /Padlizs[aá]n[ -]?Fan[Ss]ub(?:\.hu)?|Padlizs[aá]nfansub/gi;

export function isDefaultBrand(site = getSite()) {
  return site.name === DEFAULT_SITE.name && site.url === DEFAULT_SITE.url && site.patreonUrl === DEFAULT_SITE.patreonUrl;
}

export function brand(text, { html = true } = {}) {
  const site = getSite();
  if (text == null || isDefaultBrand(site)) return text;
  const esc = html ? escHtml : (s => s);
  return String(text)
    .replace(PATREON_RE, () => esc(site.patreonUrl || site.url))
    .replace(URL_RE, () => esc(site.url))
    .replace(HOST_RE, () => esc(site.host || DEFAULT_HOST))
    .replace(NAME_RE, () => esc(site.name));
}
