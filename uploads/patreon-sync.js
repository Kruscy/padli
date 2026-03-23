import dotenv from 'dotenv';
dotenv.config({ path: '/opt/padli/.env' });
import fetch from 'node-fetch';
import { pool } from './db.js';

console.log("ENV TEST:", process.env.PATREON_CAMPAIGN_ID);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAllMembers() {
  let url = `https://www.patreon.com/api/oauth2/v2/campaigns/${process.env.PATREON_CAMPAIGN_ID}/members?include=currently_entitled_tiers,user&fields[member]=patron_status&page[count]=50`;

  const members = [];

  while (url) {
    console.log("Fetching:", url);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.PATREON_ACCESS_TOKEN}`
      }
    });

    const data = await res.json();

    // 🔥 DEBUG + védelem
    if (!data || !data.data) {
      console.error("INVALID PATREON RESPONSE:", data);
      break;
    }

    members.push(...data.data);

    url = data.links?.next || null;

    // rate limit védelem
    await delay(1000);
  }

  return members;
}

async function syncPatreon() {
  console.log("Patreon sync started");
const TIER_MAP = {
  "26103300": "Booster",
  "26103332": "Támogató",
  "26843691": "Szuper Támogató"
};
  const members = await fetchAllMembers();

  console.log(`Fetched ${members.length} members`);

  const activeIds = new Set();

  for (const m of members) {
    try {
      const patreonUserId = String(m.relationships.user.data.id);

const userRes = await pool.query(
  `SELECT user_id FROM patreon_status WHERE patreon_user_id = $1`,
  [patreonUserId]
);

let isAdmin = false;

if (userRes.rows.length) {
  const userId = userRes.rows[0].user_id;

  const roleRes = await pool.query(
    `SELECT role FROM users WHERE id = $1`,
    [userId]
  );

  isAdmin = roleRes.rows[0]?.role === "admin";
}

 const active =
        m.attributes?.patron_status === "active_patron";
if (isAdmin) {
  active = true;
}
      const rawTierId =
        m.relationships.currently_entitled_tiers?.data?.[0]?.id || null;

let tier = null;

if (active) {
  tier = TIER_MAP[rawTierId] || null;
}
 if (isAdmin) {
  tier = "admin";
}     
      activeIds.add(patreonUserId);

      console.log({
        patreonUserId,
        active,
        tier
      });

      await pool.query(
        `
        UPDATE patreon_status
        SET active = $1,
            tier = $2,
            last_sync = NOW()
        WHERE patreon_user_id = $3
        `,
        [active, tier, patreonUserId]
      );

    } catch (err) {
      console.error("SYNC USER ERROR:", err);
    }
  }

  // 🔥 akik már nem patronok
  if (activeIds.size > 0) {
    const ids = [...activeIds];

    await pool.query(
      `
      UPDATE patreon_status
      SET active = false,
          tier = NULL,
          last_sync = NOW()
WHERE patreon_user_id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(",")})
AND user_id NOT IN (
  SELECT id FROM users WHERE role = 'admin'
) 
  `
      ,
      ids
    );
  }
await pool.query(`
  UPDATE patreon_status
  SET active = true,
      tier = 'Admin',
      last_sync = NOW()
  WHERE user_id IN (
    SELECT id FROM users WHERE role = 'admin'
  )
`);
  console.log("Patreon sync finished");
}

// futtatás
syncPatreon()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
  });
