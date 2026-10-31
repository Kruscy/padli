import { pool } from "../db.js";

// Közös "feltöltő-e" ellenőrzés — ugyanaz a feltétel, mint a
// server/routes/uploader.js requireUploader middleware-je, hogy a jogosultság
// definíciója egy helyen éljen (wishlist claim/plan, manga-adatlap szerkesztés).
export async function isUploaderUser(userId) {
  const { rows } = await pool.query(
    `SELECT ps.tier, u.can_upload
     FROM users u
     LEFT JOIN patreon_status ps ON ps.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const { tier, can_upload } = rows[0] || {};
  return tier === "Admin" || tier === "Uploader" || !!can_upload;
}
