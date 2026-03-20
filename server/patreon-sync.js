import fetch from "node-fetch";
import { pool } from "./db.js";

export async function syncPatreonForUser(userId) {
  const { rows } = await pool.query(
    `
    SELECT patreon_user_id
    FROM patreon_status
    WHERE user_id = $1
    `,
    [userId]
  );

  if (!rows.length) return;

  const patreonUserId = rows[0].patreon_user_id;

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

  // ❌ nincs előfizetés
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

    // ADMIN VÉDETT
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

  // ✅ VAN előfizetés
  await pool.query(
    `
    UPDATE patreon_status
    SET active = true,
        last_sync = now()
    WHERE user_id = $1
    `,
    [userId]
  );

  await pool.query(
    `
    UPDATE users
    SET role = 'subscriber'
    WHERE id = $1
      AND role != 'admin'
    `,
    [userId]
  );
}
