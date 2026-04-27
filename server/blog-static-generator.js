// server/blog-static-generator.js
// Meghívódik amikor blogpost közzé lesz téve vagy frissítve
// Generál egy statikus HTML fájlt a /public/blog/ mappába

import fs from "fs";
import path from "path";
import { pool } from "./db.js";

const PUBLIC_DIR  = path.join(process.cwd(), "public");
const BLOG_DIR    = path.join(PUBLIC_DIR, "blog");
const SITE_URL    = "https://padlizsanfansub.hu";

const CAT_LABELS = {
  hir:      "Hírek",
  ajanlo:   "Ajánló",
  forditas: "Fordítás",
  kozosseg: "Közösség",
};

/* ── BIZTOSÍTJUK HOGY A MAPPA LÉTEZIK ──────────────────── */
function ensureBlogDir() {
  if (!fs.existsSync(BLOG_DIR)) fs.mkdirSync(BLOG_DIR, { recursive: true });
}

/* ── DÁTUM FORMÁZÁS ─────────────────────────────────────── */
function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("hu-HU", {
      year: "numeric", month: "long", day: "numeric"
    });
  } catch { return iso; }
}

/* ── HTML ESCAPE ────────────────────────────────────────── */
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── EGYEDI BEJEGYZÉS HTML GENERÁLÁS ────────────────────── */
export function generatePostHtml(post) {
  const catLabel  = CAT_LABELS[post.category] || post.category || "";
  const dateStr   = formatDate(post.created_at);
  const pageUrl   = `${SITE_URL}/blog/${post.slug}.html`;
  const desc      = post.excerpt || (post.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  const coverUrl  = post.cover_url ? (post.cover_url.startsWith("http") ? post.cover_url : SITE_URL + post.cover_url) : SITE_URL + "/assets/favico.png";
  const tags      = Array.isArray(post.tags) ? post.tags : [];
  const tagsHtml  = tags.length ? tags.map(t => `<span class="post-tag">${esc(t)}</span>`).join("") : "";
  const coverHtml = post.cover_url ? `<div class="post-cover-wrap"><img src="${esc(post.cover_url)}" alt="${esc(post.title)}" class="post-cover"></div>` : "";
  const leadHtml  = post.excerpt ? `<p class="post-lead">${esc(post.excerpt)}</p>` : "";

  const schemaJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "description": desc,
    "url": pageUrl,
    "datePublished": post.created_at,
    "dateModified": post.updated_at || post.created_at,
    "author": { "@type": "Person", "name": post.author || "PadlizsanFanSub" },
    "publisher": {
      "@type": "Organization",
      "name": "PadlizsanFanSub",
      "url": SITE_URL,
      "logo": { "@type": "ImageObject", "url": SITE_URL + "/assets/favico.png" }
    },
    "image": coverUrl,
    "inLanguage": "hu",
    "mainEntityOfPage": { "@type": "WebPage", "@id": pageUrl },
    ...(tags.length ? { "keywords": tags.join(", ") } : {})
  });

  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(post.title)} – PadlizsanFanSub Blog</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${pageUrl}">

  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(post.title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${esc(coverUrl)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:locale" content="hu_HU">
  <meta property="og:site_name" content="PadlizsanFanSub">
  <meta property="article:published_time" content="${post.created_at}">
  <meta property="article:modified_time" content="${post.updated_at || post.created_at}">
  ${tags.map(t => `<meta property="article:tag" content="${esc(t)}">`).join("\n  ")}

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(post.title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(coverUrl)}">

  <script type="application/ld+json">${schemaJson}</script>

  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favico.png">
  <link rel="stylesheet" href="/css/footer.css">
  <link rel="stylesheet" href="/css/blog.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>

<nav class="blog-nav">
  <a href="/" class="blog-nav-logo">🍆 PadlizsanFanSub</a>
  <div class="blog-nav-right" id="blogNavRight"></div>
</nav>

<main class="blog-main">
  <div class="blog-container post-container">

    <article class="blog-post" itemscope itemtype="https://schema.org/BlogPosting">
      <meta itemprop="datePublished" content="${post.created_at}">
      <meta itemprop="dateModified" content="${post.updated_at || post.created_at}">

      <nav class="post-breadcrumb" aria-label="breadcrumb">
        <a href="/">Főoldal</a>
        <span>›</span>
        <a href="/blog/">Blog</a>
        <span>›</span>
        <span>${esc(post.title)}</span>
      </nav>

      <header class="post-header">
        <div class="post-meta-top">
          <span class="post-category">${esc(catLabel)}</span>
          <time class="post-date" datetime="${post.created_at}" itemprop="datePublished">${dateStr}</time>
          ${post.author ? `<span class="post-author" itemprop="author">✍️ ${esc(post.author)}</span>` : ""}
        </div>
        <h1 itemprop="headline">${esc(post.title)}</h1>
        ${leadHtml}
      </header>

      ${coverHtml}

      <div class="post-content" itemprop="articleBody">
        ${post.content || ""}
      </div>

      <footer class="post-footer">
        ${tagsHtml ? `<div class="post-tags">${tagsHtml}</div>` : ""}
        <div class="post-share">
          <span>Megosztás:</span>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener" class="share-btn share-fb">Facebook</a>
          <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener" class="share-btn share-x">X / Twitter</a>
        </div>
      </footer>

      <a href="/blog/" class="back-to-blog">← Vissza a blogra</a>
    </article>

  </div>
</main>

<div id="footer"></div>
<script src="/js/footer.js"></script>
<script>
// Nav bejelentkezés gomb
(async function() {
  const nav = document.getElementById("blogNavRight");
  const home = Object.assign(document.createElement("a"), { href: "/", className: "nav-home-btn", textContent: "Főoldal" });
  nav.appendChild(home);
  try {
    const r = await fetch("/api/auth/me");
    if (r.ok) {
      const u = await r.json();
      const s = Object.assign(document.createElement("span"), { className: "nav-user-name", textContent: "👤 " + u.username });
      nav.insertBefore(s, home);
    } else throw 0;
  } catch {
    const btn = Object.assign(document.createElement("a"), { href: "/login.html", className: "nav-login-btn", textContent: "Bejelentkezés" });
    nav.insertBefore(btn, home);
  }
})();
</script>

</body>
</html>`;
}

/* ── BLOG INDEX HTML GENERÁLÁS ──────────────────────────── */
export function generateIndexHtml(posts) {
  const postsSchema = posts.slice(0, 10).map(p => ({
    "@type": "BlogPosting",
    "headline": p.title,
    "url": `${SITE_URL}/blog/${p.slug}.html`,
    "datePublished": p.created_at,
    "description": p.excerpt || "",
    "author": { "@type": "Person", "name": p.author || "PadlizsanFanSub" }
  }));

  const schemaJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "PadlizsanFanSub Blog",
    "description": "Magyar manga fordítások, ajánlók és hírek",
    "url": `${SITE_URL}/blog/`,
    "publisher": {
      "@type": "Organization",
      "name": "PadlizsanFanSub",
      "url": SITE_URL
    },
    "inLanguage": "hu",
    "blogPost": postsSchema
  });

  const featured = posts[0];
  const rest     = posts.slice(1);

  const featuredHtml = featured ? `
    <a href="/blog/${esc(featured.slug)}.html" class="blog-featured-card">
      ${featured.cover_url
        ? `<img src="${esc(featured.cover_url)}" alt="${esc(featured.title)}" class="blog-featured-img">`
        : `<div class="blog-featured-img-placeholder">📝</div>`}
      <div class="blog-featured-body">
        <span class="post-category">${esc(CAT_LABELS[featured.category] || featured.category || "")}</span>
        <h2>${esc(featured.title)}</h2>
        <p class="post-lead">${esc(featured.excerpt || "")}</p>
        <div class="blog-featured-meta">
          <time datetime="${featured.created_at}">${formatDate(featured.created_at)}</time>
          ${featured.author ? `<span>✍️ ${esc(featured.author)}</span>` : ""}
        </div>
        <span class="read-more-link">Elolvasom →</span>
      </div>
    </a>` : "";

  const cardsHtml = rest.map(p => `
    <a href="/blog/${esc(p.slug)}.html" class="blog-card">
      ${p.cover_url
        ? `<img src="${esc(p.cover_url)}" alt="${esc(p.title)}" class="blog-card-thumb" loading="lazy">`
        : `<div class="blog-card-thumb-placeholder">${CAT_LABELS[p.category] ? "📝" : "📝"}</div>`}
      <div class="blog-card-body">
        <span class="post-category">${esc(CAT_LABELS[p.category] || p.category || "")}</span>
        <h3>${esc(p.title)}</h3>
        <p class="blog-card-excerpt">${esc(p.excerpt || "")}</p>
        <div class="blog-card-meta">
          <time datetime="${p.created_at}">${formatDate(p.created_at)}</time>
          ${p.author ? `<span>✍️ ${esc(p.author)}</span>` : ""}
        </div>
      </div>
    </a>`).join("\n");

  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog – PadlizsanFanSub | Magyar manga fordítások, hírek, ajánlók</title>
  <meta name="description" content="A PadlizsanFanSub blogja – manga ajánlók, fordítói hírek, új fejezetek, és minden ami a magyar manga közösséget érdekli.">
  <meta name="keywords" content="manga blog magyarul, manga ajánló, manga hírek, magyar manga fordítás, padlizsanfansub blog">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SITE_URL}/blog/">

  <meta property="og:type" content="website">
  <meta property="og:title" content="Blog – PadlizsanFanSub">
  <meta property="og:description" content="Manga ajánlók, fordítói hírek és közösségi tartalmak magyarul.">
  <meta property="og:url" content="${SITE_URL}/blog/">
  <meta property="og:image" content="${SITE_URL}/assets/favico.png">
  <meta property="og:locale" content="hu_HU">
  <meta property="og:site_name" content="PadlizsanFanSub">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Blog – PadlizsanFanSub">
  <meta name="twitter:description" content="Manga ajánlók, fordítói hírek és közösségi tartalmak magyarul.">

  <script type="application/ld+json">${schemaJson}</script>

  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favico.png">
  <link rel="stylesheet" href="/css/footer.css">
  <link rel="stylesheet" href="/css/blog.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>

<nav class="blog-nav">
  <a href="/" class="blog-nav-logo">🍆 PadlizsanFanSub</a>
  <div class="blog-nav-right" id="blogNavRight"></div>
</nav>

<main class="blog-main">
  <div class="blog-hero">
    <div class="blog-hero-inner">
      <span class="blog-eyebrow">📝 PadlizsanFanSub</span>
      <h1>Blog</h1>
      <p>Manga ajánlók, fordítói hírek és közösségi tartalmak – mindent megtalálsz itt magyarul.</p>
    </div>
  </div>

  <div class="blog-container">
    <div class="blog-featured">${featuredHtml}</div>
    <div class="blog-grid">${cardsHtml}</div>
  </div>
</main>

<div id="footer"></div>
<script src="/js/footer.js"></script>
<script>
(async function() {
  const nav = document.getElementById("blogNavRight");
  const home = Object.assign(document.createElement("a"), { href: "/", className: "nav-home-btn", textContent: "Főoldal" });
  nav.appendChild(home);
  try {
    const r = await fetch("/api/auth/me");
    if (r.ok) {
      const u = await r.json();
      const s = Object.assign(document.createElement("span"), { className: "nav-user-name", textContent: "👤 " + u.username });
      nav.insertBefore(s, home);
    } else throw 0;
  } catch {
    const btn = Object.assign(document.createElement("a"), { href: "/login.html", className: "nav-login-btn", textContent: "Bejelentkezés" });
    nav.insertBefore(btn, home);
  }
})();
</script>

</body>
</html>`;
}

/* ── EGYEDI POST STATIKUS FÁJL ÍRÁSA ────────────────────── */
export async function generateStaticPost(slug) {
  try {
    ensureBlogDir();
    const { rows } = await pool.query(
      "SELECT * FROM blog_posts WHERE slug = $1 AND published = true",
      [slug]
    );
    if (!rows.length) {
      // Ha törölték vagy visszavonták – statikus fájlt is töröljük
      const filePath = path.join(BLOG_DIR, slug + ".html");
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      console.log("[BLOG-GEN] Torolve: " + slug);
      await regenerateIndex();
      return;
    }
    const post = rows[0];
    const html = generatePostHtml(post);
    const filePath = path.join(BLOG_DIR, slug + ".html");
    fs.writeFileSync(filePath, html, "utf8");
    console.log("[BLOG-GEN] Generalva: " + filePath);
    await regenerateIndex();
  } catch (err) {
    console.error("[BLOG-GEN] Hiba: " + err.message);
  }
}

/* ── INDEX OLDAL ÚJRAGENERÁLÁS ──────────────────────────── */
export async function regenerateIndex() {
  try {
    ensureBlogDir();
    const { rows } = await pool.query(
      "SELECT id, slug, title, excerpt, cover_url, category, tags, author, created_at, updated_at " +
      "FROM blog_posts WHERE published = true ORDER BY created_at DESC LIMIT 50"
    );
    const html = generateIndexHtml(rows);
    const filePath = path.join(BLOG_DIR, "index.html");
    fs.writeFileSync(filePath, html, "utf8");
    console.log("[BLOG-GEN] Index generalva: " + rows.length + " poszt");
  } catch (err) {
    console.error("[BLOG-GEN] Index hiba: " + err.message);
  }
}

/* ── ÖSSZES MEGLÉVŐ POST ÚJRAGENERÁLÁSA ─────────────────── */
export async function regenerateAllPosts() {
  try {
    ensureBlogDir();
    const { rows } = await pool.query(
      "SELECT * FROM blog_posts WHERE published = true ORDER BY created_at DESC"
    );
    for (const post of rows) {
      const html = generatePostHtml(post);
      const filePath = path.join(BLOG_DIR, post.slug + ".html");
      fs.writeFileSync(filePath, html, "utf8");
    }
    await regenerateIndex();
    console.log("[BLOG-GEN] Osszes regeneralva: " + rows.length + " poszt");
    return rows.length;
  } catch (err) {
    console.error("[BLOG-GEN] Osszes hiba: " + err.message);
    return 0;
  }
}
