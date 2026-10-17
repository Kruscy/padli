let isAdmin = false;

// A címek, borítók és felhasználónevek külső API-ból / felhasználótól
// jönnek → HTML-be csak escape-elve kerülhetnek
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let anilistToSlug = {};
let malToSlug = {};
let mangadexToSlug = {};
let allWishlistData = [];

/* ================= INIT ================= */
(async function init() {
  const me = await fetch("/api/auth/me");

  if (me.ok) {
    const user = await me.json();
    if (user.role === "admin") {
      isAdmin = true;
    }
  }

  try {
    const mlRes = await fetch("/api/manga-list");
    const mlData = await mlRes.json();
    Object.entries(mlData).forEach(([slug, data]) => {
      if (data.anilist_id) anilistToSlug[data.anilist_id] = slug;
      if (data.mal_id) malToSlug[data.mal_id] = slug;
      if (data.mangadex_id) mangadexToSlug[data.mangadex_id] = slug;
    });
  } catch {}

  setupTabs();
  load();
})();

/* ================= FÜLEK KEZELÉS ================= */
function setupTabs() {
  const buttons = document.querySelectorAll('.tab-button');
  
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // Összes inaktív
      buttons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Aktív beállítása
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

/* ================= LOAD ================= */
async function load() {
  const res = await fetch("/api/wishlist");
  const data = await res.json();
  
  allWishlistData = data;
  
  // Szűrés
  const all = data.filter(item => 
    !item.claimed_by || item.claimed_by.length === 0
  );
  
  const claimed = data.filter(item => 
    item.claimed_by && item.claimed_by.length > 0
  );
  
  const planned = data.filter(item => 
    item.planned_by && item.planned_by.length > 0
  );
  
  // Renderelés
  renderWishlist(all, 'wishlistAll');
  renderWishlist(claimed, 'wishlistClaimed');
  renderWishlist(planned, 'wishlistPlanned');
}

/* ================= RENDER ================= */
function renderWishlist(items, containerId) {
  const list = document.getElementById(containerId);
  list.innerHTML = "";
  
  if (items.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#6b7280; padding:40px;">Nincs megjeleníthető elem</p>';
    return;
  }
  
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "wish";

    // Státusz badge-ek
    let badges = '';
    
    if (item.claimed_by && item.claimed_by.length > 0) {
      badges += `
        <div class="claimed-badge" style="background:#10b981; color:white;">
          🔧 Dolgoznak rajta: ${esc(item.claimed_by.map(u => u.username).join(", "))}
        </div>
      `;
    }
    
    if (item.planned_by && item.planned_by.length > 0) {
      badges += `
        <div class="claimed-badge" style="background:#8b5cf6; color:white; margin-top:5px;">
          📅 Tervben van: ${esc(item.planned_by.map(u => u.username).join(", "))}
        </div>
      `;
    }

    div.innerHTML = `
      <img src="${esc(item.cover_url)}" data-action="image">

      <div class="wish-info">
        <h3>${esc(item.title)}</h3>
        
        ${badges}

        <div class="wish-stats">
          <span class="chapters">${esc(item.episodes || "?")} ch</span>
          🍆 ${Number(item.likes_count) || 0}
        </div>

        <p>${new Date(item.created_at).toLocaleDateString()}</p>
      </div>

      <div class="wish-actions">
        <button data-action="toggleLike"
          class="${item.liked_by_me ? "liked" : ""}">
          🍆
        </button>

        ${isAdmin ? `
          <button 
            data-action="claim"
            class="${item.claimed_by_me ? 'active-claim' : ''}"
            style="background:${item.claimed_by_me ? '#10b981' : '#2f3651'}">
            ${item.claimed_by_me ? '✓ Dolgozom rajta' : '🔧 Claim'}
          </button>
          
          <button 
            data-action="plan"
            class="${item.planned_by_me ? 'active-plan' : ''}"
            style="background:${item.planned_by_me ? '#8b5cf6' : '#2f3651'}">
            ${item.planned_by_me ? '✓ Tervezve' : '📅 Tervben'}
          </button>
          
          <button data-action="removeWish" style="background:#ef4444">
            🗑
          </button>
        ` : ""}
      </div>
    `;

    // Inline onclick helyett eseményfigyelők (CSP: script-src-attr)
    const actions = { toggleLike, claim, plan, removeWish };
    div.querySelectorAll("[data-action]").forEach(el => {
      const act = el.dataset.action;
      el.addEventListener("click", () => act === "image" ? showImage(item.cover_url) : actions[act](item.id));
    });

    list.appendChild(div);
  });
}

/* ================= ANILIST KERESŐ ================= */
const input = document.getElementById("wishlistSearchInput");
const resultsBox = document.getElementById("wishlistSearchResults");
let debounce;

document.addEventListener("click", (e) => {
  if (!e.target.closest(".wishlist-search-wrapper")) {
    resultsBox.innerHTML = "";
  }
});

input.addEventListener("input", () => {
  clearTimeout(debounce);
  const q = input.value.trim();

  if (q.length < 2) {
    resultsBox.innerHTML = "";
    return;
  }

  debounce = setTimeout(() => search(q), 300);
});

async function search(q) {
  // Kívánságlista-specifikus végpont: ha az AniList hibázik/rate-limitel,
  // szerver oldalon Jikan (MAL) fallback-kel ad találatokat.
  const res = await fetch(`/api/anilist/search-wishlist?q=${encodeURIComponent(q)}`);
  const data = await res.json();

  resultsBox.innerHTML = "";

  if (data.unavailable) {
    resultsBox.innerHTML = `
      <div style="padding:14px; color:#9ca3af; text-align:center; font-size:14px;">
        ⚠️ A keresés jelenleg nem elérhető (AniList/MAL/MangaDex kiesés) — próbáld később
      </div>
    `;
    return;
  }

  const SOURCE_BADGE = { jikan: "MAL", mangadex: "MangaDex" };

  (data.results || []).forEach(m => {
    const div = document.createElement("div");
    div.className = "search-item";

    const badge = SOURCE_BADGE[m.source];

    div.innerHTML = `
      <img src="${esc(m.coverImage?.medium)}">
      <div>
        <div>${esc(m.title.english || m.title.romaji)}${badge ? ` <small style="opacity:.6">(${badge})</small>` : ''}</div>
        <small>${esc(m.chapters || "?")} fejezet</small>
      </div>
    `;

    div.onclick = () => addFromSearch(m.id, m.source);
    resultsBox.appendChild(div);
  });
}

const SLUG_MAP_BY_SOURCE = { anilist: () => anilistToSlug, jikan: () => malToSlug, mangadex: () => mangadexToSlug };

async function addFromSearch(id, source) {
  const slugMap = (SLUG_MAP_BY_SOURCE[source] || SLUG_MAP_BY_SOURCE.anilist)();
  if (slugMap[id]) {
    window.location.href = `/chapters.html?slug=${slugMap[id]}`;
    return;
  }

  const res = await fetch("/api/wishlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, id })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || "Hiba történt");
    return;
  }

  if (data.alreadyExists) {
    window.showToast(data.message);
  } else {
    window.showToast("Hozzáadva!");
  }

  resultsBox.innerHTML = "";
  input.value = "";
  load();
}

/* ================= CLAIM (Dolgozik rajta) ================= */
async function claim(id) {
  await fetch(`/api/wishlist/${id}/claim`, { method: "POST" });
  window.showToast("Claim státusz frissítve!");
  load();
}

/* ================= PLAN (Tervben van) ================= */
async function plan(id) {
  await fetch(`/api/wishlist/${id}/plan`, { method: "POST" });
  window.showToast("Tervben státusz frissítve!");
  load();
}

/* ================= DELETE ================= */
async function removeWish(id) {
  if (!confirm("Biztosan törölni szeretnéd?")) return;
  
  await fetch(`/api/wishlist/${id}`, { method: "DELETE" });
  window.showToast("Törölve!");
  load();
}

/* ================= LIKE ================= */
async function toggleLike(id) {
  await fetch(`/api/wishlist/${id}/like`, { method: "POST" });
  load();
}

/* ================= IMAGE MODAL ================= */
function showImage(src) {
  const overlay = document.createElement("div");

  overlay.style = `
    position:fixed;
    top:0;
    left:0;
    width:100%;
    height:100%;
    background:rgba(0,0,0,0.85);
    display:flex;
    justify-content:center;
    align-items:center;
    z-index:999;
    cursor:pointer;
  `;

  overlay.innerHTML = `
    <img src="${esc(src)}" style="max-height:90%; border-radius:12px;">
  `;

  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}
