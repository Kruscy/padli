import { pool } from "../db.js";

/* ── A session-beli user adatainak frissítése a DB-ből ─────────
   A szerepkör (role) belépéskor került a sessionbe, és 30 napig onnan
   olvastuk: egy lefokozott admin a session lejártáig admin maradt, egy
   törölt fiók sessionje pedig tovább működött. Itt userenként legfeljebb
   percenként egyszer a DB-ből frissítjük (memóriacache-sel, hogy ne
   legyen minden kérés plusz lekérdezés). ── */

const TTL_MS = 60 * 1000;
const cache = new Map(); // userId → { at, row | null }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k);
}, TTL_MS).unref();

export async function sessionRefresh(req, res, next) {
  const user = req.session?.user;
  if (!user?.id) return next();

  try {
    let hit = cache.get(user.id);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const { rows } = await pool.query(`SELECT role FROM users WHERE id = $1`, [user.id]);
      hit = { at: Date.now(), row: rows[0] || null };
      cache.set(user.id, hit);
    }

    if (!hit.row) {
      // A fiók már nem létezik → kijelentkeztetjük
      delete req.session.user;
    } else if ((hit.row.role || null) !== (user.role || null)) {
      req.session.user.role = hit.row.role;
    }
  } catch (err) {
    // DB-hiba esetén nem engedünk többet, mint eddig: a session-beli adat marad
    console.error("[session-refresh] hiba:", err.message);
  }
  next();
}
