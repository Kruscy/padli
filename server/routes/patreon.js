import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

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

  // ❌ nincs összekötve
  if (!rows.length) {
    return res.json({ connected: false });
  }

  // ✅ össze van kötve
  res.json({
    connected: true,
    tier: rows[0].tier,
    active: rows[0].active
  });
});
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
import fetch from "node-fetch";

router.get("/callback", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }

  const { code } = req.query;
  if (!code) {
    return res.redirect("/settings.html?patreon=error");
  }

  try {
    /* === TOKEN CSERE === */
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

    /* === USER INFO === */
    const meRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity?fields[user]=full_name",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const me = await meRes.json();
    const patreonUserId = me.data.id;

    /* === DB MENTÉS === */
    await pool.query(
      `
      INSERT INTO patreon_status (user_id, patreon_user_id, active)
      VALUES ($1, $2, true)
      ON CONFLICT (user_id)
      DO UPDATE SET
        patreon_user_id = EXCLUDED.patreon_user_id,
        active = true,
        last_sync = now()
      `,
      [req.session.user.id, patreonUserId]
    );

    res.redirect("/settings.html?patreon=connected");
  } catch (err) {
    console.error("PATREON CALLBACK ERROR:", err);
    res.redirect("/settings.html?patreon=error");
  }
});

export default router;
