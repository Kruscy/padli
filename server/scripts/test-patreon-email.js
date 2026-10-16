import dotenv from 'dotenv';
dotenv.config({ path: '/opt/padli/.env' });
import fetch from 'node-fetch';

async function testPatreonEmail() {
  console.log("🔍 Patreon Email API Teszt\n");
  
  // Csak az első oldalt kérdezzük le
  const url = `https://www.patreon.com/api/oauth2/v2/campaigns/${process.env.PATREON_CAMPAIGN_ID}/members?include=currently_entitled_tiers,user&fields[member]=patron_status&fields[user]=email&page[count]=5`;
  
  console.log("URL:", url);
  console.log("\nFetching...\n");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.PATREON_ACCESS_TOKEN}`
    }
  });

  const data = await res.json();
  
  console.log("=".repeat(70));
  console.log("RAW API VÁLASZ:");
  console.log("=".repeat(70));
  console.log(JSON.stringify(data, null, 2));
  console.log("=".repeat(70));
  
  // Elemzés
  console.log("\n📊 ELEMZÉS:\n");
  
  if (!data.data) {
    console.log("❌ Nincs 'data' a válaszban!");
    return;
  }
  
  console.log(`✓ Members count: ${data.data.length}`);
  
  if (data.included) {
    console.log(`✓ Included count: ${data.included.length}`);
    
    // Keressük a 'user' típusú elemeket
    const users = data.included.filter(item => item.type === 'user');
    console.log(`✓ User objects: ${users.length}`);
    
    console.log("\n📧 EMAIL ADATOK:\n");
    
    users.forEach((user, i) => {
      const email = user.attributes?.email;
      console.log(`  User ${i + 1} (ID: ${user.id}):`);
      console.log(`    Email: ${email || '[NINCS EMAIL]'}`);
      console.log(`    Attributes keys: ${Object.keys(user.attributes || {}).join(', ')}`);
      console.log();
    });
    
    if (users.length > 0 && !users[0].attributes?.email) {
      console.log("⚠️  A 'user' objektumokban NINCS email mező!");
      console.log("\n💡 LEHETSÉGES OKOK:");
      console.log("   1. A Patreon OAuth scope nem tartalmazza az 'identity[email]' jogosultságot");
      console.log("   2. Az access token régi, újra kell generálni");
      console.log("   3. A Patreon API policy változott");
      console.log("\n🔧 MEGOLDÁS:");
      console.log("   1. Menj a Patreon Developers oldalra");
      console.log("   2. Clients -> Edit Client");
      console.log("   3. OAuth scopes: Add 'identity[email]'");
      console.log("   4. Generálj új Access Token-t");
    }
    
  } else {
    console.log("❌ Nincs 'included' a válaszban!");
  }
}

testPatreonEmail()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("HIBA:", err);
    process.exit(1);
  });
