/* ═══════════════════════════════════════════════════════════
   NOTIFICATION BADGE - JavaScript
   Add hozzá a header.js végéhez vagy töltsd be külön fájlként!
   ═══════════════════════════════════════════════════════════ */

(function() {
  let notificationsOpen = false;

  /* ────────────────────────────────────────────────────────
     OLVASATLAN SZÁMÁNAK LEKÉRÉSE
     ──────────────────────────────────────────────────────── */
  async function loadUnreadCount() {
    try {
      const res = await fetch('/api/bug-reports/notifications/unread-count');
      if (!res.ok) return;
      
      const data = await res.json();
      const badge = document.getElementById('notificationCount');
      
      if (!badge) return;
      
      if (data.count > 0) {
        badge.textContent = data.count > 99 ? '99+' : data.count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (err) {
      console.error('Load unread count error:', err);
    }
  }

  /* ────────────────────────────────────────────────────────
     ÉRTESÍTÉSEK LISTÁJÁNAK BETÖLTÉSE
     ──────────────────────────────────────────────────────── */
  async function loadNotifications() {
    const list = document.getElementById('notificationList');
    if (!list) return;
    
    list.innerHTML = '<div class="notification-loading">Betöltés...</div>';
    
    try {
      const res = await fetch('/api/bug-reports/notifications');
      if (!res.ok) {
        list.innerHTML = '<div class="notification-empty">Hiba történt</div>';
        return;
      }
      
      const notifications = await res.json();
      
      if (notifications.length === 0) {
        list.innerHTML = '<div class="notification-empty">Nincs értesítés</div>';
        return;
      }
      
      list.innerHTML = notifications.map(notif => `
        <div class="notification-item ${notif.is_read ? '' : 'unread'}" 
             data-id="${notif.id}"
             onclick="handleNotificationClick(${notif.id}, '${escapeHtml(notif.link || '')}')">
          ${!notif.is_read ? '<div class="notification-dot"></div>' : ''}
          <div class="notification-content">
            <div class="notification-message">
              ${escapeHtml(notif.message)}
            </div>
            <div class="notification-time">
              ${formatTimeAgo(notif.created_at)}
            </div>
          </div>
        </div>
      `).join('');
      
    } catch (err) {
      console.error('Load notifications error:', err);
      list.innerHTML = '<div class="notification-empty">Hiba történt</div>';
    }
  }

  /* ────────────────────────────────────────────────────────
     ÉRTESÍTÉSRE KATTINTÁS
     ──────────────────────────────────────────────────────── */
  window.handleNotificationClick = async function(id, link) {
    try {
      // Olvasottnak jelölés
      await fetch(`/api/bug-reports/notifications/${id}/mark-read`, {
        method: 'POST'
      });
      
      // Frissítés
      await loadUnreadCount();
      
      // Bezárás és link megnyitása
      const dropdown = document.getElementById('notificationDropdown');
      if (dropdown) dropdown.classList.add('hidden');
      notificationsOpen = false;
      
      if (link) {
        window.location.href = link;
      } else {
        // Ha nincs link, csak frissítjük a listát
        await loadNotifications();
      }
      
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  /* ────────────────────────────────────────────────────────
     MIND OLVASVA GOMB
     ──────────────────────────────────────────────────────── */
  function initMarkAllReadButton() {
    const btn = document.getElementById('markAllReadBtn');
    if (!btn) return;
    
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      
      try {
        await fetch('/api/bug-reports/notifications/mark-all-read', {
          method: 'POST'
        });
        
        await loadUnreadCount();
        await loadNotifications();
        
      } catch (err) {
        console.error('Mark all read error:', err);
      }
    });
  }

  /* ────────────────────────────────────────────────────────
     TOGGLE DROPDOWN
     ──────────────────────────────────────────────────────── */
  function initNotificationToggle() {
    const badge = document.getElementById('notificationBadge');
    const dropdown = document.getElementById('notificationDropdown');
    
    if (!badge || !dropdown) return;
    
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      
      notificationsOpen = !notificationsOpen;
      
      if (notificationsOpen) {
        dropdown.classList.remove('hidden');
        loadNotifications();
        
        // Bezárjuk a settings menu-t ha nyitva van
        const settingsMenu = document.getElementById('settingsMenu');
        if (settingsMenu) settingsMenu.classList.add('hidden');
      } else {
        dropdown.classList.add('hidden');
      }
    });
  }

  /* ────────────────────────────────────────────────────────
     KÍVÜLRE KATTINTÁS BEZÁRJA
     ──────────────────────────────────────────────────────── */
  function initClickOutside() {
    document.addEventListener('click', (e) => {
      const badge = document.getElementById('notificationBadge');
      const dropdown = document.getElementById('notificationDropdown');
      
      if (!badge || !dropdown) return;
      
      if (notificationsOpen && 
          !badge.contains(e.target) && 
          !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
        notificationsOpen = false;
      }
    });
  }

  /* ────────────────────────────────────────────────────────
     HELPER FUNKCIÓK
     ──────────────────────────────────────────────────────── */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatTimeAgo(date) {
    const now = new Date();
    const then = new Date(date);
    const diff = Math.floor((now - then) / 1000);
    
    if (diff < 60) return 'Most';
    if (diff < 3600) return `${Math.floor(diff / 60)} perce`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} órája`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} napja`;
    
    return then.toLocaleDateString('hu-HU', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /* ────────────────────────────────────────────────────────
     INITIALIZATION
     ──────────────────────────────────────────────────────── */
  window.addEventListener('DOMContentLoaded', () => {
    // Várakozás header betöltésére
    setTimeout(() => {
      initNotificationToggle();
      initMarkAllReadButton();
      initClickOutside();
      loadUnreadCount();
      
      // Auto-refresh 30 másodpercenként
      setInterval(loadUnreadCount, 30000);
    }, 100);
  });

})();
