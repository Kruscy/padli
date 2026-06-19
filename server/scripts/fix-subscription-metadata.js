/**
 * Egyszeri script: meglévő aktív Stripe subscriptionök metadata frissítése
 * Futtatás: node server/scripts/fix-subscription-metadata.js
 */

import "dotenv/config";
import Stripe from "stripe";
import { pool } from "../db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TIER_NAME_TO_ID = {
  "Támogató":      "tamogato",
  "Booster":       "booster",
  "Szuper Támogató": "szuper",
};

async function run() {
  const { rows } = await pool.query(`
    SELECT ps.user_id, ps.tier, ps.stripe_subscription_id
    FROM patreon_status ps
    WHERE ps.payment_source = 'stripe'
      AND ps.active = true
      AND ps.stripe_subscription_id IS NOT NULL
  `);

  console.log(`${rows.length} aktív Stripe előfizető találva.`);

  let ok = 0, skip = 0, err = 0;

  for (const row of rows) {
    const tierId = TIER_NAME_TO_ID[row.tier];
    if (!tierId) {
      console.warn(`⚠️  Ismeretlen tier "${row.tier}" (user_id=${row.user_id}) — kihagyva`);
      skip++;
      continue;
    }

    try {
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);

      if (sub.metadata?.tierName && sub.metadata?.tierId) {
        console.log(`✓  user_id=${row.user_id} már van metadata — kihagyva`);
        skip++;
        continue;
      }

      await stripe.subscriptions.update(row.stripe_subscription_id, {
        metadata: {
          tierId,
          tierName: row.tier,
          userId: String(row.user_id),
        },
      });

      console.log(`✅ user_id=${row.user_id} | tier=${row.tier} | sub=${row.stripe_subscription_id}`);
      ok++;
    } catch (e) {
      console.error(`❌ user_id=${row.user_id} | ${e.message}`);
      err++;
    }
  }

  console.log(`\nKész: ${ok} frissítve, ${skip} kihagyva, ${err} hiba`);
  await pool.end();
}

run();
