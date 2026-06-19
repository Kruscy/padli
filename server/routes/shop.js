/* ============================================================
   routes/shop.js - Stripe pont vásárlás + tier előfizetések
   ============================================================ */

import express from "express";
import Stripe  from "stripe";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { createInvoice } from "../billingo.js";

const router = express.Router();

const stripe          = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET;
const SITE_URL        = process.env.SITE_URL || "https://padlizsanfansub.hu";

/* ── PONT CSOMAGOK ───────────────────────────────────────── */
const PACKAGES = {
  starter: { id: "starter", name: "Starter csomag",  description: "200 kép AI fordítása",  points: 200,  price: 999  },
  pro:     { id: "pro",     name: "Pro csomag",       description: "625 kép AI fordítása",  points: 625,  price: 2499 },
  ultra:   { id: "ultra",   name: "Ultra csomag",     description: "1666 kép AI fordítása", points: 1666, price: 4999 },
  max:     { id: "max",     name: "Max csomag",       description: "4000 kép AI fordítása", points: 4000, price: 9999 },
};

/* ── TIER ELŐFIZETÉSEK ───────────────────────────────────── */
const TIERS = {
  tamogato: {
    id:         "tamogato",
    name:       "Támogató",
    tier:       "Támogató",
    price:      500,
    lookupKey:  "padli_tamogato_monthly_v2",
    description: "Korai hozzáférés + exkluzív tartalmak",
  },
  booster: {
    id:         "booster",
    name:       "Booster",
    tier:       "Booster",
    price:      1000,
    lookupKey:  "padli_booster_monthly_v2",
    description: "Booster juttatások + pontok",
  },
  szuper: {
    id:         "szuper",
    name:       "Szuper Támogató",
    tier:       "Szuper Támogató",
    price:      2000,
    lookupKey:  "padli_szuper_tamogato_monthly_v2",
    description: "Minden előny + prioritás támogatás",
  },
};

/* ── Stripe Price lazy létrehozás (lookup_key alapján) ───── */
const _priceCache = {};

async function getOrCreateStripePrice(tierId) {
  if (_priceCache[tierId]) return _priceCache[tierId];

  const pkg = TIERS[tierId];
  if (!pkg) throw new Error("Ismeretlen tier: " + tierId);

  // Keresés lookup_key alapján
  const existing = await stripe.prices.list({ lookup_keys: [pkg.lookupKey], limit: 1 });
  if (existing.data.length) {
    _priceCache[tierId] = existing.data[0].id;
    return _priceCache[tierId];
  }

  // Termék létrehozás
  const product = await stripe.products.create({
    name:     pkg.name,
    metadata: { tier: pkg.tier, site: "padlizsanfansub" },
  });

  // Ár létrehozás (HUF: Stripe ×100 alapú, tehát 500 Ft = 50000)
  const price = await stripe.prices.create({
    product:    product.id,
    unit_amount: pkg.price * 100,
    currency:   "huf",
    recurring:  { interval: "month" },
    lookup_key: pkg.lookupKey,
    transfer_lookup_key: true,
  });

  _priceCache[tierId] = price.id;
  console.log(`[Stripe] Ár létrehozva: ${pkg.name} → ${price.id}`);
  return price.id;
}

/* ── Stripe Customer keresés / létrehozás ────────────────── */
async function getOrCreateCustomer(userId, email, name) {
  const { rows } = await pool.query(
    `SELECT stripe_customer_id FROM users WHERE id = $1`, [userId]
  );
  if (rows[0]?.stripe_customer_id) return rows[0].stripe_customer_id;

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { userId: String(userId) },
  });

  await pool.query(
    `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
    [customer.id, userId]
  );
  return customer.id;
}

/* ═══════════════════════════════════════════════════════════
   PONT CSOMAGOK
   ═══════════════════════════════════════════════════════════ */

router.get("/packages", requireLogin, (req, res) => {
  res.json(Object.values(PACKAGES));
});

router.post("/checkout", requireLogin, async (req, res) => {
  const { packageId } = req.body;
  const pkg = PACKAGES[packageId];
  if (!pkg) return res.status(400).json({ error: "Érvénytelen csomag" });

  const userId   = req.session.user.id;
  const username = req.session.user.username;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency:     "huf",
          unit_amount:  pkg.price * 100,
          product_data: { name: pkg.name, description: pkg.description },
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${SITE_URL}/shop.html?success=1&package=${pkg.id}`,
      cancel_url:  `${SITE_URL}/shop.html?cancelled=1`,
      metadata: {
        type:      "points",
        userId:    String(userId),
        username,
        packageId: pkg.id,
        points:    String(pkg.points),
      },
      customer_email: req.session.user.email,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[SHOP] checkout error:", err);
    res.status(500).json({ error: "Stripe hiba" });
  }
});

/* ═══════════════════════════════════════════════════════════
   TIER ELŐFIZETÉSEK
   ═══════════════════════════════════════════════════════════ */

router.get("/tiers", (req, res) => {
  res.json(Object.values(TIERS).map(t => ({
    id: t.id, name: t.name, tier: t.tier, price: t.price, description: t.description
  })));
});

router.post("/subscribe", requireLogin, async (req, res) => {
  const { tierId } = req.body;
  const tier = TIERS[tierId];
  if (!tier) return res.status(400).json({ error: "Érvénytelen tier" });

  const userId   = req.session.user.id;
  const username = req.session.user.username;
  const email    = req.session.user.email;

  try {
    // Ellenőrzés: van-e már aktív Stripe előfizetése?
    const { rows } = await pool.query(
      `SELECT stripe_subscription_id FROM patreon_status WHERE user_id = $1 AND payment_source = 'stripe'`,
      [userId]
    );
    if (rows[0]?.stripe_subscription_id) {
      return res.status(400).json({ error: "Már van aktív Stripe előfizetésed. Először mondj le a meglévőt." });
    }

    const customerId = await getOrCreateCustomer(userId, email, username);
    const priceId    = await getOrCreateStripePrice(tierId);

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode:        "subscription",
      success_url: `${SITE_URL}/settings.html?sub=success&tier=${encodeURIComponent(tier.tier)}`,
      cancel_url:  `${SITE_URL}/settings.html?sub=cancelled`,
      metadata: {
        type:     "subscription",
        userId:   String(userId),
        username,
        tierId,
        tierName: tier.tier,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[SHOP] subscribe error:", err);
    res.status(500).json({ error: "Stripe hiba: " + err.message });
  }
});

router.delete("/subscription", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const { rows } = await pool.query(
      `SELECT stripe_subscription_id FROM patreon_status WHERE user_id = $1 AND payment_source = 'stripe'`,
      [userId]
    );
    const subId = rows[0]?.stripe_subscription_id;
    if (!subId) return res.status(400).json({ error: "Nincs aktív Stripe előfizetés" });

    // Lemondás a periódus végén (nem azonnal)
    await stripe.subscriptions.update(subId, { cancel_at_period_end: true });

    res.json({ ok: true, message: "Előfizetés lemondva — az aktuális időszak végéig aktív marad." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/my-subscription", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const { rows } = await pool.query(`
      SELECT tier, payment_source, stripe_subscription_id, stripe_period_end, active
      FROM patreon_status WHERE user_id = $1
    `, [userId]);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   STRIPE WEBHOOK
   ═══════════════════════════════════════════════════════════ */

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[SHOP] webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      /* ── Egyszeri vásárlás befejezve ─── */
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.payment_status !== "paid" && session.mode !== "subscription") break;

        const meta = session.metadata || {};
        const userId = parseInt(meta.userId);
        if (!userId) break;

        if (meta.type === "points") {
          await handlePointsPurchase(session, meta, userId);
        } else if (meta.type === "subscription") {
          await handleSubscriptionActivated(session, meta, userId);
        }
        break;
      }

      /* ── Előfizetés törlése / lejárat ─── */
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await pool.query(`
          UPDATE patreon_status
          SET tier = NULL, active = false, stripe_subscription_id = NULL,
              stripe_period_end = NULL
          WHERE stripe_subscription_id = $1 AND payment_source = 'stripe'
        `, [sub.id]);
        console.log(`[SHOP] Előfizetés törölve: ${sub.id}`);
        break;
      }

      /* ── Ismétlődő fizetés sikeres (megújulás) ─── */
      case "invoice.payment_succeeded": {
        const inv = event.data.object;
        if (inv.billing_reason === "subscription_create") break; // első aktiváláskor már kezeltük

        const sub = await stripe.subscriptions.retrieve(inv.subscription);
        const customerId = sub.customer;

        const { rows } = await pool.query(
          `SELECT id, email, username FROM users WHERE stripe_customer_id = $1`, [customerId]
        );
        if (!rows.length) break;
        const user = rows[0];

        // Periódus frissítés
        const periodEnd = new Date(sub.current_period_end * 1000);
        await pool.query(`
          UPDATE patreon_status SET stripe_period_end = $1, active = true
          WHERE user_id = $2 AND payment_source = 'stripe'
        `, [periodEnd, user.id]);

        // Billingo számla megújulásra
        const tierMeta = sub.metadata?.tierName;
        if (tierMeta && user.email) {
          const amountHuf = inv.amount_paid;
          createInvoice({
            email: user.email,
            name:  user.username,
            items: [{ name: `PadlizsanFanSub ${tierMeta} támogatás (megújulás)`, price: amountHuf }],
          }).catch(() => {});
        }
        break;
      }
    }
  } catch (err) {
    console.error("[SHOP] webhook feldolgozás hiba:", err);
  }

  res.json({ received: true });
});

/* ── Segédfüggvény: pont csomag feldolgozás ──────────────── */
async function handlePointsPurchase(session, meta, userId) {
  if (session.payment_status !== "paid") return;

  const points    = parseInt(meta.points);
  const packageId = meta.packageId;
  const pkg       = PACKAGES[packageId];

  // Duplikáció védelem
  const existing = await pool.query(
    "SELECT 1 FROM shop_orders WHERE stripe_session_id = $1", [session.id]
  );
  if (existing.rows.length) return;

  await pool.query(
    `INSERT INTO user_points (user_id, fix_id, points, approved_by, earned_at, spent)
     VALUES ($1, NULL, $2, NULL, NOW(), false)`,
    [userId, points]
  );
  await pool.query(
    `INSERT INTO shop_orders (user_id, stripe_session_id, package_id, points, amount_huf, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, session.id, packageId, points, pkg?.price || 0]
  );

  // Billingo számla
  const { rows: userRows } = await pool.query(
    `SELECT email, username FROM users WHERE id = $1`, [userId]
  );
  if (userRows[0]?.email && pkg) {
    createInvoice({
      email: userRows[0].email,
      name:  userRows[0].username,
      items: [{ name: `${pkg.name} — ${pkg.points} pont`, price: pkg.price }],
    }).catch(() => {});
  }

  console.log(`[SHOP] ✅ ${points} pont jóváírva user_id=${userId}`);
}

/* ── Segédfüggvény: előfizetés aktiválás ─────────────────── */
async function handleSubscriptionActivated(session, meta, userId) {
  const tierId   = meta.tierId;
  const tierName = meta.tierName;
  const tier     = TIERS[tierId];

  // Stripe subscription ID lekérése a session-ből
  const subId  = session.subscription;
  const stripeSub = subId ? await stripe.subscriptions.retrieve(subId) : null;

  // Metadata mentése a subscription objektumra, hogy megújulásnál is elérhető legyen
  if (subId && tierId && tierName) {
    stripe.subscriptions.update(subId, {
      metadata: { tierId, tierName, userId: String(userId) }
    }).catch(() => {});
  }

  const periodEndTs = stripeSub?.current_period_end;
  const periodEnd = (periodEndTs && !isNaN(periodEndTs))
    ? new Date(periodEndTs * 1000)
    : null;

  // patreon_status upsert — patreon_user_id is required (NOT NULL PK); use synthetic value for Stripe-only users
  const { rows: existing } = await pool.query(
    `SELECT patreon_user_id FROM patreon_status WHERE user_id = $1`, [userId]
  );
  if (existing.length) {
    await pool.query(`
      UPDATE patreon_status SET
        tier = $2, active = true, payment_source = 'stripe',
        stripe_subscription_id = $3, stripe_period_end = $4
      WHERE user_id = $1
    `, [userId, tierName, subId || null, periodEnd]);
  } else {
    await pool.query(`
      INSERT INTO patreon_status (patreon_user_id, user_id, tier, active, payment_source, stripe_subscription_id, stripe_period_end)
      VALUES ($1, $2, $3, true, 'stripe', $4, $5)
    `, [`stripe_${userId}`, userId, tierName, subId || null, periodEnd]);
  }

  // Billingo számla
  const { rows: userRows } = await pool.query(
    `SELECT email, username FROM users WHERE id = $1`, [userId]
  );
  if (userRows[0]?.email && tier) {
    createInvoice({
      email: userRows[0].email,
      name:  userRows[0].username,
      items: [{ name: `PadlizsanFanSub ${tierName} támogatás — 1 hónap`, price: tier.price }],
    }).catch(() => {});
  }

  console.log(`[SHOP] ✅ Előfizetés aktiválva: ${tierName} user_id=${userId}`);

  // Havi Stripe előfizetők milestone értesítés (40-es határ)
  try {
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const { rows: countRows } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM patreon_status
      WHERE payment_source = 'stripe' AND active = true
        AND last_sync >= $1
    `, [monthStart]);
    // Aktiválás utáni friss szám (az épp beállított usert is beleszámítva)
    const { rows: totalRows } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM patreon_status
      WHERE payment_source = 'stripe' AND active = true
    `);
    const total = parseInt(totalRows[0]?.cnt || 0);
    if (total === 40) {
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link)
        VALUES (5, 'milestone', '🎉 Elértük a 40 Stripe előfizetőt ebben a hónapban!', '/admin.html')
      `);
      console.log("[SHOP] 🎉 Milestone értesítés elküldve: 40 Stripe előfizető");
    }
  } catch (err) {
    console.error("[SHOP] milestone check hiba:", err);
  }
}

router.get("/subscription-detail", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const { rows } = await pool.query(
      `SELECT stripe_subscription_id FROM patreon_status WHERE user_id = $1 AND payment_source = 'stripe'`,
      [userId]
    );
    const subId = rows[0]?.stripe_subscription_id;
    if (!subId) return res.json(null);

    const sub = await stripe.subscriptions.retrieve(subId);
    res.json({ cancel_at_period_end: sub.cancel_at_period_end });
  } catch (err) {
    res.json(null);
  }
});

/* ── Saját rendelések ────────────────────────────────────── */
router.get("/orders", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT package_id, points, amount_huf, created_at
       FROM shop_orders WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "DB hiba" });
  }
});

export default router;
