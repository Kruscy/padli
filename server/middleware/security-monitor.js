import { getClientIp } from "../lib/client-ip.js";
import { logSecurityEvent, isIpBlocked } from "../lib/security-log.js";

/* ── Biztonsági figyelő (a kérések legelején fut) ─────────────
   1. IP-tiltólista (ip_blocks tábla, admin felületről kezelhető)
   2. Sebezhetőség-kereső kérések (.env, wp-admin, .git, ../ stb.) →
      napló + azonnali 404 (a weboldalon ilyen útvonal nincs)
   3. Válasz után: 429 (korlátba futás), 403 admin útvonalon (admin-
      próbálgatás), tömeges írás (spam), kérés-áradat (DoS).
   A tömeges írás és a kérés-áradat alapból CSAK NAPLÓZ — a
   SECURITY_ENFORCE_FLOOD=1 környezeti változóval lehet élesíteni
   (akkor a küszöb fölött 429-et ad), hogy előbb lássuk a normál
   forgalom mintáját, és ne zárjunk ki valódi olvasókat. ── */

const PROBE_RE = /(^|\/)(\.env|\.git\/|\.aws\/|\.ssh\/|\.DS_Store|wp-(admin|login|content|includes|config)|xmlrpc\.php|phpmyadmin|cgi-bin\/|server-status|actuator\/|vendor\/phpunit|etc\/passwd|boaform|HNAP1|\.well-known\/security\.txt\.bak)|\.(php|asp|aspx|jsp|cgi|sql|bak|old|swp)(\?|$)|\.\.\/|%2e%2e|\$\{jndi:/i;

// Írási kérések, amik normál használatban is sűrűk lehetnek → nem számoljuk
const WRITE_EXCLUDE = /^\/api\/(uploader|progress|chat\/send|padlicrome|translate|ocr|inpaint|gemini|discord\/sync)/;
// Kérés-áradat számlálásnál kihagyott: képbetöltés (egy fejezet 60+ kép is
// lehet) és az olvasási állás (olvasás közben sűrűn mentődik; a régi
// listaoldalak — régi böngésző-cache-ből — mangánként kértek le állást).
const FLOOD_EXCLUDE = /^\/api\/(image\/|pages\/|progress(\/|$))/;

const WRITE_WINDOW_MS = 5 * 60e3;
const WRITE_LIMIT_USER = 120;   // írás / 5 perc / bejelentkezett user
const WRITE_LIMIT_IP = 300;     // írás / 5 perc / IP (több fiók egy gépről)
const FLOOD_LIMIT = 600;        // /api kérés / perc / IP
const ENFORCE_FLOOD = process.env.SECURITY_ENFORCE_FLOOD === "1";

const writeCounts = new Map();  // actor → { start, n, reported }
const floodCounts = new Map();  // ip → { start, n, reported }

function bump(map, key, windowMs) {
  const now = Date.now();
  let c = map.get(key);
  if (!c || now - c.start > windowMs) { c = { start: now, n: 0, reported: false }; map.set(key, c); }
  c.n++;
  return c;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of writeCounts) if (now - c.start > WRITE_WINDOW_MS) writeCounts.delete(k);
  for (const [k, c] of floodCounts) if (now - c.start > 60e3) floodCounts.delete(k);
}, 60e3).unref();

export function securityMonitor(req, res, next) {
  const ip = getClientIp(req);

  // 1. Tiltólista
  if (isIpBlocked(ip)) {
    logSecurityEvent({ req, type: "blocked_request", severity: "info" });
    return res.status(403).type("text").send("Forbidden");
  }

  // 2. Scanner-próbálkozás
  let decodedPath = req.path;
  try { decodedPath = decodeURIComponent(req.originalUrl || req.url); } catch {}
  if (PROBE_RE.test(req.originalUrl || "") || PROBE_RE.test(decodedPath)) {
    logSecurityEvent({ req, type: "scanner_probe", severity: "warn" });
    return res.status(404).type("text").send("Not found");
  }

  // 3a. Kérés-áradat (/api, képek nélkül)
  if (req.path.startsWith("/api/") && !FLOOD_EXCLUDE.test(req.path)) {
    const c = bump(floodCounts, ip, 60e3);
    if (c.n > FLOOD_LIMIT) {
      if (!c.reported) {
        c.reported = true;
        logSecurityEvent({ req, type: "request_flood", severity: "high", details: { count: c.n, enforced: ENFORCE_FLOOD } });
      }
      if (ENFORCE_FLOOD) return res.status(429).json({ error: "Túl sok kérés, próbáld újra később." });
    }
  }

  // 3b. Válasz utáni ellenőrzések
  res.on("finish", () => {
    const status = res.statusCode;
    const p = req.originalUrl || "";
    if (status === 429) {
      logSecurityEvent({ req, type: "rate_limited", severity: "warn" });
    } else if (status === 403 && /^\/api\/admin(\/|$)/.test(p) && req.session?.user?.role !== "admin") {
      logSecurityEvent({ req, type: "admin_probe", severity: "warn" });
    }

    const isWrite = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    if (isWrite && p.startsWith("/api/") && !WRITE_EXCLUDE.test(p)) {
      const uid = req.session?.user?.id;
      const checks = [[`ip:${ip}`, WRITE_LIMIT_IP]];
      if (uid) checks.push([`user:${uid}`, WRITE_LIMIT_USER]);
      for (const [actor, limit] of checks) {
        const c = bump(writeCounts, actor, WRITE_WINDOW_MS);
        if (c.n > limit && !c.reported) {
          c.reported = true;
          logSecurityEvent({ req, type: "write_burst", severity: "high", dedupeKey: actor,
                             details: { actor: uid && actor.startsWith("user:") ? `${req.session.user.username} (#${uid})` : actor, count: c.n, lastPath: p } });
        }
      }
    }
  });

  next();
}
