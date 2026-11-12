/* ── Külső borító-URL letöltése a saját tárhelyre (2026-11-12) ──────
   A MangaDex (és több más oldal) nem engedi a közvetlen beágyazást:
   ha a böngésző a mi oldalunkról kéri a képet, a MangaDex egy tiltó
   képet ad vissza a borító helyett. Ezért ha a szerkesztő külső
   URL-t ad meg borítónak, a szerver tölti le (Referer nélkül), WebP-re
   alakítja és az R2-re teszi (storeCover) — a DB-be a saját URL kerül.

   MangaDex-kényelem: elfogadjuk a sorozat oldalát is
   (https://mangadex.org/title/<uuid>/...) — ilyenkor az API-ból
   kérjük le a fő borító fájlnevét.

   Biztonság (SSRF): csak http(s), és a cél nem lehet belső/privát cím. ── */
import dns from "dns/promises";
import net from "net";
import { storeCover } from "./cover-image.js";

const UA = "PadlizsanFanSub/1.0 (+https://padlizsanfansub.hu)";
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export class CoverFetchError extends Error {}

/* Saját URL-ek: relatív útvonal, saját domain, R2 publikus címe. */
export function isOwnCoverUrl(url) {
  if (!url || url.startsWith("/")) return true;
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return true; }
  const own = ["padlizsanfansub.hu"];
  for (const v of [process.env.R2_PUBLIC_URL, process.env.BASE_URL, process.env.SITE_URL]) {
    try { if (v) own.push(new URL(v).hostname.toLowerCase()); } catch {}
  }
  return own.some(h => host === h || host.endsWith("." + h));
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
           (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
           (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

async function assertPublicHost(url) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new CoverFetchError("Csak http(s) borító-URL adható meg.");
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new CoverFetchError(`A borító címe nem található: ${u.hostname}`);
  if (addrs.some(a => isPrivateIp(a.address))) throw new CoverFetchError("Belső hálózati cím nem adható meg borítónak.");
}

/* MangaDex-URL-ek átírása a közvetlen képfájlra. */
async function resolveMangadex(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (host !== "mangadex.org" && host !== "www.mangadex.org" && host !== "uploads.mangadex.org") return url;

  const cover = u.pathname.match(new RegExp(`^/covers/(${UUID})/(.+)$`, "i"));
  if (cover) return `https://uploads.mangadex.org/covers/${cover[1]}/${cover[2]}`;

  const title = u.pathname.match(new RegExp(`^/title/(${UUID})`, "i"));
  if (title) {
    const r = await fetch(`https://api.mangadex.org/manga/${title[1]}?includes[]=cover_art`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new CoverFetchError(`MangaDex: a sorozat nem található (${r.status}).`);
    const j = await r.json();
    const file = j?.data?.relationships?.find(x => x.type === "cover_art")?.attributes?.fileName;
    if (!file) throw new CoverFetchError("MangaDex: ennek a sorozatnak nincs borítója.");
    return `https://uploads.mangadex.org/covers/${title[1]}/${file}`;
  }
  return url;
}

async function download(url) {
  // Átirányításokat kézzel követjük, hogy minden lépés célját ellenőrizzük.
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(url);
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "image/*" },
      redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location"), url).toString();
      continue;
    }
    if (!r.ok) throw new CoverFetchError(`A borító nem tölthető le (HTTP ${r.status}).`);
    const type = (r.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) throw new CoverFetchError("A megadott cím nem képre mutat.");
    if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) throw new CoverFetchError("A borítókép túl nagy (max 15 MB).");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new CoverFetchError("A borítókép túl nagy (max 15 MB).");
    return buf;
  }
  throw new CoverFetchError("Túl sok átirányítás a borító címén.");
}

/* Új borító-URL → saját URL. Ha nem változott vagy már saját, változatlan. */
export async function localizeCoverUrl(newUrl, currentUrl, slug) {
  const url = typeof newUrl === "string" ? newUrl.trim() : newUrl;
  if (!url || url === currentUrl || isOwnCoverUrl(url)) return url;
  let src;
  try { src = await resolveMangadex(url); }
  catch (e) { throw e instanceof CoverFetchError ? e : new CoverFetchError(`MangaDex-hiba: ${e.message}`); }
  let buf;
  try { buf = await download(src); }
  catch (e) { throw e instanceof CoverFetchError ? e : new CoverFetchError(`A borító nem tölthető le: ${e.message}`); }
  try {
    const { url: stored } = await storeCover(buf, slug);
    console.log(`[cover] külső borító letöltve: ${src} → ${stored}`);
    return stored;
  } catch (e) {
    throw new CoverFetchError(`A letöltött fájl nem feldolgozható képként: ${e.message}`);
  }
}
