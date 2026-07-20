/**
 * Egyszeri script: app-os emlékeztető értesítés küldése azoknak a Stripe-fizetőknek,
 * akik még nem adták meg a számlázási címüket.
 * Futtatás: node server/scripts/remind-billing-address.js
 */

import "dotenv/config";
import { pool } from "../db.js";

async function run() {
  const { rows } = await pool.query(`
    SELECT DISTINCT u.id, u.username
    FROM users u
    JOIN patreon_status ps ON ps.user_id = u.id AND ps.payment_source = 'stripe'
    WHERE u.billing_address IS NULL
    ORDER BY u.id
  `);

  console.log(`${rows.length} felhasználónak küldünk emlékeztetőt.`);

  const message = "🧾 Emlékeztető: kérjük add meg a számlázási címedet, hogy a Stripe-előfizetésedhez helyes számlát tudjunk kiállítani. Bejelentkezés után egy felugró ablakban tudod megadni.";

  let ok = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'billing_address_reminder', $2, NULL)`,
      [row.id, message]
    );
    console.log(`✅ user_id=${row.id} (${row.username})`);
    ok++;
  }

  console.log(`\nKész: ${ok} emlékeztető elküldve.`);
  await pool.end();
}

run();
