/**
 * past_due Stripe-előfizetések kezelése (2026-10-29, user döntés alapján):
 *   nap 0-2: türelmi idő, hozzáférés marad
 *   nap 2:   email értesítés a userhez (sikertelen fizetés)
 *   nap 3:   hozzáférés elvétele (active=false), amíg nincs sikeres fizetés
 *   nap 7:   előfizetés végleges lemondása Stripe-on — a customer.subscription.deleted
 *            webhook ezután a megszokott módon nullázza a tier/sub_id mezőket
 *
 * A "past_due_since" az aktuális nyitott invoice finalizálási idejéhez van
 * rögzítve az első észleléskor, hogy a határnapok stabilak legyenek akkor is,
 * ha a script futásai között a Stripe több retry-t is lebonyolít.
 *
 * Futtatás: node server/scripts/check-past-due-subscriptions.js [--dry-run]
 */

import "dotenv/config";
import Stripe from "stripe";
import { pool } from "../db.js";
import { sendMail } from "../mail.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const DRY_RUN = process.argv.includes("--dry-run");

const DAY_MS = 86400000;
const NOTIFY_AFTER_DAYS = 2;
const DEACTIVATE_AFTER_DAYS = 3;
const CANCEL_AFTER_DAYS = 7;

function paymentFailedHtml(username) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;padding:32px 28px">
    <img src="${process.env.SITE_URL || ""}/assets/logo.png" style="height:48px;margin-bottom:20px" alt="${process.env.SITE_NAME || "PadlizsanFanSub"}">
    <h2 style="color:#f87171;margin:0 0 12px">⚠️ Sikertelen fizetés</h2>
    <p style="color:#bbb;line-height:1.7">Szia <strong style="color:#fff">${username}</strong>!</p>
    <p style="color:#bbb;line-height:1.7">A legutóbbi előfizetés-terhelésed sikertelen volt.</p>
    <hr style="border-color:#2a2a3a;margin:20px 0">
    <p style="color:#555;font-size:0.78rem">${process.env.SITE_NAME || "PadlizsanFanSub"} · ${(process.env.SITE_URL || "").replace(/^https?:\/\//, "")}</p>
  </div>`;
}

async function run() {
  const { rows } = await pool.query(`
    SELECT ps.user_id, ps.stripe_subscription_id, ps.active, ps.past_due_since, ps.past_due_notified_at,
           u.username, u.email
    FROM patreon_status ps
    JOIN users u ON u.id = ps.user_id
    WHERE ps.payment_source = 'stripe' AND ps.stripe_subscription_id IS NOT NULL
    ORDER BY ps.user_id
  `);

  console.log(`${rows.length} Stripe-forrású sor ellenőrzése...${DRY_RUN ? " (DRY RUN — nincs írás/email)" : ""}`);

  const now = new Date();
  let notified = 0, deactivated = 0, canceled = 0, recovered = 0;

  for (const row of rows) {
    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    } catch (e) {
      console.error(`user_id=${row.user_id} (${row.username}) — Stripe lekérési hiba: ${e.message}`);
      continue;
    }

    if (sub.status !== "past_due") {
      // Nem past_due (pl. active, canceled máshonnan, stb.) — ha nálunk még
      // past_due nyomot hordoz, töröljük, mert a helyzet már nem aktuális.
      if (row.past_due_since || row.past_due_notified_at) {
        console.log(`user_id=${row.user_id} (${row.username}) — már nem past_due (${sub.status}), past_due nyom törlése`);
        recovered++;
        if (!DRY_RUN) {
          await pool.query(
            `UPDATE patreon_status SET past_due_since = NULL, past_due_notified_at = NULL WHERE user_id = $1`,
            [row.user_id]
          );
        }
      }
      continue;
    }

    // past_due_since rögzítése első észlelésnél — a nyitott invoice finalizálási
    // idejéhez kötve, hogy stabil legyen a retry-k között.
    let pastDueSince = row.past_due_since ? new Date(row.past_due_since) : null;
    if (!pastDueSince) {
      const invoices = await stripe.invoices.list({ customer: sub.customer, limit: 1 });
      const inv = invoices.data[0];
      pastDueSince = inv?.status_transitions?.finalized_at
        ? new Date(inv.status_transitions.finalized_at * 1000)
        : new Date(inv?.created * 1000 || now);
      console.log(`user_id=${row.user_id} (${row.username}) — most észleltem past_due-t, past_due_since = ${pastDueSince.toISOString()}`);
      if (!DRY_RUN) {
        await pool.query(`UPDATE patreon_status SET past_due_since = $1 WHERE user_id = $2`, [pastDueSince, row.user_id]);
      }
    }

    const daysSince = Math.floor((now - pastDueSince) / DAY_MS);

    // nap 7: végleges lemondás
    if (daysSince >= CANCEL_AFTER_DAYS) {
      console.log(`user_id=${row.user_id} (${row.username}) — ${daysSince} napja past_due, ELŐFIZETÉS LEMONDÁSA`);
      canceled++;
      if (!DRY_RUN) {
        await stripe.subscriptions.cancel(row.stripe_subscription_id);
        // a tényleges tier/sub_id nullázást a customer.subscription.deleted webhook végzi el
      }
      continue;
    }

    // nap 3: hozzáférés elvétele
    if (daysSince >= DEACTIVATE_AFTER_DAYS && row.active) {
      console.log(`user_id=${row.user_id} (${row.username}) — ${daysSince} napja past_due, HOZZÁFÉRÉS ELVÉTELE`);
      deactivated++;
      if (!DRY_RUN) {
        await pool.query(`UPDATE patreon_status SET active = false WHERE user_id = $1`, [row.user_id]);
      }
    }

    // nap 2: email értesítés (egyszer)
    if (daysSince >= NOTIFY_AFTER_DAYS && !row.past_due_notified_at) {
      console.log(`user_id=${row.user_id} (${row.username}) — ${daysSince} napja past_due, ÉRTESÍTÉS KÜLDÉSE (${row.email})`);
      notified++;
      if (!DRY_RUN) {
        if (row.email && row.email.includes("@")) {
          try {
            await sendMail({
              to: row.email,
              subject: "⚠️ Sikertelen fizetés – PadlizsanFanSub",
              html: paymentFailedHtml(row.username),
            });
          } catch (e) {
            console.error(`  email küldési hiba: ${e.message}`);
          }
        }
        await pool.query(`UPDATE patreon_status SET past_due_notified_at = $1 WHERE user_id = $2`, [now, row.user_id]);
      }
    }
  }

  console.log(`\nKész: ${notified} értesítés, ${deactivated} hozzáférés-elvétel, ${canceled} lemondás, ${recovered} helyreállt past_due-nyom törölve.`);
  await pool.end();
}

run();
