import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { pool } from './db.js';
// Env betöltés csak CLI-módban kell (lásd fájl vége) — ha a szerver importálja
// (pl. webhook-trigger), a db.js már betöltötte a saját (élő/dev) .env-jét,
// nem szabad itt egy hardcode-olt élő .env-vel felülírni/kevert env-et okozni.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAllMembers() {
  let url = `https://www.patreon.com/api/oauth2/v2/campaigns/${process.env.PATREON_CAMPAIGN_ID}/members?include=currently_entitled_tiers,user&fields[member]=patron_status,email&page[count]=50`;

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

export async function syncPatreon() {
  console.log("Patreon sync started");
const TIER_MAP = {
  "26103300": "Booster",
  "26103332": "Támogató",
  "26843691": "Szuper Támogató",
  "26103439": "Booster"
};
  const members = await fetchAllMembers();
console.log(`Fetched ${members.length} members`);


  const activeIds = new Set();

  for (const m of members) {
    try {
      const patreonUserId = String(m.relationships.user.data.id);

let statusRes = await pool.query(
  `SELECT user_id FROM patreon_status WHERE patreon_user_id = $1`,
  [patreonUserId]
);

// Ha nincs még linkelve: próbáljunk email alapján párosítani
// (csak megerősített email című site userekhez)
if (!statusRes.rows.length) {
  const memberEmail = m.attributes?.email;
  if (memberEmail) {
    const emailMatch = await pool.query(
      `SELECT id FROM users WHERE lower(email) = lower($1) AND email_verified = true`,
      [memberEmail]
    );
    if (emailMatch.rows.length) {
      const matchedUserId = emailMatch.rows[0].id;

      // A site-fióknak lehet már van patreon_status sora egy MÁSIK
      // patreon_user_id-vel (pl. a felhasználó új Patreon-fiókkal vagy
      // újra-regisztrálva csatlakozott). Mivel user_id egyedi kulcs,
      // sima INSERT itt mindig ütközne — ezért előbb ezt kezeljük.
      const existingByUser = await pool.query(
        `SELECT patreon_user_id, payment_source FROM patreon_status WHERE user_id = $1`,
        [matchedUserId]
      );

      if (existingByUser.rows.length) {
        if (existingByUser.rows[0].payment_source === "stripe") {
          // Stripe-fizetőt nem érintünk, a hozzáférését a Stripe vezérli.
          console.log(`Kihagyva (Stripe-fizető): user ${matchedUserId} másik Patreon-fiókkal (${patreonUserId}) is rendelkezik`);
        } else {
          // Régi sor frissítése az új Patreon-azonosítóra, hogy a lenti
          // active/tier UPDATE már ezt a sort találja meg.
          await pool.query(
            `UPDATE patreon_status SET patreon_user_id = $1, last_sync = NOW() WHERE user_id = $2`,
            [patreonUserId, matchedUserId]
          );
          console.log(`Re-linked Patreon ${patreonUserId} (${memberEmail}) → user ${matchedUserId} (régi patreon_user_id: ${existingByUser.rows[0].patreon_user_id})`);
        }
      } else {
        await pool.query(
          `INSERT INTO patreon_status (patreon_user_id, user_id, active, tier, payment_source, last_sync)
           VALUES ($1, $2, false, NULL, 'patreon', NOW())
           ON CONFLICT (patreon_user_id) DO NOTHING`,
          [patreonUserId, matchedUserId]
        );
        console.log(`Auto-linked Patreon ${patreonUserId} (${memberEmail}) → user ${matchedUserId}`);
      }

      statusRes = await pool.query(
        `SELECT user_id FROM patreon_status WHERE patreon_user_id = $1`,
        [patreonUserId]
      );
    }
  }
}

const userRes = statusRes;

let isAdmin = false;

if (userRes.rows.length) {
  const userId = userRes.rows[0].user_id;

  const roleRes = await pool.query(
    `SELECT role FROM users WHERE id = $1`,
    [userId]
  );

  isAdmin = roleRes.rows[0]?.role === "admin";
}

// ACTIVE státusz
let active =
  m.attributes?.patron_status === "active_patron";
// Tier ID
const rawTierId =
  m.relationships.currently_entitled_tiers?.data?.[0]?.id || null;
if (rawTierId && !TIER_MAP[rawTierId]) {
  console.log("UNKNOWN TIER ID:", rawTierId);
}
// TIER LOGIKA
let tier = null;

if (active) {
  tier = TIER_MAP[rawTierId] || null;
}

// ADMIN FELÜLÍRÁS
if (isAdmin) {
  active = true;
  tier = "Admin";
}
      activeIds.add(patreonUserId);


      await pool.query(
        `
        UPDATE patreon_status
        SET active = $1,
            tier = $2,
            last_sync = NOW()
        WHERE patreon_user_id = $3
          AND (payment_source IS NULL OR payment_source = 'patreon')
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
        AND (payment_source IS NULL OR payment_source = 'patreon')
        AND user_id NOT IN (
          SELECT id FROM users WHERE role = 'admin'
        )
      `,
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

// ── CLI MÓD: node server/patreon-sync.js (pl. cron) ──────────────────────
// Ha más modul importálja (pl. a webhook-trigger a routes/patreon.js-ből),
// ne fusson le automatikusan és ne állítsa le a teljes szerver processzt.
if (process.argv[1] && process.argv[1].endsWith("patreon-sync.js")) {
  dotenv.config({ path: '/opt/padli/.env' });
  syncPatreon()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("FATAL ERROR:", err);
      process.exit(1);
    });
}
