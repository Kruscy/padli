/* blog-post.js – Egyedi bejegyzés oldal */

const params   = new URLSearchParams(location.search);
const slug     = params.get("slug");

const loadingEl  = document.getElementById("postLoading");
const articleEl  = document.getElementById("postArticle");
const relatedEl  = document.getElementById("relatedSection");
const relatedGrid = document.getElementById("relatedGrid");

const CAT_LABELS = { ajanlo:"Ajánló", hir:"Hírek", forditas:"Fordítás", kozosseg:"Közösség" };

(async function init() {
  if (!slug) { show404(); return; }

  try {
    const res = await fetch(`/api/blog/${encodeURIComponent(slug)}`);
    if (!res.ok) { show404(); return; }
    const post = await res.json();

    renderPost(post);
    loadRelated(post);
  } catch {
    show404();
  }

  loadingEl.classList.add("hidden");
})();

/* ── RENDER ──────────────────────────────────────────────── */

function renderPost(post) {
  const catLabel = CAT_LABELS[post.category] || post.category || "";
  const dateStr  = formatDate(post.created_at);
  const pageUrl  = `https://padlizsanfansub.hu/blog-post.html?slug=${encodeURIComponent(post.slug)}`;
  const desc     = post.excerpt || stripHtml(post.content || "").slice(0, 160);

  // Meta tagek
  document.getElementById("pageTitle").textContent  = `${post.title} – PadlizsanFanSub Blog`;
  document.getElementById("metaDesc").content        = desc;
  document.getElementById("canonicalLink").href      = pageUrl;
  document.getElementById("ogTitle").content         = post.title;
  document.getElementById("ogDesc").content          = desc;
  document.getElementById("ogUrl").content           = pageUrl;
  document.getElementById("twTitle").content         = post.title;
  document.getElementById("twDesc").content          = desc;
  if (post.cover_url) {
    document.getElementById("ogImage").content = post.cover_url;
    document.getElementById("twImage").content = post.cover_url;
  }

  // Strukturált adat (Article schema)
  const schema = {
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
      "url": "https://padlizsanfansub.hu",
      "logo": { "@type": "ImageObject", "url": "https://padlizsanfansub.hu/assets/favico.png" }
    },
    "inLanguage": "hu",
    "mainEntityOfPage": { "@type": "WebPage", "@id": pageUrl }
  };
  if (post.cover_url) schema.image = post.cover_url;

  const schemaScript = document.createElement("script");
  schemaScript.type = "application/ld+json";
  schemaScript.textContent = JSON.stringify(schema);
  document.head.appendChild(schemaScript);

  // Tartalom
  document.getElementById("postBreadcrumb").textContent  = post.title;
  document.getElementById("postCategory").textContent    = catLabel;
  document.getElementById("postDate").textContent        = dateStr;
  document.getElementById("postAuthor").textContent      = post.author ? "✍️ " + post.author : "";
  document.getElementById("postTitle").textContent       = post.title;
  document.getElementById("postLead").textContent        = post.excerpt || "";

  if (post.cover_url) {
    const wrap = document.getElementById("postCoverWrap");
    const img  = document.getElementById("postCover");
    img.src = post.cover_url;
    img.alt = post.title;
    wrap.classList.remove("hidden");
  }

  // Tartalom – HTML vagy plain text
  const contentEl = document.getElementById("postContent");
  contentEl.innerHTML = post.content || "";

  // Tagek
  const tagsEl = document.getElementById("postTags");
  if (post.tags && post.tags.length) {
    tagsEl.innerHTML = post.tags.map(t => `<span class="post-tag">${esc(t)}</span>`).join("");
  }

  // Megosztás
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`;
  const xUrl  = `https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(post.title)}`;
  document.getElementById("shareFb").href = fbUrl;
  document.getElementById("shareX").href  = xUrl;
  document.getElementById("shareCopy").addEventListener("click", () => {
    navigator.clipboard.writeText(pageUrl).then(() => {
      const btn = document.getElementById("shareCopy");
      btn.textContent = "✓ Másolva!";
      setTimeout(() => { btn.textContent = "Link másolása"; }, 2000);
    });
  });

  articleEl.classList.remove("hidden");
}

/* ── KAPCSOLÓDÓ ──────────────────────────────────────────── */

async function loadRelated(post) {
  try {
    const res = await fetch(`/api/blog?category=${post.category}&limit=3`);
    if (!res.ok) return;
    const posts = (await res.json()).filter(p => p.slug !== post.slug).slice(0, 3);
    if (!posts.length) return;

    posts.forEach(p => {
      const catLabel = CAT_LABELS[p.category] || p.category || "";
      const a = document.createElement("a");
      a.className = "blog-card";
      a.href = `/blog-post.html?slug=${encodeURIComponent(p.slug)}`;
      const excerpt = stripHtml(p.content || "").slice(0, 120);
      a.innerHTML = `
        ${p.cover_url
          ? `<img src="${p.cover_url}" alt="${esc(p.title)}" class="blog-card-thumb" loading="lazy">`
          : `<div class="blog-card-thumb-placeholder">📝</div>`}
        <div class="blog-card-body">
          <span class="post-category">${esc(catLabel)}</span>
          <h3>${esc(p.title)}</h3>
          <p class="blog-card-excerpt">${esc(p.excerpt || excerpt)}</p>
          <div class="blog-card-meta"><span>${formatDate(p.created_at)}</span></div>
        </div>
      `;
      relatedGrid.appendChild(a);
    });

    relatedEl.classList.remove("hidden");
  } catch {}
}

/* ── 404 ─────────────────────────────────────────────────── */

function show404() {
  loadingEl.classList.add("hidden");
  document.getElementById("postTitle") && (document.getElementById("postTitle").textContent = "Bejegyzés nem található");
  articleEl.innerHTML = `
    <div style="text-align:center;padding:80px 20px;color:#6b6b80">
      <div style="font-size:64px;margin-bottom:16px">📭</div>
      <h1 style="color:#f0f0fa;font-family:'Lora',serif">Bejegyzés nem található</h1>
      <p>Ez a bejegyzés nem létezik vagy törölték.</p>
      <a href="/blog.html" style="color:#7c5cff;text-decoration:underline">← Vissza a blogra</a>
    </div>
  `;
  articleEl.classList.remove("hidden");
}

/* ── SEGÉD ────────────────────────────────────────────────── */

function esc(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("hu-HU", { year:"numeric", month:"long", day:"numeric" });
  } catch { return iso; }
}

/* ── NAV: bejelentkezés gomb vagy felhasználó név ────────── */
(async function initNav() {
  const navRight = document.getElementById("blogNavRight");
  if (!navRight) return;

  const homeBtn = document.createElement("a");
  homeBtn.href = "/";
  homeBtn.className = "nav-home-btn";
  homeBtn.textContent = "Főoldal";
  navRight.appendChild(homeBtn);

  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const user = await res.json();
      const nameSpan = document.createElement("span");
      nameSpan.className = "nav-user-name";
      nameSpan.textContent = "👤 " + user.username;
      navRight.insertBefore(nameSpan, homeBtn);
    } else {
      throw new Error("not logged in");
    }
  } catch {
    const loginBtn = document.createElement("a");
    loginBtn.href = "/login.html";
    loginBtn.className = "nav-login-btn";
    loginBtn.textContent = "Bejelentkezés";
    navRight.insertBefore(loginBtn, homeBtn);
  }
})();
