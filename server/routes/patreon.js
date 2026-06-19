import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { pool } from "../db.js";

const router = express.Router();

const TIER_MAP = {
  "26103300": "Booster",
  "26103332": "Támogató",
  "26843691": "Szuper Támogató",
  "26103439": "Booster"
};

async function fetchMembershipWithToken(accessToken) {
  const CAMPAIGN_ID = process.env.PATREON_CAMPAIGN_ID;
  const res = await fetch(
    "https://www.patreon.com/api/oauth2/v2/identity?include=memberships.currently_entitled_tiers,memberships.campaign&fields[member]=patron_status",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Patreon API ${res.status}`);
  const data = await res.json();

  // Csak a MI kampányunkhoz tartozó membership-et nézzük
  const membership = data.included?.find(i =>
    i.type === "member" &&
    i.relationships?.campaign?.data?.id === CAMPAIGN_ID
  );
  let active = false;
  let tier = null;

  if (membership) {
    active = membership.attributes?.patron_status === "active_patron";
    const tierId = membership.relationships?.currently_entitled_tiers?.data?.[0]?.id;
    if (active && tierId) tier = TIER_MAP[tierId] || null;
  }
  return { active, tier };
}

/* ===============================
   GET /api/patreon/status
=============================== */
router.get("/status", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const userId = req.session.user.id;

  const { rows } = await pool.query(
    `SELECT tier, active, payment_source, access_token
     FROM patreon_status WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  if (!rows.length) {
    return res.json({ connected: false });
  }

  const row = rows[0];
  // Patreon-osan összekapcsoltnak csak akkor számít, ha van access_token (OAuth)
  const patreonConnected = !!row.access_token;

  res.json({
    connected: patreonConnected,
    tier: row.tier,
    active: row.active,
    payment_source: row.payment_source,
  });
});

/* ===============================
   GET /api/patreon/connect
=============================== */
router.get("/connect", (req, res) => {
  if (!req.session.user) {
    return res.status(401).end();
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.PATREON_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/api/patreon/callback`,
    scope: "identity identity.memberships"
  });

  res.redirect(
    `https://www.patreon.com/oauth2/authorize?${params.toString()}`
  );
});

/* ===============================
   GET /api/patreon/callback
=============================== */
router.get("/callback", async (req, res) => {
  if (!req.session.user) {
    console.error("❌ No session in callback");
    return res.redirect("/login.html");
  }
 
  const { code, error } = req.query;
  const userId = req.session.user.id;
  
  if (error) {
    console.error("❌ Patreon OAuth error:", error);
    return res.redirect(`/settings.html?patreon=error&reason=${encodeURIComponent(error)}`);
  }
  
  if (!code) {
    console.error("❌ No code parameter");
    return res.redirect("/settings.html?patreon=error&reason=no_code");
  }
 
  try {
    console.log("🔵 Patreon callback started for user:", userId);
 
    /* TOKEN EXCHANGE */
    const tokenRes = await fetch("https://www.patreon.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PATREON_CLIENT_SECRET,
        redirect_uri: `${process.env.BASE_URL}/api/patreon/callback`
      })
    });
 
    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("❌ Token exchange failed:", errorText);
      return res.redirect("/settings.html?patreon=error&reason=token_exchange");
    }
 
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
 
    console.log("✅ Access token received");
 
    /* USER IDENTITY */
    const meRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const me = await meRes.json();
    const patreonUserId = me.data.id;
    console.log("✅ Patreon user ID:", patreonUserId);

    /* MEMBERSHIP DATA */
    const { active, tier } = await fetchMembershipWithToken(accessToken);
    console.log("✅ Membership data:", { active, tier });

    /* DATABASE UPDATE — access_token is mentjük */
    // Ha van már Stripe sora a user-nek, csak az OAuth mezőket frissítjük (ne töröljük a Stripe adatot)
    const { rows: existingRows } = await pool.query(
      `SELECT patreon_user_id, payment_source FROM patreon_status WHERE user_id = $1`, [userId]
    );

    if (existingRows.length && existingRows[0].payment_source === "stripe") {
      // Stripe fizető csatolja Pateront: csak az OAuth adatokat adjuk hozzá, tier/active marad Stripe-os
      await pool.query(
        `UPDATE patreon_status SET access_token = $1, last_sync = NOW() WHERE user_id = $2`,
        [accessToken, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO patreon_status (patreon_user_id, user_id, active, tier, access_token, last_sync)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (patreon_user_id)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           active = EXCLUDED.active,
           tier = EXCLUDED.tier,
           access_token = EXCLUDED.access_token,
           last_sync = NOW()`,
        [patreonUserId, userId, active, tier, accessToken]
      );
    }
    console.log("✅ PATREON CALLBACK SUCCESS");

    res.redirect("/settings.html?patreon=connected");
 
  } catch (err) {
    console.error("❌ PATREON CALLBACK ERROR:", err);
    console.error("   Stack:", err.stack);
    res.redirect(`/settings.html?patreon=error&reason=${encodeURIComponent(err.message)}`);
  }
});

/* ===============================
   POST /api/patreon/sync  — azonnali frissítés
=============================== */
router.post("/sync", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });

  const { rows } = await pool.query(
    `SELECT access_token, payment_source FROM patreon_status WHERE user_id = $1`,
    [req.session.user.id]
  );

  if (!rows.length || !rows[0].access_token) {
    return res.status(404).json({ error: "Nincs összekapcsolt Patreon fiók." });
  }

  try {
    const { active, tier } = await fetchMembershipWithToken(rows[0].access_token);

    // Csak Patreon fizetőknél frissítjük az active/tier mezőt (ne írjuk felül a Stripe tier-t)
    if (rows[0].payment_source !== "stripe") {
      await pool.query(
        `UPDATE patreon_status SET active = $1, tier = $2, last_sync = NOW() WHERE user_id = $3`,
        [active, tier, req.session.user.id]
      );
    } else {
      await pool.query(
        `UPDATE patreon_status SET last_sync = NOW() WHERE user_id = $1`,
        [req.session.user.id]
      );
    }

    res.json({ success: true, active, tier });
  } catch (err) {
    console.error("Patreon sync hiba:", err);
    res.status(502).json({ error: "Patreon API nem elérhető, próbáld újra." });
  }
});

/* ===============================
   POST /api/patreon/webhook  — valós idejű értesítések
=============================== */
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const secret = process.env.PATREON_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers["x-patreon-signature"];
    const expected = crypto.createHmac("md5", secret).update(req.body).digest("hex");
    if (sig !== expected) return res.status(401).end();
  }

  try {
    const event = req.headers["x-patreon-event"];
    const body = JSON.parse(req.body.toString());

    if (!["members:pledge:create","members:pledge:update","members:pledge:delete"].includes(event)) {
      return res.status(200).end();
    }

    const patreonUserId = body.data?.relationships?.user?.data?.id;
    if (!patreonUserId) return res.status(200).end();

    const patronStatus = body.data?.attributes?.patron_status;
    const tierId = body.data?.relationships?.currently_entitled_tiers?.data?.[0]?.id;

    const active = patronStatus === "active_patron";
    const tier = (active && tierId) ? (TIER_MAP[tierId] || null) : null;

    await pool.query(
      `UPDATE patreon_status SET active = $1, tier = $2, last_sync = NOW()
       WHERE patreon_user_id = $3`,
      [active, tier, String(patreonUserId)]
    );

    console.log(`Patreon webhook [${event}] user=${patreonUserId} active=${active} tier=${tier}`);
    res.status(200).end();
  } catch (err) {
    console.error("Patreon webhook hiba:", err);
    res.status(500).end();
  }
});

/* ===============================
   POST /api/patreon/disconnect
=============================== */
router.post("/disconnect", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  // Ha Stripe előfizetés is van, csak az OAuth adatokat töröljük, nem az egész sort
  const { rows } = await pool.query(
    `SELECT stripe_subscription_id, payment_source FROM patreon_status WHERE user_id = $1`,
    [req.session.user.id]
  );

  if (rows[0]?.stripe_subscription_id && rows[0]?.payment_source === "stripe") {
    // Stripe előfizető: csak a Patreon OAuth mezőket nullázzuk
    await pool.query(
      `UPDATE patreon_status SET access_token = NULL, last_sync = NULL
       WHERE user_id = $1`,
      [req.session.user.id]
    );
  } else {
    await pool.query(
      `DELETE FROM patreon_status WHERE user_id = $1`,
      [req.session.user.id]
    );
  }

  res.json({ success: true });
});

export default router;
