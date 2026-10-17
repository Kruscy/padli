/* ── Szerver indítása ─────────────────────────────────────────
   Az alkalmazás maga: server/app.js. Itt csak a futtatás: HTTP-szerver,
   Discord-bot + chat WebSocket, ütemezett feladatok. */
import app from "./app.js";
import "./discord-bot.js";
import cron from "node-cron";
import { generateBlogPost } from "./scripts/blog-auto-generator.js";
import { generateSitemap } from "./sitemap-generator.js";

const PORT = process.env.PORT || 3000;

/* ===== BLOG AUTO-GENERÁTOR CRON (H/Sze/P 10:00) ===== */
// Heti 3 poszt: hétfő, szerda, péntek reggel 10-kor
cron.schedule("0 10 * * 1,3,5", async () => {
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
  console.log(`🍆 PadlizsanFanSub running on port ${PORT}`);
  try { await generateSitemap(); } catch (e) { console.error("[Sitemap] Indulási hiba:", e.message); }
});
