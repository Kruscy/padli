import { pool } from "../db.js";
import { isAdultVerified, ADULT_GENRE_EXISTS_SQL } from "./age.js";

/* ── Fejezet-hozzáférés (Patreon-zárolás + 18+ korhatár) ─────────
   Korábban csak a /api/pages ellenőrizte; maguk a képek (/api/image) és a
   PadliCrome fejezet-importja bárki számára elérhetők voltak, így a
   zárolt és a felnőtt tartalom megkerülhető volt. Most mindegyik ugyanazt
   a döntést használja. Hiba esetén zárva marad (fail closed).

   A felhasználói adatokat (aktív támogató-e, igazoltan 18+ -e) rövid ideig
   memóriában tartjuk, mert egy fejezet megnyitása 60+ képkérés. ── */

const USER_TTL_MS = 60 * 1000;
const userCache = new Map(); // userId → { at, isPatron, adultOk }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of userCache) if (now - v.at > USER_TTL_MS) userCache.delete(k);
}, USER_TTL_MS).unref();

async function getUserAccess(userId) {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit;
  const { rows } = await pool.query(
    `SELECT u.birth_date,
            EXISTS (SELECT 1 FROM patreon_status ps WHERE ps.user_id = u.id AND ps.active = true) AS is_patron
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  const entry = {
    at: Date.now(),
    isPatron: !!rows[0]?.is_patron,
    adultOk: isAdultVerified(rows[0]?.birth_date),
  };
  userCache.set(userId, entry);
  return entry;
}

// Egy fejezet zárolási és korhatár-adatai (duplikált slug esetén az összes
// jelölt alapján: csak akkor zárt, ha MINDEN jelölt még zárt — ahogy eddig
// a /api/pages is döntött).
export async function getChapterFlags(slug, chapter) {
  const { rows } = await pool.query(
    `SELECT c.unlocks_at, ${ADULT_GENRE_EXISTS_SQL} AS is_adult
     FROM chapter c
     JOIN manga m ON m.id = c.manga_id
     WHERE m.slug = $1 AND c.folder = $2`,
    [slug, chapter]
  );
  return flagsFromRows(rows);
}

// rows: { unlocks_at, is_adult } sorok
export function flagsFromRows(rows) {
  const now = Date.now();
  return {
    exists: rows.length > 0,
    locked: rows.length > 0 && rows.every(r => r.unlocks_at && new Date(r.unlocks_at).getTime() > now),
    adult: rows.some(r => r.is_adult),
  };
}

// → null, ha hozzáférhet; különben az ok: "login" | "age_restricted" | "locked"
export async function denyReason(sessionUser, { locked, adult }) {
  if (!sessionUser?.id) return "login";
  if (sessionUser.role === "admin") return null;
  if (!locked && !adult) return null;
  const access = await getUserAccess(sessionUser.id);
  if (adult && !access.adultOk) return "age_restricted";
  if (locked && !access.isPatron) return "locked";
  return null;
}
