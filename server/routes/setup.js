/* ── Telepítő varázsló (első indítás) ─────────────────────────
   Amíg nincs egyetlen admin sem, minden oldal a /setup.html-re irányít,
   ahol megadható az oldal neve, címe és az első (tulajdonosi) admin fiók.

   Védelem: a még be nem állított oldalt bárki megnyithatja, ezért a
   varázsló egy telepítőkódot kér. Ez a SETUP_TOKEN környezeti változó,
   vagy ha nincs megadva, induláskor véletlenszerűen generált kód, amit a
   szerver a naplóba ír (Docker: `docker compose logs app`). ── */
import express from "express";
import bcrypt from "bcrypt";
import { randomBytes, timingSafeEqual } from "crypto";
import { pool } from "../db.js";
import { validatePassword, validateUsername } from "../lib/auth-security.js";
import { loadSiteSettings, saveSiteSettings } from "../lib/site-config.js";
import { logSecurityEvent } from "../lib/security-log.js";

const router = express.Router();

// A "kész" állapot csak egyszer változik (false → true), utána nem kérdezzük
let setupDone = false;
export async function needsSetup() {
  if (setupDone) return false;
  try {
    const { rows } = await pool.query(`SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS has_admin`);
    if (rows[0].has_admin) setupDone = true;
  } catch {
    return false; // adatbázis-hiba: ne irányítsunk át, a hibát a többi végpont jelzi
  }
  return !setupDone;
}

let generatedToken = null;
function setupToken() {
  if (process.env.SETUP_TOKEN) return process.env.SETUP_TOKEN;
  if (!generatedToken) {
    generatedToken = randomBytes(9).toString("base64url");
    console.log("\n================================================================");
    console.log("  Telepítő varázsló: nyisd meg az oldalt a böngészőben (/setup.html)");
    console.log(`  Telepítőkód: ${generatedToken}`);
    console.log("================================================================\n");
  }
  return generatedToken;
}

// Induláskor: ha még nincs admin, rögtön kiírjuk a kódot
export async function announceSetupIfNeeded() {
  if (await needsSetup()) setupToken();
}

function tokenMatches(given) {
  const a = Buffer.from(String(given || "")), b = Buffer.from(setupToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

// Átirányítás a varázslóra, amíg nincs admin (csak oldalakra, API-ra és
// statikus fájlokra nem)
export async function setupRedirect(req, res, next) {
  if (setupDone || req.method !== "GET") return next();
  const p = req.path;
  if (p === "/setup.html" || p.startsWith("/api/") || !(p === "/" || p.endsWith(".html") || !/\.[a-z0-9]+$/i.test(p))) return next();
  if (await needsSetup()) return res.redirect(302, "/setup.html");
  next();
}

router.get("/status", async (req, res) => {
  res.json({ needsSetup: await needsSetup() });
});

const normUrl = (u) => {
  try {
    const url = new URL(String(u).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch { return null; }
};

router.post("/", async (req, res) => {
  if (!(await needsSetup())) return res.status(409).json({ error: "Az oldal már be van állítva." });
  const { token, siteName, siteUrl, patreonUrl, username, email, password, birthDate } = req.body || {};

  if (!tokenMatches(token)) {
    logSecurityEvent({ req, type: "setup_bad_token", severity: "warn" });
    return res.status(403).json({ error: "Hibás telepítőkód (a szerver naplójában találod)." });
  }
  const name = typeof siteName === "string" ? siteName.trim() : "";
  if (!name || name.length > 60) return res.status(400).json({ error: "Add meg az oldal nevét (legfeljebb 60 karakter)." });
  const url = normUrl(siteUrl);
  if (!url) return res.status(400).json({ error: "Az oldal címe érvényes http(s) cím legyen, pl. https://pelda.hu" });
  const patreon = patreonUrl ? normUrl(patreonUrl) && String(patreonUrl).trim() : "";
  if (patreonUrl && !patreon) return res.status(400).json({ error: "A Patreon-link érvénytelen." });

  const nameError = validateUsername(username);
  if (nameError) return res.status(400).json({ error: nameError });
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Érvénytelen e-mail-cím." });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime()) || birth > new Date()) return res.status(400).json({ error: "Érvénytelen születési dátum." });

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  let user;
  try {
    await client.query("BEGIN");
    // Két egyidejű beküldés közül csak az egyik hozhat létre admint
    await client.query("SELECT pg_advisory_xact_lock(7303, 1)");
    const { rows: existing } = await client.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
    if (existing.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Az oldal már be van állítva." });
    }
    const { rows } = await client.query(
      `INSERT INTO users (username, email, password_hash, birth_date, email_verified, role)
       VALUES ($1, $2, $3, $4, true, 'admin')
       RETURNING id, username, avatar, role`,
      [username, email.trim(), passwordHash, birthDate]
    );
    user = rows[0];
    await saveSiteSettings({ name, url, patreonUrl: patreon || "", ownerUserId: user.id }, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(400).json({ error: "Ez a felhasználónév vagy e-mail már foglalt." });
    throw err;
  } finally {
    client.release();
  }

  setupDone = true;
  await loadSiteSettings(); // a tranzakción belül mentett értékek érvényesítése
  logSecurityEvent({ req, type: "setup_completed", severity: "warn", userId: user.id, username: user.username });
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.user = { id: user.id, username: user.username, avatar: user.avatar, role: user.role };
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  res.json({ ok: true });
});

export default router;
