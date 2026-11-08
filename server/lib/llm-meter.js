/* ── Tört pontok elszámolása a helyi motor GPT-hívásaihoz (2026-11-08) ──
   Egy szövegfordítás jellemzően egy pont töredéke (pl. 0,15 pont). A
   user_points egész számot tárol, ezért a töredéket a pc_llm_meter
   gyűjti (ezredpontban), és amint egész pont gyűlik össze, levonjuk.
   Ha a hívás közben elfogy az egyenleg, a maradék tartozásként a mérőben
   marad; a következő hívást a „elérhető = egyenleg − tartozás” alapján
   már nem engedjük. ── */
import { pool } from "../db.js";
import { getBalance, spendPoints } from "./points-ledger.js";

export async function pendingMilli(userId) {
  const { rows } = await pool.query("SELECT milli FROM pc_llm_meter WHERE user_id = $1", [userId]);
  return Number(rows[0]?.milli || 0);
}

// Elérhető pont (tört): egyenleg − még le nem vont rész
export async function availablePoints(userId) {
  const [bal, milli] = await Promise.all([getBalance(userId), pendingMilli(userId)]);
  return { balance: bal, pending: milli / 1000, available: bal - milli / 1000 };
}

// A mérőből az egész pontokat átvezeti a pontnaplóba (a mérő csökkentése
// és a levonás egy tranzakcióban; a feltételes UPDATE véd a kettős levonás ellen)
async function settle(userId) {
  for (let guard = 0; guard < 3; guard++) {
    const milli = await pendingMilli(userId);
    let whole = Math.floor(milli / 1000);
    if (whole <= 0) return;
    const bal = await getBalance(userId);
    whole = Math.min(whole, bal);
    if (whole <= 0) return; // nincs miből levonni: tartozás marad
    const r = await spendPoints(userId, whole, async client => {
      const u = await client.query(
        "UPDATE pc_llm_meter SET milli = milli - $2, updated_at = now() WHERE user_id = $1 AND milli >= $2",
        [userId, whole * 1000]);
      return u.rowCount ? true : null;
    });
    if (r.ok) return;
    // közben más levont vagy fogyott az egyenleg: újrapróbáljuk friss adatokkal
  }
}

// Felhasználás hozzáadása (ezredpontban) és elszámolás
export async function chargeMilli(userId, milli) {
  if (milli > 0) {
    await pool.query(
      `INSERT INTO pc_llm_meter (user_id, milli) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET milli = pc_llm_meter.milli + EXCLUDED.milli, updated_at = now()`,
      [userId, milli]);
  }
  await settle(userId);
  return availablePoints(userId);
}
