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
    redirect_uri: process.env.PATREON_REDIRECT_URI,
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
    return res.redirect("/login.html");
  }

  const { code } = req.query;
  if (!code) {
    return res.redirect("/settings.html?patreon=error");
  }

  try {
    /* === TOKEN === */
    const tokenRes = await fetch("https://www.patreon.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PATREON_CLIENT_SECRET,
        redirect_uri: process.env.PATREON_REDIRECT_URI
      })
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    /* === USER === */
    const meRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity",
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const me = await meRes.json();
    const patreonUserId = me.data.id;

    /* === MEMBERSHIP === */
    const memberRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity?include=memberships.currently_entitled_tiers&fields[member]=patron_status",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
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
      active =
        membership.attributes?.patron_status === "active_patron";

      const tierId =
        membership.relationships?.currently_entitled_tiers?.data?.[0]?.id;

      if (active) {
        tier = TIER_MAP[tierId] || null;
      }
    }

    /* === DB === */
    await pool.query(
      `
      INSERT INTO patreon_status (user_id, patreon_user_id, active, tier)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id)
      DO UPDATE SET
        patreon_user_id = EXCLUDED.patreon_user_id,
        active = EXCLUDED.active,
        tier = EXCLUDED.tier,
        last_sync = now()
      `,
      [req.session.user.id, patreonUserId, active, tier]
    );

    res.redirect("/settings.html?patreon=connected");

  } catch (err) {
    console.error("PATREON CALLBACK ERROR:", err);
    res.redirect("/settings.html?patreon=error");
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
