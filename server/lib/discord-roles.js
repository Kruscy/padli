import { pool } from "../db.js";
import { MANAGEABLE_ROLES, getGuild, isDiscordBotReady } from "../discord-bot.js";

/* ── Támogatói rangok szinkronja a Discord szerveren ──────────
   A weboldal támogatói szintje (patreon_status.tier, akár Patreonon,
   akár Stripe-on fizet) → a vele azonos nevű Discord-rang. A bot csak
   ezt a három rangot kezeli: a megfelelőt megadja, a többit elveszi
   (szintváltásnál a régit, lejárt támogatásnál mindet). Más rangokhoz
   (Tag, Hentai, admin/mod) nem nyúl.
   Csak azokra vonatkozik, akik a beállításokban összekapcsolták a
   Discord-fiókjukat (users.discord_id). A bot a saját rangja ALATT
   lévő rangokat tudja kezelni, és "Manage Roles" jogosultság kell neki. ── */
export const TIER_ROLES = {
  "Támogató": MANAGEABLE_ROLES["Támogató"],
  "Booster": MANAGEABLE_ROLES["Booster"],
  "Szuper Támogató": MANAGEABLE_ROLES["Szuper Támogató"],
};

// Az "Admin" szintű fiókoknak nincs fizetett támogatói szintjük, a
// rangjaikat kézzel kezelik — ezekhez a bot egyáltalán nem nyúl (se nem
// ad, se nem vesz el, leválasztáskor/fióktörléskor sem).
export const isUntouchableTier = tier => tier === "Admin";

async function loadUser(userId) {
  const { rows } = await pool.query(
    `SELECT u.discord_id, ps.tier, ps.active
     FROM users u LEFT JOIN patreon_status ps ON ps.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
}

export function desiredRoleName(tier, active) {
  return active && TIER_ROLES[tier] ? tier : null;
}

async function fetchMember(discordId) {
  const guild = await getGuild();
  try {
    return await guild.members.fetch({ user: discordId, force: true });
  } catch (err) {
    if (err.code === 10007 || err.code === 10013) return null; // Unknown Member / Unknown User
    throw err;
  }
}

/* Visszatérés: { status: "not_linked" | "bot_offline" | "not_member" | "ok",
                  role: <elvárt rang neve vagy null>, added: [], removed: [] } */
export async function syncUserDiscordRoles(userId) {
  const user = await loadUser(userId);
  if (!user?.discord_id) return { status: "not_linked", role: null, added: [], removed: [] };
  if (isUntouchableTier(user.tier)) return { status: "admin_skip", role: null, added: [], removed: [] };

  const role = desiredRoleName(user.tier, user.active);
  if (!isDiscordBotReady()) return { status: "bot_offline", role, added: [], removed: [] };

  const member = await fetchMember(user.discord_id);
  if (!member) return { status: "not_member", role, added: [], removed: [] };

  const wantId = role ? TIER_ROLES[role] : null;
  const added = [], removed = [];
  for (const [name, id] of Object.entries(TIER_ROLES)) {
    const has = member.roles.cache.has(id);
    if (id === wantId && !has) {
      await member.roles.add(id, "Weboldali támogatói szint szinkron");
      added.push(name);
    } else if (id !== wantId && has) {
      await member.roles.remove(id, "Weboldali támogatói szint szinkron");
      removed.push(name);
    }
  }
  if (added.length || removed.length) {
    console.log(`[discord-roles] user ${userId} (${member.user.username}): +[${added.join(", ")}] -[${removed.join(", ")}]`);
  }
  return { status: "ok", role, added, removed };
}

// Leválasztáskor a támogatói rangokat elvesszük (különben a rang a
// Discordon maradna, a weboldal pedig már nem tudna róla). Admin szintű
// fióknál nem nyúlunk hozzá (a hívó adja át a weboldali szintet).
export async function removeTierRoles(discordId, tier) {
  if (!discordId || isUntouchableTier(tier) || !isDiscordBotReady()) return [];
  const member = await fetchMember(discordId);
  if (!member) return [];
  const removed = [];
  for (const [name, id] of Object.entries(TIER_ROLES)) {
    if (member.roles.cache.has(id)) {
      await member.roles.remove(id, "Discord-fiók leválasztva a weboldalról");
      removed.push(name);
    }
  }
  return removed;
}

/* ── Időszakos egyeztetés ──────────────────────────────────────
   A támogatói szint több helyen változhat (Patreon webhook és sync,
   Stripe webhook, lemondás, admin). Ahelyett, hogy mindegyikbe
   bekötnénk, 30 percenként minden összekapcsolt usert egyeztetünk —
   így a később belépők (a szerverre csak az összekapcsolás után
   csatlakozók) is megkapják a rangjukat. ── */
const RECONCILE_MS = 30 * 60 * 1000;
let reconciling = false;

export async function reconcileAllDiscordRoles() {
  if (reconciling || !isDiscordBotReady()) return null;
  reconciling = true;
  const stats = { checked: 0, changed: 0, notMember: 0, errors: 0 };
  try {
    const { rows } = await pool.query(`SELECT id FROM users WHERE discord_id IS NOT NULL ORDER BY id`);
    for (const { id } of rows) {
      try {
        const r = await syncUserDiscordRoles(id);
        stats.checked++;
        if (r.status === "not_member") stats.notMember++;
        if (r.added.length || r.removed.length) stats.changed++;
      } catch (err) {
        stats.errors++;
        console.error(`[discord-roles] egyeztetési hiba (user ${id}):`, err.message);
      }
      await new Promise(r => setTimeout(r, 250)); // Discord rate limit kímélése
    }
    if (stats.changed || stats.errors) console.log("[discord-roles] egyeztetés:", JSON.stringify(stats));
  } finally {
    reconciling = false;
  }
  return stats;
}

setTimeout(() => reconcileAllDiscordRoles().catch(() => {}), 2 * 60 * 1000).unref();
setInterval(() => reconcileAllDiscordRoles().catch(() => {}), RECONCILE_MS).unref();
