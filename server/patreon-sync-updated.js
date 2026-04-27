import dotenv from 'dotenv';
dotenv.config({ path: '/opt/padli/.env' });
import fetch from 'node-fetch';
import { pool } from './db.js';

console.log("ENV TEST:", process.env.PATREON_CAMPAIGN_ID);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Patreon Members + Email lekérdezés ─────────────────────────────────────
async function fetchAllMembers() {
  // FONTOS: fields[user]=email hozzáadva az email lekérdezéshez!
  let url = `https://www.patreon.com/api/oauth2/v2/campaigns/${process.env.PATREON_CAMPAIGN_ID}/members?include=currently_entitled_tiers,user&fields[member]=patron_status&fields[user]=email&page[count]=50`;

  const members = [];
  const userData = {}; // user_id -> user data (email) mapping

  while (url) {
    console.log("Fetching:", url);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.PATREON_ACCESS_TOKEN}`
      }
    });

    const data = await res.json();

    if (!data || !data.data) {
      console.error("INVALID PATREON RESPONSE:", data);
      break;
    }

    members.push(...data.data);
    
    // Email adatok gyűjtése az "included" részből
    if (data.included) {
      data.included.forEach(item => {
        if (item.type === 'user') {
          userData[item.id] = {
            email: item.attributes?.email || null
          };
        }
      });
    }

    url = data.links?.next || null;
    await delay(1000); // Rate limit védelem
  }

  return { members, userData };
}

// ── Patreon Sync ────────────────────────────────────────────────────────────
async function syncPatreon() {
  console.log("Patreon sync started");
  
  const TIER_MAP = {
    "26103300": "Booster",
    "26103332": "Támogató",
    "26843691": "Szuper Támogató",
    "26103439": "Booster"
  };
  
  const { members, userData } = await fetchAllMembers();
  console.log(`Fetched ${members.length} members`);

  const activeIds = new Set();
  let newPatrons = 0;
  let updatedPatrons = 0;

  for (const m of members) {
    try {
      const patreonUserId = String(m.relationships.user.data.id);
      
      // Email lekérése a userData-ból (lehet NULL!)
      const email = userData[patreonUserId]?.email || null;
      
      console.log(`  Patron ${patreonUserId}${email ? ` (${email})` : ' (no email)'}`);

      // Ellenőrzés: van-e már user_id a patreon_status-ban?
      const existingRes = await pool.query(
        `SELECT user_id FROM patreon_status WHERE patreon_user_id = $1`,
        [patreonUserId]
      );

      const existingUserId = existingRes.rows[0]?.user_id || null;
      let isAdmin = false;

      // Ha van user_id, ellenőrizzük az admin szerepkört
      if (existingUserId) {
        const roleRes = await pool.query(
          `SELECT role FROM users WHERE id = $1`,
          [existingUserId]
        );
        isAdmin = roleRes.rows[0]?.role === "admin";
      }

      // ACTIVE státusz
      let active = m.attributes?.patron_status === "active_patron";
      
      // Tier ID
      const rawTierId = m.relationships.currently_entitled_tiers?.data?.[0]?.id || null;
      if (rawTierId && !TIER_MAP[rawTierId]) {
        console.log("    ⚠️ UNKNOWN TIER ID:", rawTierId);
      }
      
      // TIER LOGIKA
      let tier = null;
      if (active && rawTierId) {
        tier = TIER_MAP[rawTierId] || null;
      }

      // ADMIN FELÜLÍRÁS
      if (isAdmin) {
        active = true;
        tier = "Admin";
      }
      
      activeIds.add(patreonUserId);

      // UPSERT - patreon_user_id PRIMARY KEY
      // user_id lehet NULL (nincs webes regisztráció)
      // email lehet NULL (nem adták meg Patreonon)
      const upsertRes = await pool.query(
        `INSERT INTO patreon_status (patreon_user_id, user_id, active, tier, email, last_sync)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (patreon_user_id) 
         DO UPDATE SET 
           active = EXCLUDED.active,
           tier = EXCLUDED.tier,
           email = COALESCE(EXCLUDED.email, patreon_status.email),
           last_sync = NOW()
         RETURNING (xmax = 0) AS is_new`,
        [patreonUserId, existingUserId, active, tier, email]
      );
      
      const isNew = upsertRes.rows[0]?.is_new;
      if (isNew) {
        newPatrons++;
        console.log(`    ✅ Új patron hozzáadva`);
      } else {
        updatedPatrons++;
        console.log(`    ♻️ Frissítve`);
      }
      
    } catch (err) {
      console.error("    ❌ SYNC USER ERROR:", err.message);
    }
  }

  console.log(`\n📊 Összesítés:`);
  console.log(`   Új patronok: ${newPatrons}`);
  console.log(`   Frissített patronok: ${updatedPatrons}`);

  // Akik már nem patronok (inaktívvá állítás)
  if (activeIds.size > 0) {
    const ids = [...activeIds];

    const inactiveRes = await pool.query(
      `UPDATE patreon_status
       SET active = false,
           tier = NULL,
           last_sync = NOW()
       WHERE patreon_user_id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(",")})
         AND user_id NOT IN (
           SELECT id FROM users WHERE role = 'admin'
         )
       RETURNING patreon_user_id`,
      ids
    );
    
    if (inactiveRes.rows.length > 0) {
      console.log(`   Inaktívvá téve: ${inactiveRes.rows.length}`);
    }
  }
  
  // Admin szerepkörűek mindig aktívak
  const adminRes = await pool.query(`
    UPDATE patreon_status
    SET active = true,
        tier = 'Admin',
        last_sync = NOW()
    WHERE user_id IN (
      SELECT id FROM users WHERE role = 'admin'
    )
    RETURNING patreon_user_id
  `);
  
  if (adminRes.rows.length > 0) {
    console.log(`   Admin-ok frissítve: ${adminRes.rows.length}`);
  }
  
  console.log("\n✅ Patreon sync finished");
}

// ── Padli Sync (csak akiknek VAN emailje) ──────────────────────────────────
async function syncPadli() {
  console.log("\n📦 Padli sync started");
  
  try {
    // 1. Prémium státusz frissítése a meglévő aktiválásoknak
    console.log("   Meglévő aktiválások frissítése...");
    const res1 = await fetch('http://127.0.0.1:5001/api/padli/sync-premium', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.PADLI_API_KEY || ''
      }
    });
    
    const data1 = await res1.json();
    
    if (data1.success) {
      console.log(`   ✅ ${data1.message}`);
    } else {
      console.error(`   ❌ Sync failed: ${data1.message}`);
    }
    
    // 2. AUTOMATIKUS IMPORT - Csak akiknek VAN emailje
    console.log("\n   Auto-import (csak email-lel rendelkező patronok)...");
    
    const activePatrons = await pool.query(`
      SELECT patreon_user_id, email, tier
      FROM patreon_status
      WHERE (active = true OR tier = 'Admin') 
        AND email IS NOT NULL
    `);
    
    console.log(`   Talált: ${activePatrons.rows.length} patron email-lel`);
    
    let imported = 0;
    let skipped = 0;
    
    for (const patron of activePatrons.rows) {
      try {
        // Aktiválás létrehozása az API-n keresztül
        const res2 = await fetch('http://127.0.0.1:5001/api/padli/link-patreon', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.PADLI_API_KEY || ''
          },
          body: JSON.stringify({
            email: patron.email,
            patreon_user_id: patron.patreon_user_id
          })
        });
        
        const data2 = await res2.json();
        
        if (data2.success) {
          if (data2.already_exists) {
            skipped++;
          } else {
            imported++;
            console.log(`     ✅ ${patron.email}`);
          }
        } else {
          skipped++;
        }
        
      } catch (err) {
        console.error(`     ❌ Error: ${patron.email} - ${err.message}`);
        skipped++;
      }
    }
    
    console.log(`\n   📊 Import összesítés:`);
    console.log(`      Importálva: ${imported}`);
    console.log(`      Kihagyva/Létező: ${skipped}`);
    
  } catch (err) {
    console.error('   ❌ Padli sync error:', err.message);
  }
  
  console.log("\n✅ Padli sync finished");
}

// ── Futtatás ────────────────────────────────────────────────────────────────
console.log("🚀 Sync process started\n");

syncPatreon()
  .then(() => syncPadli())
  .then(() => {
    console.log("\n🎉 All syncs completed successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 FATAL ERROR:", err);
    process.exit(1);
  });
