import { initSearch } from "./search.js";

/* ================= PARTIAL LOADER ================= */

async function loadPartial(id, url) {
  const res = await fetch(url);
  const html = await res.text();
  document.getElementById(id).innerHTML = html;
}

/* ================= SEARCH TOGGLE ================= */
function initSearchToggle() {
  const wrapper = document.getElementById("searchWrapper");
  const toggleBtn = document.getElementById("searchToggleBtn");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  if (!wrapper || !toggleBtn || !input) return;

  let justOpened = false;

  const topbar = document.querySelector(".topbar");

  function openSearch() {
    justOpened = true;
    wrapper.classList.add("open");
    topbar?.classList.add("search-open");
    setTimeout(() => input.focus(), 50);
    setTimeout(() => { justOpened = false; }, 300);
  }

  function closeSearch() {
    if (!input.value.trim()) {
      wrapper.classList.remove("open");
      topbar?.classList.remove("search-open");
    }
    if (results) results.classList.add("hidden");
  }

  toggleBtn.addEventListener("click", openSearch);
  toggleBtn.addEventListener("touchstart", (e) => { e.preventDefault(); openSearch(); });

  document.addEventListener("click", (e) => {
    if (justOpened) return;
    if (!wrapper.contains(e.target) && !(results && results.contains(e.target))) {
      closeSearch();
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      wrapper.classList.remove("open");
      topbar?.classList.remove("search-open");
      if (results) results.classList.add("hidden");
    }
  });
}

/* ================= SETTINGS MENU ================= */
function initSettingsMenu() {
  const btn = document.getElementById("settingsBtn");
  const menu = document.getElementById("settingsMenu");

  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });

  document.addEventListener("click", () => {
    menu.classList.add("hidden");
  });

  menu.addEventListener("click", (e) => e.stopPropagation());
}
/* ===== ADMIN CONTROLS ===== */
async function initAdminControls() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return;

  const user = await res.json();

  // Feltöltő gomb: Admin vagy Uploader tiernek
  const uploaderBtn = document.getElementById("uploaderBtn");
  if (uploaderBtn && (user.tier === "Admin" || user.tier === "Uploader")) {
    uploaderBtn.classList.remove("hidden");
    uploaderBtn.addEventListener("click", () => { window.location.href = "/uploader.html"; });
  }

  if (user.role !== "admin") return;

  /* ===== SCAN GOMB ===== */
  const scanBtn = document.getElementById("scanBtn");
  if (scanBtn) {
    scanBtn.classList.remove("hidden");

    scanBtn.addEventListener("click", async () => {
      if (!confirm("Biztos elindítod a scan-t?")) return;

      scanBtn.disabled = true;
      scanBtn.textContent = "⏳ Scanning...";

      const r = await fetch("/api/admin/scan", {
        method: "POST"
      });

      scanBtn.textContent = r.ok
        ? "✅ Scan started"
        : "❌ Scan failed";

      setTimeout(() => {
        scanBtn.textContent = "🔄 Scan library";
        scanBtn.disabled = false;
      }, 3000);
    });
  }

  /* ===== USERS GOMB ===== */
  const usersBtn = document.getElementById("usersBtn");
  if (usersBtn) {
    usersBtn.classList.remove("hidden");
usersBtn.addEventListener("click", () => {
    window.location.href = "/admin.html";
    });
  }
}


/* ================= LAYOUT INIT ================= */

async function loadLayout() {
  await loadPartial("header-root", "/partials/header.html");
  await loadPartial("sidebar-root", "/partials/sidebar.html");

  // search CSAK header után
  initSearch();
  initSearchToggle();

  // settings menu CSAK header után
  initSettingsMenu();

  // admin gombok
  initAdminControls();

  // logout
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  // sidebar
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const toggle = document.getElementById("menuToggle");

  toggle?.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("show");
  });

  overlay?.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  });
 // szuletesnap
const birthJS = document.createElement("script");
birthJS.src = "/js/birth-date.js";
document.body.appendChild(birthJS);
  // Chat widget betöltése
  const chatCSS = document.createElement("link");
  chatCSS.rel = "stylesheet";
  chatCSS.href = "/css/chat.css";
  document.head.appendChild(chatCSS);

if (!document.getElementById("chatWidget")) {
  const chatJS = document.createElement("script");
  chatJS.src = "/js/chat.js";
  chatJS.onload = () => {
  if (typeof initChat === "function") initChat();
  };
  document.body.appendChild(chatJS);
}

  // Notification badge betöltése
  if (!document.querySelector('link[href="/css/notification-badge.css"]')) {
    const notifCSS = document.createElement("link");
    notifCSS.rel = "stylesheet";
    notifCSS.href = "/css/notification-badge.css";
    document.head.appendChild(notifCSS);
  }

  if (!document.getElementById("notificationBadgeScript")) {
    const notifJS = document.createElement("script");
    notifJS.id = "notificationBadgeScript";
    notifJS.src = "/js/notification-badge.js";
    document.body.appendChild(notifJS);
  }
}

async function loadOnlineCount() {
  try {
    const res = await fetch("/api/online-count");
    if (!res.ok) return;

    const data = await res.json();
    const el = document.getElementById("onlineCount");
    if (el) {
      el.textContent = data.online;
    }
  } catch (err) {
    console.error("Online count error", err);
  }
}
// első betöltés
loadOnlineCount();

// 30mp-enként frissít
setInterval(loadOnlineCount, 30000);

document.dispatchEvent(new Event("layoutLoaded"));
document.addEventListener("DOMContentLoaded", loadLayout);
