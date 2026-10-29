// Lemez-figyelő: cronból 5 percenként fut, és ha egy figyelt fájlrendszer
// telítettsége átlépi a küszöböt, Ascyrának (user_id=5) értesítést küld a
// honlapon + a #riasztás Discord-csatornára.
// 2026-10-22: a / megtelt, a Postgres ~10 órán át recovery-hurokban volt.
//
// Futtatás: node server/scripts/disk-monitor.js [--dry-run] [--test]
//   --dry-run  csak kiírja, mit küldene (DB/Discord nélkül)
//   --test     egyszeri teszt-értesítés küldése (a küszöböktől függetlenül)
import pg from "pg";
import fs from "fs";
import "dotenv/config";

const NOTIFY_USER_ID = 5;
// Tmpfs-en tartjuk, hogy teli lemeznél is írható legyen.
const STATE_FILE = "/run/padli-disk-monitor.json";

// warn/crit: telítettség %-ban (mint a df Use% oszlopa)
const MOUNTS = [
  { path: "/", label: "Rendszer + adatbázis (/)", warn: 85, crit: 95 },
  { path: "/mnt/manga", label: "Manga lemez (/mnt/manga)", warn: 90, crit: 97 },
  { path: "/mnt/manga2", label: "Manga lemez 2 (/mnt/manga2)", warn: 90, crit: 97 },
];
// Ugyanazon a szinten ennyi idő után ismétel
const REPEAT_MS = { warn: 12 * 3600_000, crit: 3600_000 };
// Riasztás után ez alá esve küld „helyreállt” üzenetet
const RECOVER_MARGIN = 5;

const DRY_RUN = process.argv.includes("--dry-run");
const TEST = process.argv.includes("--test");

const pool = new pg.Pool({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  connectionTimeoutMillis: 5000,
});

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.error("Állapotfájl írási hiba:", e.message);
  }
}

function usage(mountPath) {
  const s = fs.statfsSync(mountPath);
  const used = (s.blocks - s.bfree) * s.bsize;
  const avail = s.bavail * s.bsize;
  return {
    pct: Math.ceil((used / (used + avail)) * 100),
    freeGb: avail / 1024 ** 3,
    totalGb: (s.blocks * s.bsize) / 1024 ** 3,
  };
}

function isMountPoint(p) {
  if (p === "/") return true;
  try {
    return fs.statSync(p).dev !== fs.statSync(p + "/..").dev;
  } catch {
    return false;
  }
}

async function notifySite(message) {
  await pool.query(
    `INSERT INTO notifications (user_id, type, message, link)
     VALUES ($1, 'disk_alert', $2, NULL)`,
    [NOTIFY_USER_ID, message]
  );
}

// A bot a fő appban fut, ezért itt a REST API-t hívjuk közvetlenül.
async function notifyDiscord(message) {
  const channelId = process.env.DISCORD_SECURITY_CHANNEL_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!channelId || !token) throw new Error("hiányzó DISCORD_SECURITY_CHANNEL_ID / DISCORD_BOT_TOKEN");
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
}

// Mindkét csatornát megpróbálja: teli lemeznél a DB-írás elbukhat,
// ilyenkor legalább a Discord-üzenet kimegy. Igaz, ha legalább egy sikerült.
async function send(message) {
  if (DRY_RUN) {
    console.log("[dry-run] küldené:", message);
    return true;
  }
  let ok = false;
  try {
    await notifySite(message);
    ok = true;
  } catch (e) {
    console.error("Honlap-értesítés hiba:", e.message);
  }
  try {
    await notifyDiscord(message);
    ok = true;
  } catch (e) {
    console.error("Discord-értesítés hiba:", e.message);
  }
  return ok;
}

function fmt(m, u) {
  return `${m.label}: ${u.pct}% foglalt, ${u.freeGb.toFixed(1)} GB szabad (${u.totalGb.toFixed(0)} GB-ból)`;
}

async function main() {
  const now = Date.now();
  const state = readState();

  if (TEST) {
    const lines = MOUNTS.filter(m => isMountPoint(m.path)).map(m => "• " + fmt(m, usage(m.path)));
    await send(`🧪 Lemez-riasztás teszt — a figyelés működik.\n${lines.join("\n")}`);
    return;
  }

  for (const m of MOUNTS) {
    // Ha egy adatlemez nincs felcsatolva, a / értékét mérnénk helyette.
    if (!isMountPoint(m.path)) {
      console.warn(`${m.path} nincs felcsatolva, kihagyva`);
      continue;
    }
    const u = usage(m.path);
    const level = u.pct >= m.crit ? "crit" : u.pct >= m.warn ? "warn" : null;
    const prev = state[m.path];
    console.log(`${fmt(m, u)}${level ? ` → ${level}` : ""}`);

    if (level) {
      const escalated = prev?.level !== level && !(prev?.level === "crit" && level === "warn");
      const due = !prev || escalated || now - prev.sentAt >= REPEAT_MS[level];
      if (!due) continue;
      const msg = level === "crit"
        ? `🚨 KRITIKUS: majdnem tele a lemez! ${fmt(m, u)}. Ha megtelik, az adatbázis leáll — azonnal szabadíts fel helyet.`
        : `⚠️ Fogy a hely a lemezen: ${fmt(m, u)}.`;
      if (await send(msg)) state[m.path] = { level, sentAt: now };
    } else if (prev && u.pct < m.warn - RECOVER_MARGIN) {
      if (await send(`✅ Lemez rendben: ${fmt(m, u)}.`)) delete state[m.path];
    }
  }

  if (!DRY_RUN) writeState(state);
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
