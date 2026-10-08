import { pool } from "../db.js";
import cron from "node-cron";
import dns from "dns";
import { getClientIp, isInternalIp } from "./client-ip.js";

/* ── Biztonsági eseménynapló ───────────────────────────────────
   logSecurityEvent() bárhonnan hívható (route, middleware, Discord bot).
   Támadás alatt rengeteg esemény jöhet, ezért:
     - azonos (típus, IP/actor) eseményből 10 mp-enként csak egyet írunk,
       a kihagyottak számát a következő sor details.suppressed mezője viszi;
     - másodpercenként legfeljebb 50 sort írunk összesen.
   Riasztás (Discord, DISCORD_SECURITY_CHANNEL_ID csatorna) küszöbök
   átlépésekor megy ki, kulcsonként legfeljebb 30 percenként.
   Sebezhetőség-keresésről (scanner) NEM megy azonnali riasztás — ezek
   napi tucatszám jönnek, és elnyomnák a fontos riasztásokat. Helyette:
   automatikus 24 órás IP-tiltás + reggel 9-kor napi összesítő. ── */

const DEDUPE_MS = 10_000;
const MAX_INSERTS_PER_SEC = 50;
const RETENTION_DAYS = 90;

const lastWrite = new Map();   // dedupeKey → { at, suppressed }
let secWindow = 0, secCount = 0, droppedTotal = 0;

function trimUa(ua) { return ua ? String(ua).slice(0, 300) : null; }

export function logSecurityEvent({ req = null, type, severity = "info", details = null,
                                   ip = null, userId = null, username = null, dedupeKey = null }) {
  try {
    const user = req?.session?.user;
    const row = {
      type,
      severity,
      ip: ip || (req ? getClientIp(req) : null),
      country: req?.headers?.["cf-ipcountry"] || null,
      user_id: userId ?? user?.id ?? null,
      username: username ?? user?.username ?? null,
      method: req?.method || null,
      path: req ? String(req.originalUrl || req.url || "").slice(0, 500) : null,
      user_agent: trimUa(req?.headers?.["user-agent"]),
      details: details ? { ...details } : null,
    };

    // Ismétlődés-szűrés
    const key = `${type}|${dedupeKey ?? row.ip ?? row.user_id ?? ""}`;
    const now = Date.now();
    const prev = lastWrite.get(key);
    if (prev && now - prev.at < DEDUPE_MS) { prev.suppressed++; trackForAlert(row); return; }
    if (prev?.suppressed) row.details = { ...(row.details || {}), suppressed: prev.suppressed };
    lastWrite.set(key, { at: now, suppressed: 0 });

    // Globális írási plafon
    const sec = Math.floor(now / 1000);
    if (sec !== secWindow) { secWindow = sec; secCount = 0; }
    if (++secCount > MAX_INSERTS_PER_SEC) { droppedTotal++; trackForAlert(row); return; }

    pool.query(
      `INSERT INTO security_events (type, severity, ip, country, user_id, username, method, path, user_agent, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.type, row.severity, row.ip, row.country, row.user_id, row.username, row.method, row.path, row.user_agent,
       row.details ? JSON.stringify(row.details) : null]
    ).catch(err => console.error("[security] naplózási hiba:", err.message));

    if (row.severity !== "info") {
      console.warn(`[security] ${row.severity.toUpperCase()} ${row.type} ip=${row.ip} user=${row.username ?? "-"} ${row.path ?? ""}`);
    }
    trackForAlert(row);
  } catch (err) {
    console.error("[security] logSecurityEvent hiba:", err.message);
  }
}

/* ── Riasztási szabályok ───────────────────────────────────────
   key: miből számolunk; limit/windowMs: hány esemény mennyi idő alatt. */
const RULES = [
  { type: "login_failed",   key: r => `ip:${r.ip}`,               limit: 10,  windowMs: 10 * 60e3, msg: r => `Sok sikertelen belépés egy IP-ről: **${r.ip}** (${r.country ?? "?"})` },
  { type: "login_failed",   key: r => `acct:${r.details?.login}`, limit: 8,   windowMs: 10 * 60e3, msg: r => `Egy fiókra sok sikertelen belépés (több IP-ről is lehet): **${r.details?.login}**` },
  { type: "login_failed",   key: () => "global",                   limit: 60,  windowMs: 10 * 60e3, msg: () => `Sok sikertelen belépés összesen (elosztott próbálkozás?)` },
  { type: "register",       key: r => `ip:${r.ip}`,               limit: 4,   windowMs: 60 * 60e3, msg: r => `Sok regisztráció egy IP-ről: **${r.ip}** (${r.country ?? "?"})` },
  { type: "register",       key: () => "global",                   limit: 25,  windowMs: 60 * 60e3, msg: () => `Szokatlanul sok regisztráció egy órán belül` },
  { type: "admin_probe",    key: r => `ip:${r.ip}`,               limit: 3,   windowMs: 10 * 60e3, msg: r => `Admin végpontok próbálgatása: **${r.ip}** user: ${r.username ?? "-"}` },
  { type: "write_burst",    key: r => `a:${r.details?.actor}`,     limit: 1,   windowMs: 30 * 60e3, msg: r => `Tömeges írás (spam?): ${r.details?.actor} — ${r.details?.count} kérés 5 perc alatt` },
  { type: "request_flood",  key: r => `ip:${r.ip}`,               limit: 1,   windowMs: 30 * 60e3, msg: r => `Kérés-áradat (DoS?): **${r.ip}** — ${r.details?.count} kérés/perc` },
  { type: "rate_limited",   key: r => `ip:${r.ip}`,               limit: 5,   windowMs: 10 * 60e3, msg: r => `Ismételten korlátba futó IP: **${r.ip}** (${r.path})` },
  { type: "discord_raid",   key: r => `u:${r.details?.discordUser}`, limit: 1, windowMs: 30 * 60e3, msg: r => `Discord: gyanús tömeges tag-elés, kirúgva: ${r.details?.discordUser}` },
];

const counters = new Map();     // `${ruleIdx}|${key}` → [timestamps]
const lastAlert = new Map();    // same key → ms
const ALERT_COOLDOWN = 30 * 60e3;

function trackForAlert(row) {
  const now = Date.now();
  if (row.type === "scanner_probe") trackAutoBlock(row, now);
  RULES.forEach((rule, i) => {
    if (rule.type !== row.type) return;
    const k = `${i}|${rule.key(row)}`;
    const arr = (counters.get(k) || []).filter(t => now - t < rule.windowMs);
    arr.push(now);
    counters.set(k, arr);
    if (arr.length >= rule.limit && now - (lastAlert.get(k) || 0) > ALERT_COOLDOWN) {
      lastAlert.set(k, now);
      sendAlert(`🛡️ ${rule.msg(row)}`);
    }
  });
}

async function sendAlert(text) {
  console.warn("[security] RIASZTÁS:", text.replace(/\*\*|`/g, ""));
  pool.query(
    `INSERT INTO security_events (type, severity, details) VALUES ('alert', 'high', $1)`,
    [JSON.stringify({ text })]
  ).catch(() => {});
  try {
    const { sendSecurityAlert } = await import("../discord-bot.js");
    await sendSecurityAlert(text);
  } catch (err) {
    console.error("[security] Discord riasztás hiba:", err.message);
  }
}

/* ── Automatikus tiltás sebezhetőség-keresésért ────────────────
   AUTO_BLOCK.limit próba AUTO_BLOCK.windowMs alatt → 24 órás tiltás.
   Valódi látogató sosem kér .env / wp-login.php / .git fájlt, de
   biztonságból nem tiltunk: belső címet / a proxyt, és olyan IP-t, ahonnan
   az elmúlt 30 napban sikeres belépés volt (közös hálózat lehet). ── */
const AUTO_BLOCK = { limit: 5, windowMs: 10 * 60e3, hours: 24 };

/* Saját (otthoni/szerver) IP kivétele — a cím változik, ezért nem fix
   IP-t tárolunk, hanem a DuckDNS-nevet oldjuk fel 10 percenként
   (AUTO_BLOCK_EXEMPT_HOSTS, vesszővel), tartaléknak 30 percenként a
   szerver saját nyilvános IP-jét is lekérdezzük. Fix címek:
   AUTO_BLOCK_EXEMPT_IPS (vesszővel). A korábbi címek 24 óráig még
   kivételek maradnak (ha épp IP-váltás közben jön egy kérés). */
const EXEMPT_HOSTS = (process.env.AUTO_BLOCK_EXEMPT_HOSTS || "csimota.duckdns.org").split(",").map(s => s.trim()).filter(Boolean);
const EXEMPT_STATIC = new Set((process.env.AUTO_BLOCK_EXEMPT_IPS || "").split(",").map(s => s.trim()).filter(Boolean));
const exemptDynamic = new Map(); // ip → utoljára látva (ms)

function markExempt(ip) { if (ip) exemptDynamic.set(ip, Date.now()); }
async function refreshExemptHosts() {
  for (const h of EXEMPT_HOSTS) {
    for (const fn of ["resolve4", "resolve6"]) {
      try { (await dns.promises[fn](h)).forEach(markExempt); } catch {}
    }
  }
  for (const [ip, at] of exemptDynamic) if (Date.now() - at > 24 * 60 * 60e3) exemptDynamic.delete(ip);
}
async function refreshOwnPublicIp() {
  try {
    const r = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(8000) });
    if (r.ok) markExempt((await r.text()).trim());
  } catch {}
}
export function isAutoBlockExempt(ip) {
  return isInternalIp(ip) || EXEMPT_STATIC.has(ip) || exemptDynamic.has(ip);
}
refreshExemptHosts(); refreshOwnPublicIp();
setInterval(refreshExemptHosts, 10 * 60e3).unref();
setInterval(refreshOwnPublicIp, 30 * 60e3).unref();
const probeCounts = new Map();   // ip → [timestamps]
const autoBlocking = new Set();  // folyamatban lévő tiltások (ne fusson kétszer)

function trackAutoBlock(row, now) {
  const ip = row.ip;
  if (!ip || isAutoBlockExempt(ip) || blocked.has(ip) || autoBlocking.has(ip)) return;
  const arr = (probeCounts.get(ip) || []).filter(t => now - t < AUTO_BLOCK.windowMs);
  arr.push(now);
  probeCounts.set(ip, arr);
  if (arr.length >= AUTO_BLOCK.limit) {
    autoBlocking.add(ip);
    autoBlock(ip, row).finally(() => { autoBlocking.delete(ip); probeCounts.delete(ip); });
  }
}

async function autoBlock(ip, row) {
  try {
    const { rows: logins } = await pool.query(
      `SELECT COUNT(*)::int n FROM security_events
       WHERE ip = $1 AND type = 'login_success' AND created_at > now() - interval '30 days'`, [ip]);
    if (logins[0].n > 0) {
      logSecurityEvent({ type: "auto_block_skipped", severity: "warn", ip, dedupeKey: `skip|${ip}`,
                         details: { reason: "volt sikeres belépés erről az IP-ről (30 nap)", path: row.path } });
      return;
    }
    // Kézi (akár végleges) tiltást nem írunk felül rövidebbre
    const { rowCount } = await pool.query(
      `INSERT INTO ip_blocks (ip, reason, created_by, expires_at)
       VALUES ($1, $2, 'auto', now() + ($3 || ' hours')::interval)
       ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, created_by = 'auto',
                                      created_at = now(), expires_at = EXCLUDED.expires_at
         WHERE ip_blocks.expires_at IS NOT NULL AND ip_blocks.expires_at < EXCLUDED.expires_at`,
      [ip, `Automatikus: sebezhetőség-keresés (pl. ${String(row.path || "").slice(0, 120)})`, AUTO_BLOCK.hours]
    );
    if (rowCount) {
      blocked.add(ip);
      logSecurityEvent({ type: "ip_auto_blocked", severity: "warn", ip, dedupeKey: `ab|${ip}`,
                         details: { hours: AUTO_BLOCK.hours, country: row.country, path: row.path } });
      console.warn(`[security] automatikus tiltás ${AUTO_BLOCK.hours} órára: ${ip} (${row.country ?? "?"})`);
    }
  } catch (err) {
    console.error("[security] automatikus tiltás hiba:", err.message);
  }
}

/* ── Napi összesítő a #riasztás csatornára (reggel 9:00) ───────── */
export async function buildDailyDigest(hours = 24) {
  const since = `now() - (${parseInt(hours, 10)} || ' hours')::interval`;
  const q = (s) => pool.query(s).then(r => r.rows);
  const [byType, scan, topIps, topPaths, autoBlocks] = await Promise.all([
    q(`SELECT type, COUNT(*)::int n FROM security_events WHERE created_at > ${since} AND type <> 'alert' GROUP BY 1`),
    q(`SELECT COUNT(*)::int n, COALESCE(SUM((details->>'suppressed')::int),0)::int sup, COUNT(DISTINCT ip)::int ips
       FROM security_events WHERE created_at > ${since} AND type = 'scanner_probe'`),
    q(`SELECT ip, MAX(country) c, COUNT(*)::int + COALESCE(SUM((details->>'suppressed')::int),0)::int n
       FROM security_events WHERE created_at > ${since} AND type = 'scanner_probe'
       GROUP BY ip ORDER BY n DESC LIMIT 5`),
    q(`SELECT split_part(path, '?', 1) p, COUNT(*)::int n FROM security_events
       WHERE created_at > ${since} AND type = 'scanner_probe' GROUP BY 1 ORDER BY n DESC LIMIT 5`),
    q(`SELECT COUNT(*)::int n FROM security_events WHERE created_at > ${since} AND type = 'ip_auto_blocked'`),
  ]);
  const t = Object.fromEntries(byType.map(r => [r.type, r.n]));
  const lines = [`📋 **Napi biztonsági összesítő** (elmúlt ${hours} óra)`];
  const s = scan[0];
  if (s.n) {
    lines.push(`🔎 Sebezhetőség-keresés: **${s.n + s.sup}** kérés **${s.ips}** IP-ről — mind elutasítva (404). Automatikusan tiltva: **${autoBlocks[0].n}** IP (24 órára).`);
    lines.push(`   Leggyakoribb: ${topIps.map(r => `${r.ip} (${r.c ?? "?"}, ${r.n})`).join(", ")}`);
    lines.push(`   Keresett: ${topPaths.map(r => `\`${String(r.p).slice(0, 40)}\``).join(", ")}`);
  } else {
    lines.push(`🔎 Sebezhetőség-keresés: nem volt.`);
  }
  lines.push(`🔐 Belépések: ${t.login_success ?? 0} sikeres, ${t.login_failed ?? 0} sikertelen · Regisztráció: ${t.register ?? 0}`);
  const other = ["write_burst", "request_flood", "admin_probe", "rate_limited", "auth_rate_limited", "discord_raid", "blocked_request"]
    .filter(k => t[k]).map(k => `${k}: ${t[k]}`);
  if (other.length) lines.push(`⚠️ Egyéb: ${other.join(", ")}`);
  return lines.join("\n");
}

async function sendDailyDigest() {
  try {
    const text = await buildDailyDigest(24);
    const { sendSecurityAlert } = await import("../discord-bot.js");
    await sendSecurityAlert(text);
  } catch (err) {
    console.error("[security] napi összesítő hiba:", err.message);
  }
}
cron.schedule("0 9 * * *", sendDailyDigest, { timezone: "Europe/Budapest" });

/* ── IP-tiltólista (60 mp-es cache) ─────────────────────────── */
let blocked = new Set();
async function refreshBlocks() {
  try {
    const { rows } = await pool.query(
      `SELECT ip FROM ip_blocks WHERE expires_at IS NULL OR expires_at > now()`
    );
    blocked = new Set(rows.map(r => r.ip));
  } catch (err) {
    if (!/does not exist/.test(err.message)) console.error("[security] tiltólista hiba:", err.message);
  }
}
export function isIpBlocked(ip) { return blocked.has(ip); }
export { refreshBlocks };

/* ── Karbantartás ───────────────────────────────────────────── */
async function housekeeping() {
  const now = Date.now();
  for (const [k, v] of lastWrite) if (now - v.at > 60e3) lastWrite.delete(k);
  for (const [k, arr] of counters) if (!arr.length || now - arr[arr.length - 1] > 60 * 60e3) counters.delete(k);
  for (const [k, arr] of probeCounts) if (!arr.length || now - arr[arr.length - 1] > AUTO_BLOCK.windowMs) probeCounts.delete(k);
  if (droppedTotal) { console.warn(`[security] ${droppedTotal} esemény eldobva az írási plafon miatt`); droppedTotal = 0; }
}
async function retention() {
  try {
    await pool.query(`DELETE FROM security_events WHERE created_at < now() - ($1 || ' days')::interval`, [RETENTION_DAYS]);
    await pool.query(`DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at < now() - interval '30 days'`);
  } catch {}
}

refreshBlocks();
setInterval(refreshBlocks, 60e3).unref();
setInterval(housekeeping, 60e3).unref();
setInterval(retention, 24 * 60 * 60e3).unref();
