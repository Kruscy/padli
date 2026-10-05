import { pool } from "../db.js";

/* ── Admin-műveleti napló ──────────────────────────────────────
   Kik, mikor, mit állítottak át az admin felületen (pl. fejezet
   feloldási ideje). A naplózás hibája nem buktatja el a műveletet. ── */
export async function logAdminAction(req, { action, targetType = null, targetId = null, targetTitle = null, details = null }) {
  try {
    const u = req.session?.user;
    await pool.query(
      `INSERT INTO admin_action_log (admin_id, admin_username, action, target_type, target_id, target_title, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [u?.id ?? null, u?.username ?? null, action, targetType, targetId, targetTitle,
       details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error("[admin-log] naplózási hiba:", err.message);
  }
}
