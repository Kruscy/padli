/* ── Rugalmas azonosítás (2026-11-15): weboldali munkamenet VAGY Android-app token (Bearer pdla_…)
   VAGY asztali Studio API-kulcs (X-API-Key: pdl_…). A chat így mindhárom helyről elérhető. ── */
import crypto from "crypto";
import { pool } from "../db.js";
import { authenticateApiKey } from "./api-keys.js";

const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const tokenCache = new Map();   // hash → { at, user }
setInterval(() => { const n = Date.now(); for (const [k, v] of tokenCache) if (n - v.at > 60_000) tokenCache.delete(k); }, 60_000).unref();

// → { id, username, role, display_name, via } vagy null
/** Kijelentkeztetéskor azonnal ürítjük (különben 60 mp-ig még élne a gyorsítótárban). */
export function forgetTokens() { tokenCache.clear(); }

export async function resolveUser(req, { allowKey = true } = {}) {
  if (req.session?.user?.id) return { ...req.session.user, via: "web" };
  const h = String(req.headers?.authorization || "");
  const ip = req.headers?.["cf-connecting-ip"] || req.ip || req.socket?.remoteAddress;
  if (h.startsWith("Bearer pdla_")) {
    const hk = sha(h.slice(7).trim());
    const hit = tokenCache.get(hk);
    if (hit && Date.now() - hit.at < 60_000) return hit.user;
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.role FROM app_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL`, [hk]);
    if (rows[0]) { const user = { ...rows[0], via: "android" }; tokenCache.set(hk, { at: Date.now(), user }); return user; }
  }
  const key = req.headers?.["x-api-key"];
  if (key && allowKey) {
    const k = await authenticateApiKey(String(key), ip).catch(() => null);
    if (k) {
      const { rows } = await pool.query("SELECT id, username, role FROM users WHERE id = $1", [k.id]);
      if (rows[0]) return { ...rows[0], via: "studio" };
    }
  }
  return null;
}

export function requireAnyAuth(req, res, next) {
  resolveUser(req).then(u => {
    if (!u) return res.status(401).json({ error: "Jelentkezz be." });
    req.anyUser = u;
    next();
  }).catch(() => res.status(500).json({ error: "Hiba az azonosításnál." }));
}

/* Olvasáshoz / fejezetképekhez: a fordítási kulcs (pdl_) NEM elég — azt könnyű továbbadni (pl. egy támogató
   kiposztolja, és bárki olvasná a zárolt részeket). Csak weboldali munkamenet vagy böngészős belépéssel
   kapott app-token (pdla_, a felhasználó nem látja, nem tudja kimásolni). */
export function requireUserNoKey(req, res, next) {
  resolveUser(req, { allowKey: false }).then(u => {
    if (!u) return res.status(401).json({ error: "Jelentkezz be." });
    req.anyUser = u;
    next();
  }).catch(() => res.status(500).json({ error: "Hiba az azonosításnál." }));
}
