/**
 * Egyszeri script: email emlékeztető küldése azoknak a Stripe-fizetőknek,
 * akik még nem adták meg a számlázási címüket.
 * Futtatás: node server/scripts/email-billing-address-reminder.js
 */

import "dotenv/config";
import { pool } from "../db.js";
import { sendMail } from "../mail.js";

function billingAddressReminderHtml(username) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;padding:32px 28px">
    <img src="${process.env.SITE_URL || ""}/assets/logo.png" style="height:48px;margin-bottom:20px" alt="${process.env.SITE_NAME || "PadlizsanFanSub"}">
    <h2 style="color:#a78bfa;margin:0 0 12px">🧾 Számlázási cím szükséges</h2>
    <p style="color:#bbb;line-height:1.7">Szia <strong style="color:#fff">${username}</strong>!</p>
    <p style="color:#bbb;line-height:1.7">Adminisztrációs okokból szükségünk van a számlázási címedre (lakcím), hogy a Stripe-előfizetésedhez kapcsolódó számládat helyesen tudjuk kiállítani.</p>
    <p style="color:#bbb;line-height:1.7">Kérjük, jelentkezz be az oldalra, ahol egy felugró ablakban tudod megadni a címet:</p>
    <a href="${process.env.SITE_URL || "https://padlizsanfansub.hu"}/login.html" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;margin:16px 0">
      Bejelentkezés
    </a>
    <p style="color:#888;font-size:0.82rem;margin-top:20px">Az adatot kizárólag a számla kiállításához használjuk, harmadik félnek nem adjuk ki (a számlázó rendszerünk kivételével), és nem használjuk fel más célra. Bővebben az <a href="${process.env.SITE_URL || "https://padlizsanfansub.hu"}/privacy.html" style="color:#a78bfa">Adatvédelmi Nyilatkozatban</a>.</p>
    <hr style="border-color:#2a2a3a;margin:20px 0">
    <p style="color:#555;font-size:0.78rem">${process.env.SITE_NAME || "PadlizsanFanSub"} · ${(process.env.SITE_URL || "").replace(/^https?:\/\//, "")}</p>
  </div>`;
}

async function run() {
  const { rows } = await pool.query(`
    SELECT DISTINCT u.id, u.username, u.email
    FROM users u
    JOIN patreon_status ps ON ps.user_id = u.id AND ps.payment_source = 'stripe'
    WHERE u.billing_address IS NULL
    ORDER BY u.id
  `);

  console.log(`${rows.length} felhasználónak küldünk email emlékeztetőt.`);

  let ok = 0, err = 0;
  for (const row of rows) {
    if (!row.email || !row.email.includes("@")) {
      console.warn(`⚠️  user_id=${row.id} (${row.username}) — nincs érvényes email, kihagyva`);
      continue;
    }
    try {
      await sendMail({
        to: row.email,
        subject: "🧾 Számlázási cím szükséges – PadlizsanFanSub",
        html: billingAddressReminderHtml(row.username),
      });
      console.log(`✅ user_id=${row.id} (${row.username}) -> ${row.email}`);
      ok++;
    } catch (e) {
      console.error(`❌ user_id=${row.id} (${row.username}) -> ${e.message}`);
      err++;
    }
  }

  console.log(`\nKész: ${ok} email elküldve, ${err} hiba`);
  await pool.end();
}

run();
