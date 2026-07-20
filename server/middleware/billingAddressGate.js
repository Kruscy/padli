import { pool } from "../db.js";

/* Ezeken az útvonalakon akkor is át kell engedni a kérést, ha a
   felhasználónak még nincs megadva a számlázási címe — különben
   ő maga sem tudná megadni, vagy kizárnánk az alap funkciókból. */
const ALLOWED_PATHS = new Set([
  "/user/billing-address",
  "/auth/me",
  "/user/me",
  "/auth/logout",
  "/online-count",
]);

export async function billingAddressGate(req, res, next) {
  if (!req.session.user) return next();
  if (ALLOWED_PATHS.has(req.path)) return next();

  try {
    const { rows } = await pool.query(
      `SELECT u.billing_address, u.billing_name, u.force_billing_address,
              EXISTS (
                SELECT 1 FROM patreon_status ps
                WHERE ps.user_id = u.id AND ps.payment_source = 'stripe'
              ) AS is_stripe_payer
       FROM users u WHERE u.id = $1`,
      [req.session.user.id]
    );
    const row = rows[0];
    const missing = !row?.billing_address || !row?.billing_name;
    const required = (!!row?.is_stripe_payer || !!row?.force_billing_address) && missing;

    if (required) {
      return res.status(403).json({
        error: "Kérjük, add meg a számlázási címedet a folytatáshoz.",
        billingAddressRequired: true,
      });
    }
  } catch (err) {
    console.error("[billingAddressGate] hiba:", err.message);
  }

  next();
}
