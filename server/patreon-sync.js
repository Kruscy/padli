import fetch from "node-fetch";
import { pool } from "./db.js";

export async function syncPatreonForUser(userId) {
  /* === lekérjük a patreon kapcsolatot === */
  const { rows } = await pool.query(
    `
	SELECT active, tier
    FROM patreon_status
    WHERE user_id = $1
    `,
    [userId]
  );

  if (!rows.length) {
    return; // nincs összekötve
  }

  const patreonUserId = rows[0].patreon_user_id;

  /* === Patreon API: memberships === */
  const res = await fetch(
    `https://www.patreon.com/api/oauth2/v2/members?include=currently_entitled_tiers&fields[member]=patron_status`,
    {
      headers: {
        Authorization: `Bearer ${process.env.PATREON_ACCESS_TOKEN}`
      }
    }
  );

  const data = await res.json();

  const member = data.data.find(
    m => m.relationships.user?.data?.id === patreonUserId
  );

  /* === ha nincs aktív membership === */
  if (!member) {
    await pool.query(
      `
      UPDATE patreon_status
      SET active = false,
          tier = NULL,
          last_sync = now()
      WHERE user_id = $1
      `,
      [userId]
    );

    await pool.query(
      `
      UPDATE users
      SET role = 'user'
      WHERE id = $1
        AND role != 'admin'
      `,
      [userId]
    );

    return;
  }

  /* === tier meghatározás === */
  const tierTitle =
    member.relationships.currently_entitled_tiers.data[0]?.id || null;

  let tier = null;
  if (tierTitle?.includes("Támogató")) tier = "tamogato";
  if (tierTitle?.includes("Booster")) tier = "booster";
  if (tierTitle?.includes("Szuper")) tier = "szuper";

  /* === DB frissítés === */
  await pool.query(
    `
    UPDATE patreon_status
    SET active = true,
        tier = $1,
        last_sync = now()
    WHERE user_id = $2
    `,
    [tier, userId]
  );

  /* === ROLE FRISSÍTÉS (ADMIN VÉDETT) === */
  const role = roleFromTier(tier, true);

  await pool.query(
    `
    UPDATE users
    SET role = $1
    WHERE id = $2
      AND role != 'admin'
    `,
    [role, userId]
  );
}
