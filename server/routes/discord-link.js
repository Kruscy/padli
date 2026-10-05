import express from "express";
import { randomBytes } from "crypto";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { syncUserDiscordRoles, removeTierRoles, desiredRoleName, isUntouchableTier } from "../lib/discord-roles.js";

/* ── Discord-fiók összekapcsolása (Beállítások → Discord) ─────
   OAuth2 "identify" scope: csak a Discord-azonosítót és a nevet kérjük,
   a fiókhoz semmilyen más hozzáférést nem. Szükséges .env:
     DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
   és a Discord Developer Portalon (OAuth2 → Redirects) regisztrálni:
     ${BASE_URL}/api/discord/callback ── */
const router = express.Router();

const redirectUri = () => `${process.env.BASE_URL}/api/discord/callback`;
const back = (q) => `/settings.html?tab=discord&${q}`;

router.get("/connect", requireLogin, (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.error("❌ Discord összekapcsolás: hiányzó DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET");
    return res.redirect(back("discord=error&reason=not_configured"));
  }
  const state = randomBytes(16).toString("hex");
  req.session.discordOAuthState = state;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: "identify",
    state,
    prompt: "consent",
  });
  req.session.save(() => res.redirect(`https://discord.com/oauth2/authorize?${params}`));
});

router.get("/callback", async (req, res) => {
  if (!req.session.user) return res.redirect("/login.html");
  const { code, state, error } = req.query;
  const expected = req.session.discordOAuthState;
  delete req.session.discordOAuthState;

  if (error) return res.redirect(back(`discord=error&reason=${encodeURIComponent(error)}`));
  if (!code || !state || state !== expected) return res.redirect(back("discord=error&reason=state"));

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
      }),
    });
    if (!tokenRes.ok) {
      console.error("❌ Discord token csere sikertelen:", tokenRes.status, (await tokenRes.text()).slice(0, 200));
      return res.redirect(back("discord=error&reason=token_exchange"));
    }
    const { access_token } = await tokenRes.json();

    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) return res.redirect(back("discord=error&reason=identity"));
    const me = await meRes.json();

    // A tokent nem tároljuk: csak az azonosító kell, a rangot a bot adja.
    fetch("https://discord.com/api/oauth2/token/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        token: access_token,
      }),
    }).catch(() => {});

    const userId = req.session.user.id;
    // Egy Discord-fiók csak egy weboldali fiókhoz tartozhat (különben egy
    // támogatás több ember rangját is "fizetné").
    const taken = await pool.query(
      `SELECT id FROM users WHERE discord_id = $1 AND id <> $2`, [me.id, userId]
    );
    if (taken.rows.length) return res.redirect(back("discord=error&reason=taken"));

    // Ha korábban egy MÁSIK Discord-fiók volt összekötve, arról levesszük a rangokat
    const prev = await pool.query(
      `SELECT u.discord_id, ps.tier FROM users u LEFT JOIN patreon_status ps ON ps.user_id = u.id WHERE u.id = $1`, [userId]
    );
    const prevId = prev.rows[0]?.discord_id;
    if (prevId && prevId !== me.id) await removeTierRoles(prevId, prev.rows[0]?.tier).catch(() => {});

    await pool.query(
      `UPDATE users SET discord_id = $1, discord_username = $2, discord_linked_at = now() WHERE id = $3`,
      [me.id, me.global_name || me.username, userId]
    );
    console.log(`🔗 Discord összekapcsolva: ${req.session.user.username} ↔ ${me.username} (${me.id})`);

    let result;
    try { result = await syncUserDiscordRoles(userId); }
    catch (err) { console.error("❌ Discord rang szinkron hiba:", err.message); result = { status: "error" }; }
    return res.redirect(back(`discord=linked&sync=${result.status}`));
  } catch (err) {
    console.error("❌ Discord callback hiba:", err.message);
    return res.redirect(back("discord=error&reason=server"));
  }
});

router.get("/status", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.discord_id, u.discord_username, u.discord_linked_at, ps.tier, ps.active
       FROM users u LEFT JOIN patreon_status ps ON ps.user_id = u.id WHERE u.id = $1`,
      [req.session.user.id]
    );
    const r = rows[0] || {};
    res.json({
      configured: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
      linked: !!r.discord_id,
      username: r.discord_username || null,
      linkedAt: r.discord_linked_at || null,
      role: desiredRoleName(r.tier, r.active),
      admin: isUntouchableTier(r.tier),
      inviteUrl: process.env.DISCORD_INVITE_URL || "https://discord.gg/Hq6SysgZXC",
    });
  } catch (err) {
    console.error("❌ Discord status hiba:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

const lastManualSync = new Map(); // userId → ms
router.post("/sync", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const last = lastManualSync.get(userId) || 0;
  if (Date.now() - last < 20_000) {
    return res.status(429).json({ error: "Várj néhány másodpercet az újabb frissítés előtt." });
  }
  lastManualSync.set(userId, Date.now());
  try {
    res.json(await syncUserDiscordRoles(userId));
  } catch (err) {
    console.error("❌ Discord rang szinkron hiba:", err.message);
    const noPerm = err.code === 50013;
    res.status(500).json({ error: noPerm ? "A botnak nincs jogosultsága a rang kiosztására. Szólj egy adminnak." : "Nem sikerült a rang frissítése." });
  }
});

router.post("/disconnect", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const { rows } = await pool.query(
      `SELECT u.discord_id, ps.tier FROM users u LEFT JOIN patreon_status ps ON ps.user_id = u.id WHERE u.id = $1`, [userId]
    );
    const discordId = rows[0]?.discord_id;
    let removed = [];
    try { removed = await removeTierRoles(discordId, rows[0]?.tier); }
    catch (err) { console.error("❌ Discord rang elvétel hiba leválasztáskor:", err.message); }
    await pool.query(
      `UPDATE users SET discord_id = NULL, discord_username = NULL, discord_linked_at = NULL WHERE id = $1`, [userId]
    );
    console.log(`🔓 Discord leválasztva: ${req.session.user.username} (elvett rangok: ${removed.join(", ") || "-"})`);
    res.json({ ok: true, removed });
  } catch (err) {
    console.error("❌ Discord leválasztás hiba:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

export default router;
