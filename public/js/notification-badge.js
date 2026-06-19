(function () {
  let notificationsOpen = false;

  const TYPE_CONFIG = {
    bug_comment:  { icon: "💬" },
    bug_closed:   { icon: "🔒" },
    patreon_gift: { icon: "🎁" },
    patreon_won:  { icon: "🏆" },
    default:      { icon: "🔔" },
  };

  async function loadUnreadCount() {
    try {
      const res = await fetch("/api/bug-reports/notifications/unread-count");
      if (!res.ok) return;
      const data = await res.json();
      const badge = document.getElementById("notificationCount");
      if (!badge) return;
      if (data.count > 0) {
        badge.textContent = data.count > 99 ? "99+" : data.count;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    } catch {}
  }

  async function loadNotifications() {
    const list = document.getElementById("notificationList");
    if (!list) return;
    list.innerHTML = '<div class="notification-loading">Betöltés...</div>';
    try {
      const res = await fetch("/api/bug-reports/notifications");
      if (!res.ok) { list.innerHTML = '<div class="notification-empty">Hiba történt</div>'; return; }
      const notifications = await res.json();
      if (!notifications.length) { list.innerHTML = '<div class="notification-empty">Nincs értesítés 🎉</div>'; return; }
      list.innerHTML = "";
      notifications.forEach(notif => {
        const icon = (TYPE_CONFIG[notif.type] || TYPE_CONFIG.default).icon;
        const item = document.createElement("div");
        item.className = "notification-item" + (notif.is_read ? "" : " unread");
        item.dataset.id = notif.id;
        item.dataset.link = notif.link || "";
        item.dataset.type = notif.type || "";

        const main = document.createElement("div");
        main.className = "notification-item-main";

        if (!notif.is_read) {
          const dot = document.createElement("div");
          dot.className = "notification-dot";
          main.appendChild(dot);
        }

        const iconEl = document.createElement("span");
        iconEl.className = "notification-type-icon";
        iconEl.textContent = icon;
        main.appendChild(iconEl);

        const content = document.createElement("div");
        content.className = "notification-content";
        const msg = document.createElement("div");
        msg.className = "notification-message";
        msg.textContent = notif.message;
        const time = document.createElement("div");
        time.className = "notification-time";
        time.textContent = formatTimeAgo(notif.created_at);
        content.appendChild(msg);
        content.appendChild(time);
        main.appendChild(content);

        main.addEventListener("click", () =>
          handleNotificationClick(notif.id, notif.link || "", notif.type || "")
        );

        const delBtn = document.createElement("button");
        delBtn.className = "notification-delete-btn";
        delBtn.title = "Törlés";
        delBtn.textContent = "✕";
        delBtn.addEventListener("click", (e) => deleteNotification(e, notif.id));

        item.appendChild(main);
        item.appendChild(delBtn);
        list.appendChild(item);
      });
    } catch { list.innerHTML = '<div class="notification-empty">Hiba történt</div>'; }
  }

  function isSafeInternalLink(link) {
    if (!link) return false;
    // Csak saját originen belüli relatív URL engedélyezett
    try {
      const url = new URL(link, window.location.origin);
      return url.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  window.handleNotificationClick = async function (id, link, type) {
    try {
      await fetch("/api/bug-reports/notifications/" + id + "/mark-read", { method: "POST" });
      await loadUnreadCount();
      const dropdown = document.getElementById("notificationDropdown");
      if (dropdown) dropdown.classList.add("hidden");
      notificationsOpen = false;
      if (!link) return;

      // Patreon gift/nyeremeny: uj tabban nyitjuk — ezek ismert külső URL-ek
      if (type === "patreon_gift" || type === "patreon_won") {
        const url = new URL(link, window.location.origin);
        window.open(url.href, "_blank", "noopener,noreferrer");
        return;
      }

      // Minden más csak saját originen belülre navigálhat
      if (!isSafeInternalLink(link)) return;

      // Bug értesítések: bug-reports.html?id=X
      if (window.location.pathname === "/bug-reports.html") {
        const bugId = new URLSearchParams((link.split("?")[1] || "")).get("id");
        if (bugId && window.openBugReportById) {
          window.openBugReportById(parseInt(bugId));
        }
      } else {
        window.location.href = link;
      }
    } catch {}
  };

  window.deleteNotification = async function (e, id) {
    e.stopPropagation();
    try {
      await fetch("/api/bug-reports/notifications/" + id, { method: "DELETE" });
      const item = document.querySelector('.notification-item[data-id="' + id + '"]');
      if (item) {
        item.style.transition = "opacity .2s, transform .2s";
        item.style.opacity = "0";
        item.style.transform = "translateX(20px)";
        setTimeout(() => item.remove(), 200);
      }
      await loadUnreadCount();
      const list = document.getElementById("notificationList");
      if (list && !list.querySelector(".notification-item")) {
        list.innerHTML = '<div class="notification-empty">Nincs értesítés 🎉</div>';
      }
    } catch {}
  };

  function initDeleteAllButton() {
    const btn = document.getElementById("deleteAllNotifBtn");
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await fetch("/api/bug-reports/notifications", { method: "DELETE" });
        await loadUnreadCount();
        const list = document.getElementById("notificationList");
        if (list) list.innerHTML = '<div class="notification-empty">Nincs értesítés 🎉</div>';
      } catch {}
    });
  }

  function initMarkAllReadButton() {
    const btn = document.getElementById("markAllReadBtn");
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await fetch("/api/bug-reports/notifications/mark-all-read", { method: "POST" });
        await loadUnreadCount();
        await loadNotifications();
      } catch {}
    });
  }

  function initNotificationToggle() {
    const badge = document.getElementById("notificationBadge");
    const dropdown = document.getElementById("notificationDropdown");
    if (!badge || !dropdown) return;
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      notificationsOpen = !notificationsOpen;
      if (notificationsOpen) {
        dropdown.classList.remove("hidden");
        loadNotifications();
        const sm = document.getElementById("settingsMenu");
        if (sm) sm.classList.add("hidden");
      } else {
        dropdown.classList.add("hidden");
      }
    });
  }

  function initClickOutside() {
    document.addEventListener("click", (e) => {
      const badge = document.getElementById("notificationBadge");
      const dropdown = document.getElementById("notificationDropdown");
      if (!badge || !dropdown) return;
      if (notificationsOpen && !badge.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add("hidden");
        notificationsOpen = false;
      }
    });
  }

  function escHtml(text) {
    if (!text) return "";
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
  }

  function formatTimeAgo(date) {
    const diff = Math.floor((Date.now() - new Date(date)) / 1000);
    if (diff < 60) return "Most";
    if (diff < 3600) return Math.floor(diff / 60) + " perce";
    if (diff < 86400) return Math.floor(diff / 3600) + " órája";
    if (diff < 604800) return Math.floor(diff / 86400) + " napja";
    return new Date(date).toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
  }

  async function initEmailVerifyBanner() {
    const skip = ["/login.html", "/register.html", "/verify-email.html"];
    if (skip.some(p => location.pathname === p)) return;
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const me = await res.json();
      if (me.email_verified !== false) return;
      if (sessionStorage.getItem("evbDismissed")) return;
      if (document.getElementById("emailVerifyBanner")) return;

      const banner = document.createElement("div");
      banner.id = "emailVerifyBanner";
      banner.innerHTML = `
        <span>✉️ <strong>Az email címed nincs megerősítve.</strong> Ellenőrizd a postaládád, vagy kérj új linket.</span>
        <span style="display:flex;gap:8px;align-items:center;flex-shrink:0">
          <button id="evbResendBtn" style="background:#7c3aed;color:#fff;border:none;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:0.83rem;white-space:nowrap">📨 Új link</button>
          <a href="/settings.html" style="color:#c4b5fd;font-size:0.83rem;text-decoration:underline;white-space:nowrap">Email módosítása</a>
          <button id="evbCloseBtn" style="background:none;border:none;color:#888;cursor:pointer;font-size:1.1rem;line-height:1;padding:2px 6px">✕</button>
        </span>`;
      Object.assign(banner.style, {
        position: "fixed", top: "0", left: "0", right: "0", zIndex: "9999",
        background: "#1e1230", borderBottom: "1px solid #7c3aed",
        color: "#e0e0e0", padding: "9px 16px", fontSize: "0.87rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "12px", flexWrap: "wrap",
      });
      document.body.prepend(banner);
      document.body.style.paddingTop = "44px";

      document.getElementById("evbCloseBtn").addEventListener("click", () => {
        banner.remove();
        document.body.style.paddingTop = "";
        sessionStorage.setItem("evbDismissed", "1");
      });

      document.getElementById("evbResendBtn").addEventListener("click", async () => {
        const btn = document.getElementById("evbResendBtn");
        btn.disabled = true; btn.textContent = "Küldés...";
        try {
          await fetch("/api/auth/resend-verification", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: me.email }),
          });
          btn.textContent = "✅ Elküldve!";
        } catch { btn.textContent = "❌ Hiba"; btn.disabled = false; }
      });
    } catch {}
  }

  function init() {
    setTimeout(() => {
      initNotificationToggle();
      initMarkAllReadButton();
      initDeleteAllButton();
      initClickOutside();
      loadUnreadCount();
      setInterval(loadUnreadCount, 30000);
      initEmailVerifyBanner();
    }, 100);
  }

  // Ha dinamikusan töltődik be (DOMContentLoaded már lefutott), azonnal inicializál
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
