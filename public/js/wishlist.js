let isAdmin = false;

/* ================= INIT ================= */
(async function init() {
  const me = await fetch("/api/auth/me");

  if (me.ok) {
    const user = await me.json();
    if (user.role === "admin") {
      isAdmin = true;
    }
  }

  setupForm(); // ✅ FONTOS
  load();
})();

/* ================= FORM (ADD) ================= */
function setupForm() {
  const form = document.getElementById("wishlistForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const input = document.getElementById("url");
    const url = input.value.trim();

    if (!url) return;

    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });

    const data = await res.json();

if (!res.ok) {
  alert(data.error || "Hiba történt");
  return;
}

// 🔥 új logika
if (data.alreadyExists) {
 window.showToast(data.message);
} else {
  window.showToast("Hozzáadva a kívánságlistához!");
}
    input.value = "";
    load();
  });
}

/* ================= LOAD ================= */
async function load() {
  const res = await fetch("/api/wishlist");
  const data = await res.json();

  const list = document.getElementById("wishlistList");
  list.innerHTML = "";

  data.forEach(item => {
    const div = document.createElement("div");
    div.className = "wish";

    div.innerHTML = `
      <img src="${item.cover_url}" onclick="showImage('${item.cover_url}')">

      <div class="wish-info">

        <h3>${item.title}</h3>

        ${item.claimed_by && item.claimed_by.length ? `
          <div class="claimed-badge">
            🔧 Dolgoznak rajta:
            ${item.claimed_by.map(u => u.username).join(", ")}
          </div>
        ` : ""}

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
          <button onclick="claim(${item.id})">Claim</button>
          <button onclick="removeWish(${item.id})">🗑</button>
        ` : ""}
      </div>
    `;

    list.appendChild(div);
  });
}
/* ================= Anilist kereso ================= */
const input = document.getElementById("searchInput");
const resultsBox = document.getElementById("searchResults");

let debounce;

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
  const res = await fetch("/api/wishlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: `https://anilist.co/manga/${id}`
    })
  });

  const data = await res.json();

  // 🔥 EZ HIÁNYZOTT
  if (!res.ok) {
    alert(data.error || "Hiba történt");
    return;
  }

  if (data.alreadyExists) {
    showToast(data.message);
  } else {
    showToast("Hozzáadva!");
  }

  resultsBox.innerHTML = "";
  input.value = "";
  load();
}
/* ================= CLAIM ================= */
async function claim(id) {
  await fetch(`/api/wishlist/${id}/claim`, { method: "POST" });
  load();
}

/* ================= DELETE ================= */
async function removeWish(id) {
  await fetch(`/api/wishlist/${id}`, { method: "DELETE" });
  load();
}

/* ================= LIKE ================= */
async function toggleLike(id) {
  await fetch(`/api/wishlist/${id}/like`, {
    method: "POST"
  });

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
