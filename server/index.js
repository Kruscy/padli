/* ── Szerver indítása ─────────────────────────────────────────
   Az alkalmazás maga: server/app.js. Itt csak a futtatás: HTTP-szerver,
   Discord-bot + chat WebSocket, ütemezett feladatok. */
import app from "./app.js";
import { pool } from "./db.js";
import { runMigrations } from "./lib/migrate.js";
import { announceSetupIfNeeded } from "./routes/setup.js";
import { getSite, loadSiteSettings } from "./lib/site-config.js";
import "./discord-bot.js";
import cron from "node-cron";
import { generateBlogPost } from "./scripts/blog-auto-generator.js";
import { generateSitemap } from "./sitemap-generator.js";

const PORT = process.env.PORT || 3000;

/* ===== ADATBÁZIS-SÉMA ÉS MIGRÁCIÓK ===== */
// Frissítés után a szükséges adatbázis-változások maguktól lefutnak
// (üres adatbázisnál a teljes séma is). Kikapcsolás: AUTO_MIGRATE=false.
if (process.env.AUTO_MIGRATE !== "false") {
  try {
    await runMigrations(pool);
  } catch (err) {
    console.error("❌ Az adatbázis frissítése nem sikerült, a szerver nem indul el:", err.message);
    process.exit(1);
  }
}
await loadSiteSettings();
await announceSetupIfNeeded();

/* ===== BLOG AUTO-GENERÁTOR CRON (H/Sze/P 10:00) ===== */
// Heti 3 poszt: hétfő, szerda, péntek reggel 10-kor
cron.schedule("0 10 * * 1,3,5", async () => {
  if (process.env.BLOG_AUTOGEN === "false") return;
  console.log("[BlogCron] Automatikus blog poszt generálás indítása...");
  try {
    const post = await generateBlogPost();
    if (post) {
      console.log(`[BlogCron] Létrehozva: ${post.slug}`);
      await generateSitemap();
    } else console.log("[BlogCron] Nincs új téma a listában.");
  } catch (err) {
    console.error("[BlogCron] Hiba:", err.message);
  }
}, { timezone: "Europe/Budapest" });

/* ===== START SERVER ===== */
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🍆 ${getSite().name} running on port ${PORT}`);
  try { await generateSitemap(); } catch (e) { console.error("[Sitemap] Indulási hiba:", e.message); }
});
