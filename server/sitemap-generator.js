import pool from "./db.js";
import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../public");

const SITE_URL = (process.env.SITE_URL || "https://padlizsanfansub.hu").replace(/\/$/, "");

const STATIC_PAGES = [
  { url: "/",            priority: "1.0", changefreq: "daily"  },
  { url: "/blog/",       priority: "0.9", changefreq: "daily"  },
  { url: "/login.html",  priority: "0.6", changefreq: "monthly" },
  { url: "/register.html", priority: "0.6", changefreq: "monthly" },
  { url: "/leaderboard.html", priority: "0.5", changefreq: "weekly" },
  { url: "/polls.html",  priority: "0.5", changefreq: "weekly" },
  { url: "/partners.html", priority: "0.4", changefreq: "monthly" },
  { url: "/impressum.html", priority: "0.3", changefreq: "yearly" },
  { url: "/privacy.html",   priority: "0.3", changefreq: "yearly" },
  { url: "/aszf.html",      priority: "0.3", changefreq: "yearly" },
];

function toW3CDate(d) {
  return new Date(d).toISOString().split("T")[0];
}

export async function generateSitemap() {
  const { rows } = await pool.query(
    `SELECT slug, created_at, updated_at FROM blog_posts WHERE published = true ORDER BY created_at DESC`
  );

  const today = toW3CDate(new Date());

  const staticEntries = STATIC_PAGES.map(p => `
  <url>
    <loc>${SITE_URL}${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("");

  const blogEntries = rows.map(p => `
  <url>
    <loc>${SITE_URL}/blog/${p.slug}.html</loc>
    <lastmod>${toW3CDate(p.updated_at || p.created_at)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${blogEntries}
</urlset>`;

  await writeFile(path.join(PUBLIC_DIR, "sitemap.xml"), xml, "utf8");
  console.log(`[Sitemap] Frissítve: ${rows.length} blog poszt + ${STATIC_PAGES.length} statikus oldal`);
  return rows.length;
}
