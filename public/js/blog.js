/* blog.js – Blog lista oldal */

const featuredEl  = document.getElementById("featuredPost");
const gridEl      = document.getElementById("blogGrid");
const loadingEl   = document.getElementById("blogLoading");
const emptyEl     = document.getElementById("blogEmpty");
const filtersEl   = document.getElementById("blogFilters");

const CAT_LABELS = {
  ajanlo:   "Ajánló",
  hir:      "Hírek",
  forditas: "Fordítás",
  kozosseg: "Közösség",
};

const CAT_ICONS = {
  ajanlo:   "📚",
  hir:      "📰",
  forditas: "✍️",
  kozosseg: "💬",
};

let allPosts = [];
let activeCategory = "";

/* ── INIT ────────────────────────────────────────────────── */

(async function init() {
  try {
    const res = await fetch("/api/blog");
    allPosts = res.ok ? await res.json() : [];
  } catch {
    allPosts = [];
  }

  loadingEl.classList.add("hidden");
  renderPosts(allPosts);
})();

/* ── SZŰRŐK ──────────────────────────────────────────────── */

filtersEl.addEventListener("click", e => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  filtersEl.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  activeCategory = btn.dataset.cat;
  const filtered = activeCategory
    ? allPosts.filter(p => p.category === activeCategory)
    : allPosts;
  renderPosts(filtered);
});

/* ── RENDER ──────────────────────────────────────────────── */

function renderPosts(posts) {
  featuredEl.innerHTML = "";
  gridEl.innerHTML = "";
  emptyEl.classList.add("hidden");

  if (!posts.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  // Első bejegyzés = kiemelt
  renderFeatured(posts[0]);

  // Többi = grid
  posts.slice(1).forEach(p => {
    gridEl.appendChild(makeCard(p));
  });
}

function renderFeatured(post) {
  const catLabel = CAT_LABELS[post.category] || post.category || "";
  const catIcon  = CAT_ICONS[post.category]  || "📝";
  const dateStr  = formatDate(post.created_at);
  const excerpt  = stripHtml(post.content || "").slice(0, 220);

  const a = document.createElement("a");
  a.className = "blog-featured-card";
  a.href = `/blog-post.html?slug=${encodeURIComponent(post.slug)}`;
  a.innerHTML = `
    ${post.cover_url
      ? `<img src="${post.cover_url}" alt="${esc(post.title)}" class="blog-featured-img">`
      : `<div class="blog-featured-img-placeholder">${catIcon}</div>`
    }
    <div class="blog-featured-body">
      <span class="post-category">${esc(catLabel)}</span>
      <h2>${esc(post.title)}</h2>
      <p class="post-lead">${esc(post.excerpt || excerpt)}</p>
      <div class="blog-featured-meta">
        <span>${dateStr}</span>
        ${post.author ? `<span>✍️ ${esc(post.author)}</span>` : ""}
      </div>
      <span class="read-more-link">Elolvasom →</span>
    </div>
  `;
  featuredEl.appendChild(a);
}

function makeCard(post) {
  const catLabel = CAT_LABELS[post.category] || post.category || "";
  const catIcon  = CAT_ICONS[post.category]  || "📝";
  const dateStr  = formatDate(post.created_at);
  const excerpt  = stripHtml(post.content || "").slice(0, 160);

  const a = document.createElement("a");
  a.className = "blog-card";
  a.href = `/blog-post.html?slug=${encodeURIComponent(post.slug)}`;
  a.innerHTML = `
    ${post.cover_url
      ? `<img src="${post.cover_url}" alt="${esc(post.title)}" class="blog-card-thumb" loading="lazy">`
      : `<div class="blog-card-thumb-placeholder">${catIcon}</div>`
    }
    <div class="blog-card-body">
      <span class="post-category">${esc(catLabel)}</span>
      <h3>${esc(post.title)}</h3>
      <p class="blog-card-excerpt">${esc(post.excerpt || excerpt)}</p>
      <div class="blog-card-meta">
        <span>${dateStr}</span>
        ${post.author ? `<span>✍️ ${esc(post.author)}</span>` : ""}
      </div>
    </div>
  `;
  return a;
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

  // Mindig látható: főoldal link
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
