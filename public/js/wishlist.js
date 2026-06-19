let isAdmin = false;
let anilistToSlug = {};
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
          🔧 Dolgoznak rajta: ${item.claimed_by.map(u => u.username).join(", ")}
        </div>
      `;
    }
    
    if (item.planned_by && item.planned_by.length > 0) {
      badges += `
        <div class="claimed-badge" style="background:#8b5cf6; color:white; margin-top:5px;">
          📅 Tervben van: ${item.planned_by.map(u => u.username).join(", ")}
        </div>
      `;
    }

    div.innerHTML = `
      <img src="${item.cover_url}" onclick="showImage('${item.cover_url}')">

      <div class="wish-info">
        <h3>${item.title}</h3>
        
        ${badges}

        <div class="wish-stats">
          <span class="chapters">${item.episodes || "?"} ch</span>
          🍆 ${Number(item.likes_count) || 0}
        </div>

        <p>${new Date(item.created_at).toLocaleDateString()}</p>
      </div>

      <div class="wish-actions">
        <button onclick="toggleLike(${item.id})"
          class="${item.liked_by_me ? "liked" : ""}">
          🍆
        </button>

        ${isAdmin ? `
          <button 
            onclick="claim(${item.id})"
            class="${item.claimed_by_me ? 'active-claim' : ''}"
            style="background:${item.claimed_by_me ? '#10b981' : '#2f3651'}">
            ${item.claimed_by_me ? '✓ Dolgozom rajta' : '🔧 Claim'}
          </button>
          
          <button 
            onclick="plan(${item.id})"
            class="${item.planned_by_me ? 'active-plan' : ''}"
            style="background:${item.planned_by_me ? '#8b5cf6' : '#2f3651'}">
            ${item.planned_by_me ? '✓ Tervezve' : '📅 Tervben'}
          </button>
          
          <button onclick="removeWish(${item.id})" style="background:#ef4444">
            🗑
          </button>
        ` : ""}
      </div>
    `;

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
  const res = await fetch(`/api/anilist/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();

  resultsBox.innerHTML = "";

  data.forEach(m => {
    const div = document.createElement("div");
    div.className = "search-item";

    div.innerHTML = `
      <img src="${m.coverImage?.medium}">
      <div>
        <div>${m.title.english || m.title.romaji}</div>
        <small>${m.chapters || "?"} fejezet</small>
      </div>
    `;

    div.onclick = () => addFromSearch(m.id);
    resultsBox.appendChild(div);
  });
}

async function addFromSearch(id) {
  if (anilistToSlug[id]) {
    window.location.href = `/chapters.html?slug=${anilistToSlug[id]}`;
    return;
  }
  
  const res = await fetch("/api/wishlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://anilist.co/manga/${id}` })
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
    <img src="${src}" style="max-height:90%; border-radius:12px;">
  `;

  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}
