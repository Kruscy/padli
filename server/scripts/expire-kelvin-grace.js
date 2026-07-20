/**
 * Egyszeri script: Kelvin (user_id=483) ideiglenes Szuper Támogató
 * hozzáférésének visszavonása a nap végén (2026-07-06 23:59), miután
 * a Patreon-megújulása "Fraud" jelzéssel elutasításra került.
 * Futtatás: systemd-run one-shot timerrel, node server/scripts/expire-kelvin-grace.js
 */

import "dotenv/config";
import { pool } from "../db.js";

const USER_ID = 483;

async function run() {
  const { rows } = await pool.query(
    `UPDATE patreon_status SET active = false, tier = NULL, last_sync = NOW()
     WHERE user_id = $1 AND tier = 'Szuper Támogató'
     RETURNING user_id, active, tier`,
    [USER_ID]
  );
  if (rows.length) {
    console.log(`[expire-kelvin-grace] Hozzáférés visszavonva: user_id=${USER_ID}`, rows[0]);
  } else {
    console.log(`[expire-kelvin-grace] Nem volt mit visszavonni (már nem Szuper Támogató) user_id=${USER_ID}`);
  }
  await pool.end();
}

run();
