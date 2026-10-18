// Séma és migrációk kézi alkalmazása: npm run migrate
// (a szerver induláskor magától is lefuttatja, ha AUTO_MIGRATE nem "false")
import "dotenv/config";
import { pool } from "../db.js";
import { runMigrations } from "../lib/migrate.js";

try {
  const { fresh, applied } = await runMigrations(pool);
  console.log(`✅ Kész${fresh ? " (új adatbázis)" : ""} — alkalmazott migrációk: ${applied.length}`);
} catch (err) {
  console.error("❌ Migrációs hiba:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
