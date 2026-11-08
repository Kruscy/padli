/* ── Felhasználónkénti API-kulcsok (2026-11-08) ──────────────────
   A külső PadliCrome a böngészős belépés (session / bővítmény-JWT)
   helyett API-kulccsal hívja a /api/pc/v1 útvonalat. A kulcs a
   felhasználó nevében fut: az ő pontjait vonja, és csak azt a fejezetet
   érheti el, amit ő is olvashat (zárolás, 18+).
   A kulcsot csak létrehozáskor mutatjuk meg; a DB-ben SHA-256 hash van,
   így egy adatbázis-szivárgásból nem lehet használható kulcsot szerezni. ── */
import { randomBytes, createHash } from "crypto";
import { pool } from "../db.js";

export const KEY_PREFIX = "pdl_";
export const MAX_KEYS_PER_USER = 5;

const hashKey = key => createHash("sha256").update(key).digest("hex");

export async function createApiKey(userId, label) {
  const { rows: [{ n }] } = await pool.query(
    "SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
  if (n >= MAX_KEYS_PER_USER) {
    const err = new Error(`Legfeljebb ${MAX_KEYS_PER_USER} aktív kulcsod lehet — előbb vonj vissza egyet.`);
    err.status = 400;
    throw err;
  }
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  const cleanLabel = String(label || "").trim().slice(0, 60) || null;
  const { rows } = await pool.query(
    `INSERT INTO api_keys (user_id, key_hash, prefix, label) VALUES ($1, $2, $3, $4)
     RETURNING id, prefix, label, created_at`,
    [userId, hashKey(key), key.slice(0, 10), cleanLabel]);
  return { ...rows[0], key };
}

export async function listApiKeys(userId) {
  const { rows } = await pool.query(
    `SELECT id, prefix, label, created_at, last_used_at
       FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, [userId]);
  return rows;
}

export async function revokeApiKey(userId, id) {
  const { rowCount } = await pool.query(
    "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    [id, userId]);
  return rowCount > 0;
}

// Kulcs a kérésből: X-API-Key fejléc, vagy Authorization: Bearer pdl_...
export function keyFromRequest(req) {
  const h = req.headers["x-api-key"];
  if (typeof h === "string" && h) return h.trim();
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer " + KEY_PREFIX)) return auth.slice(7).trim();
  return null;
}

// last_used_at-et legfeljebb percenként írjuk (egy fordítás sok kérés)
const lastTouch = new Map();

// → { id, username, keyId } vagy null
export async function authenticateApiKey(key, ip) {
  if (!key || !key.startsWith(KEY_PREFIX) || key.length > 100) return null;
  const { rows } = await pool.query(
    `SELECT k.id AS key_id, u.id, u.username
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hashKey(key)]);
  if (!rows.length) return null;
  const r = rows[0];
  const now = Date.now();
  if (now - (lastTouch.get(r.key_id) || 0) > 60_000) {
    lastTouch.set(r.key_id, now);
    pool.query("UPDATE api_keys SET last_used_at = now(), last_ip = $2 WHERE id = $1", [r.key_id, ip || null])
      .catch(() => {});
  }
  return { id: r.id, username: r.username, keyId: r.key_id };
}
