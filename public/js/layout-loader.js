import { initSearch } from "./search.js";

/* ================= PARTIAL LOADER ================= */

async function loadPartial(id, url) {
  const res = await fetch(url);
  const html = await res.text();
  document.getElementById(id).innerHTML = html;
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
      window.location.href = "/users.html";
    });
  }
}


/* ================= LAYOUT INIT ================= */

async function loadLayout() {
  await loadPartial("header-root", "/partials/header.html");
  await loadPartial("sidebar-root", "/partials/sidebar.html");

  // search CSAK header után
  initSearch();

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
