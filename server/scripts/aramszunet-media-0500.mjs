// EGYSZERI: áramszünet (2026-11-18 8:00) miatt a szerdai médiás posztok hajnali 5-kor mennek ki
// (a szerver 7:00-kor leáll, a 10:00-s cronok nem futnának). A szerver futó Discord-botjával nem ütközik:
// az ig-snippet-preview.js-t (ami importkor bejelentkezteti a botot) NEM importálja, a Discord-üzenet REST-en megy.
//   node server/scripts/aramszunet-media-0500.mjs [--check]
import "dotenv/config";
import fs from "fs";
import { pool } from "../db.js";
import { postTikTokCarousel, publerConfigured, toTikTokCaption } from "../lib/publer.js";

const CHECK = process.argv.includes("--check");
const channel = process.env.DISCORD_POSTER_CHANNEL_ID || process.env.DISCORD_SECURITY_CHANNEL_ID;
async function discord(content) {
  if (CHECK || !channel || !process.env.DISCORD_BOT_TOKEN) return;
  await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: "POST", headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch(() => {});
}

// 1) TikTok lapozós részlet (a publishSnippet TikTok-ága; szerdán nincs Instagram)
async function tiktok() {
  if (!publerConfigured()) return console.log("TikTok: Publer nincs beállítva");
  const recent = await pool.query("SELECT 1 FROM ig_snippets WHERE status = 'posted' AND created_at > now() - interval '12 hours' LIMIT 1");
  if (recent.rows.length) return console.log("TikTok: 12 órán belül már ment ki, kihagyva");
  const { rows } = await pool.query(
    `SELECT s.*, m.slug, m.title FROM ig_snippets s JOIN manga m ON m.id = s.manga_id
      WHERE s.status IN ('pending','approved','skipped') AND s.created_at > now() - interval '2 days'
      ORDER BY s.id DESC LIMIT 1`);
  const row = rows[0];
  if (!row) return console.log("TikTok: nincs előkészített részlet");
  if (row.status === "skipped") return console.log("TikTok: a #media-ban kihagyásra jelölve");
  if (!row.tiktok_paths?.length || !row.tiktok_paths.every(f => fs.existsSync(f))) return console.log("TikTok: hiányoznak a képek", row.id);
  console.log(`TikTok: #${row.id} ${row.slug} (${row.status}), ${row.tiktok_paths.length} kép`);
  if (CHECK) return;
  try {
    const tt = await postTikTokCarousel(row.tiktok_paths.map(f => fs.readFileSync(f)), toTikTokCaption(row.caption), { prefix: `snippet-${row.id}-${row.slug}`, title: row.title || row.slug });
    const postId = tt.result?.payload?.[0]?.post?.id || tt.jobId;
    await pool.query("UPDATE ig_snippets SET tiktok_post_id = $1, status = 'posted' WHERE id = $2", [postId, row.id]);
    await discord(`🎵 TikTok lapozós részlet kiment (áramszünet miatt hajnalban): **${row.slug}**`);
    console.log("TikTok kiment:", postId);
  } catch (e) {
    await pool.query("UPDATE ig_snippets SET tiktok_error = $1 WHERE id = $2", [e.message.slice(0, 500), row.id]).catch(() => {});
    await discord(`⚠️ TikTok lapozós részlet NEM ment ki (**${row.slug}**): ${e.message.slice(0, 300)}`);
    console.error("TikTok hiba:", e.message);
  }
}

// 2) Szerdai blogposzt (+ Facebook-megosztás a generátoron belül) és sitemap
async function blog() {
  const { generateBlogPost } = await import("./blog-auto-generator.js");
  const { generateSitemap } = await import("../sitemap-generator.js");
  if (CHECK) return console.log("Blog: modulok rendben (ellenőrzés, nincs generálás)");
  try {
    const post = await generateBlogPost();
    if (post) { console.log("Blog létrehozva:", post.slug); await generateSitemap(); await discord(`📝 Szerdai blogposzt kiment (áramszünet miatt hajnalban): https://padlizsanfansub.hu/blog/${post.slug}`); }
    else console.log("Blog: nincs új téma");
  } catch (e) {
    console.error("Blog hiba:", e.message);
    await discord(`⚠️ A szerdai blogposzt NEM készült el: ${e.message.slice(0, 300)}`);
  }
}

console.log("== " + new Date().toISOString() + (CHECK ? " (ellenőrzés)" : ""));
await tiktok();
await blog();
await pool.end().catch(() => {});
process.exit(0);
