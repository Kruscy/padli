import { pool } from "../db.js";
import { getClientIp } from "./client-ip.js";

/* ── Biztonsági eseménynapló ───────────────────────────────────
   logSecurityEvent() bárhonnan hívható (route, middleware, Discord bot).
   Támadás alatt rengeteg esemény jöhet, ezért:
     - azonos (típus, IP/actor) eseményből 10 mp-enként csak egyet írunk,
       a kihagyottak számát a következő sor details.suppressed mezője viszi;
     - másodpercenként legfeljebb 50 sort írunk összesen.
   Riasztás (Discord, DISCORD_SECURITY_CHANNEL_ID csatorna) küszöbök
   átlépésekor megy ki, kulcsonként legfeljebb 30 percenként. ── */

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
  { type: "scanner_probe",  key: r => `ip:${r.ip}`,               limit: 5,   windowMs: 10 * 60e3, msg: r => `Sebezhetőség-keresés (scanner): **${r.ip}** (${r.country ?? "?"}), pl. \`${r.path}\`` },
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
