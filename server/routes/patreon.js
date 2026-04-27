import express from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";

const router = express.Router();

/* ===============================
   GET /api/patreon/status
=============================== */
router.get("/status", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const userId = req.session.user.id;

  const { rows } = await pool.query(
    `
    SELECT tier, active
    FROM patreon_status
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (!rows.length) {
    return res.json({ connected: false });
  }

  res.json({
    connected: true,
    tier: rows[0].tier,
    active: rows[0].active
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
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
 
    const me = await meRes.json();
    const patreonUserId = me.data.id;
    
    console.log("✅ Patreon user ID:", patreonUserId);
 
    /* MEMBERSHIP DATA */
    const memberRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity?include=memberships.currently_entitled_tiers&fields[member]=patron_status",
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
 
    const memberData = await memberRes.json();
 
    const membership = memberData.included?.find(
      (i) => i.type === "member"
    );
 
    let active = false;
    let tier = null;
 
    const TIER_MAP = {
      "26103300": "Booster",
      "26103332": "Támogató",
      "26843691": "Szuper Támogató"
    };
 
    if (membership) {
      active = membership.attributes?.patron_status === "active_patron";
      const tierId = membership.relationships?.currently_entitled_tiers?.data?.[0]?.id;
 
      if (active && tierId) {
        tier = TIER_MAP[tierId] || null;
      }
    }
 
    console.log("✅ Membership data:", { active, tier });
 
    /* DATABASE UPDATE */
    console.log("🔵 Database update starting...");
    console.log("   patreonUserId:", patreonUserId);
    console.log("   userId:", userId);
    console.log("   active:", active);
    console.log("   tier:", tier);
 
    const result = await pool.query(
      `INSERT INTO patreon_status (patreon_user_id, user_id, active, tier, last_sync)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (patreon_user_id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         active = EXCLUDED.active,
         tier = EXCLUDED.tier,
         last_sync = NOW()
       RETURNING *`,
      [patreonUserId, userId, active, tier]
    );
 
    console.log("✅ Database updated:", result.rows[0]);
    console.log("✅ PATREON CALLBACK SUCCESS");
 
    res.redirect("/settings.html?patreon=connected");
 
  } catch (err) {
    console.error("❌ PATREON CALLBACK ERROR:", err);
    console.error("   Stack:", err.stack);
    res.redirect(`/settings.html?patreon=error&reason=${encodeURIComponent(err.message)}`);
  }
});

/* ===============================
   POST /api/patreon/disconnect
=============================== */
router.post("/disconnect", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  await pool.query(
    `DELETE FROM patreon_status WHERE user_id = $1`,
    [req.session.user.id]
  );

  res.json({ success: true });
});

export default router;
