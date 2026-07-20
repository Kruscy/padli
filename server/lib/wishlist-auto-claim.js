import { pool } from "../db.js";
import { notifyWishlistWatchers } from "../routes/wishlist.js";

/* ── Feltöltő-név → users.id feloldás ─────────────────────────
   Elsőként az uploader_user_map táblát nézzük (kézzel felvett,
   nem egyértelmű alias-ok: pl. "Joker" → JokerHun fiók), utána
   esik vissza egy case-insensitive pontos egyezésre a
   users.username ellen. Ha egyik sem talál, null-t ad vissza —
   ilyenkor a hívó kihagyja az automatikus claim-et. ── */
export async function resolveUploaderUserId(uploaderName) {
  const name = uploaderName?.trim();
  if (!name) return null;

  const mapped = await pool.query(
    `SELECT user_id FROM uploader_user_map WHERE LOWER(uploader_name) = LOWER($1)`,
    [name]
  );
  if (mapped.rowCount) return mapped.rows[0].user_id;

  const direct = await pool.query(
    `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
    [name]
  );
  if (direct.rowCount) return direct.rows[0].id;

  return null;
}

/* ── Automatikus claim: ha egy manga anilist_id-je egyezik egy
   kívánságlista-tétellel, a manga.uploaders feltöltőit (ha
   feloldhatók egy users.id-ra) automatikusan "dolgozik rajta"
   státuszba tesszük, és értesítjük a kérőt + lájkolókat — pont
   úgy, mintha egy admin claimelte volna. ── */
export async function autoClaimWishlistForManga(manga) {
  const result = { claimed: [], skipped: [], noWishlistMatch: false };
  if (!manga.anilist_id || !manga.uploaders?.length) return result;

  const { rows: wlRows } = await pool.query(
    `SELECT id, title FROM wishlist WHERE anilist_id = $1`,
    [manga.anilist_id]
  );
  if (!wlRows.length) {
    result.noWishlistMatch = true;
    return result;
  }

  const resolved = new Map(); // userId -> uploaderName (első egyező név)
  for (const uploaderName of manga.uploaders) {
    const userId = await resolveUploaderUserId(uploaderName);
    if (userId) {
      if (!resolved.has(userId)) resolved.set(userId, uploaderName);
    } else if (!result.skipped.includes(uploaderName)) {
      result.skipped.push(uploaderName);
    }
  }
  if (!resolved.size) return result;

  const { rows: userRows } = await pool.query(
    `SELECT id, username FROM users WHERE id = ANY($1)`,
    [[...resolved.keys()]]
  );
  const usernameById = new Map(userRows.map(u => [u.id, u.username]));

  for (const wl of wlRows) {
    for (const userId of resolved.keys()) {
      const insertRes = await pool.query(
        `INSERT INTO wishlist_claims (wishlist_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (wishlist_id, user_id) DO NOTHING
         RETURNING id`,
        [wl.id, userId]
      );
      if (!insertRes.rowCount) continue; // már claimelve volt

      const actingUser = { id: userId, username: usernameById.get(userId) };
      await notifyWishlistWatchers(wl.id, actingUser, "wishlist_claimed",
        (username, title, reason) =>
          `🎬 ${username} elkezdte a(z) "${title}" fordítását, ${reason}! (automatikusan, a feltöltés alapján)`
      );
      result.claimed.push({
        wishlistId: wl.id,
        wishlistTitle: wl.title,
        userId,
        username: usernameById.get(userId),
        uploaderName: resolved.get(userId),
      });
    }
  }

  return result;
}
