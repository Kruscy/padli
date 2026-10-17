import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import fetch from "node-fetch";

/* ── Felhasználó által megadott URL-ek letöltése (SSRF ellen) ──
   A PadliCrome tetszőleges, kliens által küldött URL-t töltött le — a
   belső hálózat gépeit (192.168.x.x), a localhostot vagy a felhős
   metaadat-végpontot is. Itt csak http(s) engedélyezett, és a
   kapcsolódáskor ténylegesen használt IP-címet ellenőrizzük (a DNS-
   feloldásba építve, így DNS-rebindinggel sem kerülhető meg); minden
   átirányítást újra ellenőrzünk. ── */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
]) blocked.addSubnet(addr, prefix, "ipv6");

export function isBlockedAddress(address) {
  if (net.isIPv4(address)) return blocked.check(address, "ipv4");
  if (net.isIPv6(address)) {
    // IPv4-be ágyazott IPv6 (::ffff:a.b.c.d) → a beágyazott IPv4 számít
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find(a => isBlockedAddress(a.address));
    if (bad || !addresses.length) {
      const e = new Error("A cím nem engedélyezett (belső hálózat)");
      e.code = "EBLOCKEDADDR";
      return callback(e);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const httpAgent = new http.Agent({ lookup: guardedLookup });
const httpsAgent = new https.Agent({ lookup: guardedLookup });

export class BlockedUrlError extends Error {}

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new BlockedUrlError("Érvénytelen URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Csak http(s) URL engedélyezett");
  if (u.username || u.password) throw new BlockedUrlError("Az URL nem tartalmazhat belépési adatot");
  // IP-literálnál a Node nem hív DNS-feloldást, ezért itt kell ellenőrizni
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedAddress(host)) throw new BlockedUrlError("A cím nem engedélyezett (belső hálózat)");
  return u;
}

const MAX_REDIRECTS = 5;

// node-fetch-kompatibilis: ugyanazokat az opciókat fogadja, a válasz is
// node-fetch Response. Az átirányításokat kézzel, ellenőrizve követi.
export async function safeFetch(url, options = {}) {
  let current = checkUrl(url);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(current.href, {
      ...options,
      redirect: "manual",
      agent: u => (u.protocol === "https:" ? httpsAgent : httpAgent),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      res.body?.resume?.();
      current = checkUrl(new URL(res.headers.get("location"), current).href);
      continue;
    }
    return res;
  }
  throw new BlockedUrlError("Túl sok átirányítás");
}
