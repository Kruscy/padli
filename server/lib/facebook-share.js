/* ── Blogposzt megosztása a Facebook-oldalon (2026-11-15) ─────────
   .env: FB_PAGE_ID, FB_PAGE_TOKEN (nem lejáró oldal-kulcs).
   blog_posts.fb_post_id:
     NULL      → még nem ment ki (új poszt)
     'pending' → épp küldjük (párhuzamos hívás ellen)
     'skip'    → a funkció előtti posztok, nem osztjuk meg
     egyéb     → a Facebook-bejegyzés azonosítója
   Hiba esetén visszaáll NULL-ra, és naplózunk — a blog működését nem
   akasztja meg. */
import { pool } from "../db.js";
import { assertSocialEnabled, socialDisabled } from "./social-switch.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const SITE = "https://padlizsanfansub.hu";

export function facebookConfigured() {
  if (socialDisabled()) return false;
  return !!(process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN);
}

function plain(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

export function buildMessage(post) {
  let lead = plain(post.excerpt);
  if (lead.length > 280) lead = lead.slice(0, 280).replace(/\s+\S*$/, "");
  // A kivonat a DB-ben gyakran mondat közepén van levágva: egész mondatig
  // vágjuk vissza, ha marad elég, különben „…” a végére.
  if (lead && !/[.!?…]$/.test(lead)) {
    const end = Math.max(lead.lastIndexOf(". "), lead.lastIndexOf("! "), lead.lastIndexOf("? "));
    lead = end >= 80 ? lead.slice(0, end + 1) : lead.replace(/[\s,;:–-]+$/, "") + "…";
  }
  return `📖 Új bejegyzés a blogunkon: ${post.title}\n\n${lead}\n\n`
    + `#manga #manhwa #manhua #PadlizsanFanSub\n\n👇 A teljes cikk itt olvasható:`;
}

/* Kiküldi, ha még nem ment ki. Visszaad: { id } | { skipped: ok } */
export async function shareBlogPost(slug, { dryRun = false } = {}) {
  if (!facebookConfigured()) return { skipped: "nincs beállítva" };
  const { rows } = await pool.query(
    dryRun
      ? `SELECT slug, title, excerpt FROM blog_posts WHERE slug = $1 AND published = true`
      : `UPDATE blog_posts SET fb_post_id = 'pending'
          WHERE slug = $1 AND published = true AND fb_post_id IS NULL
          RETURNING slug, title, excerpt`, [slug]);
  if (!rows.length) return { skipped: "már megosztva vagy nem közzétett" };
  const post = rows[0];
  const link = `${SITE}/blog/${post.slug}.html`;
  const message = buildMessage(post);
  if (dryRun) return { dryRun: true, message, link };

  try {
    const r = await fetch(`${GRAPH}/${process.env.FB_PAGE_ID}/feed`, {
      method: "POST",
      body: new URLSearchParams({ message, link, access_token: process.env.FB_PAGE_TOKEN }),
      signal: AbortSignal.timeout(30000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.id) throw new Error(d.error?.message || `HTTP ${r.status}`);
    await pool.query("UPDATE blog_posts SET fb_post_id = $1, fb_shared_at = now() WHERE slug = $2", [d.id, slug]);
    console.log(`[Facebook] Blogposzt megosztva: ${slug} → ${d.id}`);
    return { id: d.id };
  } catch (err) {
    await pool.query("UPDATE blog_posts SET fb_post_id = NULL WHERE slug = $1 AND fb_post_id = 'pending'", [slug]).catch(() => {});
    console.error(`[Facebook] Megosztás sikertelen (${slug}): ${err.message}`);
    return { error: err.message };
  }
}
