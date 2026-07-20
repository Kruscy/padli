/**
 * Egyszeri script: minden aktív Stripe előfizetés terhelésének szüneteltetése
 * (pause_collection: behavior 'void') — az előfizetés megmarad, csak nem számláz.
 * Futtatás: node server/scripts/pause-stripe-subscriptions.js
 */

import "dotenv/config";
import Stripe from "stripe";
import { pool } from "../db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function run() {
  const { rows } = await pool.query(`
    SELECT user_id, tier, stripe_subscription_id
    FROM patreon_status
    WHERE payment_source = 'stripe'
      AND active = true
      AND stripe_subscription_id IS NOT NULL
  `);

  console.log(`${rows.length} aktív Stripe előfizető találva.`);

  let ok = 0, skip = 0, err = 0;

  for (const row of rows) {
    try {
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);

      if (sub.pause_collection?.behavior === "void") {
        console.log(`✓  user_id=${row.user_id} már szüneteltetve — kihagyva`);
        skip++;
        continue;
      }

      await stripe.subscriptions.update(row.stripe_subscription_id, {
        pause_collection: { behavior: "void" },
      });

      console.log(`✅ user_id=${row.user_id} | tier=${row.tier} | sub=${row.stripe_subscription_id}`);
      ok++;
    } catch (e) {
      console.error(`❌ user_id=${row.user_id} | ${e.message}`);
      err++;
    }
  }

  console.log(`\nKész: ${ok} szüneteltetve, ${skip} kihagyva, ${err} hiba`);
  await pool.end();
}

run();
