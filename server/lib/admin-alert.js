import { pool } from "../db.js";

/* ── Admin figyelmeztetés API-kvóta kimerüléskor ─────────────────
   Egy adott riasztás-típusból (alertKey) naponta csak egyszer küld
   értesítést, hogy ne spammelje tele az admint minden egyes
   sikertelen hívásnál. Ascyra (user_id=5) kapja, ugyanúgy mint a
   billing-address értesítéseknél. ── */
const ADMIN_USER_ID = 5;
const lastAlertDate = new Map(); // alertKey -> "YYYY-MM-DD"

export async function notifyAdminOnce(alertKey, message) {
  const today = new Date().toISOString().slice(0, 10);
  if (lastAlertDate.get(alertKey) === today) return;
  lastAlertDate.set(alertKey, today);
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, $2, $3, $4)`,
      [ADMIN_USER_ID, "api_quota_warning", message, "/admin.html"]
    );
  } catch (err) {
    console.error("admin alert hiba:", err.message);
  }
}
