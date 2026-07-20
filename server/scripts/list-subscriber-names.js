/**
 * Egyszeri script: aktív Stripe előfizetők kártyán szereplő teljes nevének lekérése
 * (billing_details.name a default payment methodról), a Billingo számlák
 * javításához.
 * Futtatás: node server/scripts/list-subscriber-names.js
 */

import "dotenv/config";
import Stripe from "stripe";
import { pool } from "../db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function run() {
  const { rows } = await pool.query(`
    SELECT ps.user_id, ps.tier, ps.stripe_subscription_id, u.username, u.email
    FROM patreon_status ps
    JOIN users u ON u.id = ps.user_id
    WHERE ps.payment_source = 'stripe'
      AND ps.active = true
      AND ps.stripe_subscription_id IS NOT NULL
    ORDER BY ps.user_id
  `);

  console.log(`${rows.length} aktív Stripe előfizető találva.\n`);

  const results = [];

  for (const row of rows) {
    try {
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
        expand: ["default_payment_method", "customer"],
      });

      let cardName = sub.default_payment_method?.billing_details?.name || null;

      if (!cardName) {
        const pms = await stripe.paymentMethods.list({ customer: sub.customer.id, type: "card" });
        cardName = pms.data[0]?.billing_details?.name || null;
      }

      results.push({
        user_id: row.user_id,
        username: row.username,
        email: row.email,
        tier: row.tier,
        card_name: cardName || "(nincs adat)",
      });
    } catch (e) {
      results.push({
        user_id: row.user_id,
        username: row.username,
        email: row.email,
        tier: row.tier,
        card_name: `HIBA: ${e.message}`,
      });
    }
  }

  console.log("user_id\tusername\temail\ttier\tkártyán szereplő név");
  for (const r of results) {
    console.log(`${r.user_id}\t${r.username}\t${r.email}\t${r.tier}\t${r.card_name}`);
  }

  await pool.end();
}

run();
