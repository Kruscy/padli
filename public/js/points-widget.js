// js/points-widget.js - Pontrendszer logika

let pointsData = null;
let myGiftsData = [];

/* ── MODAL MEGNYITÁS ────────────────────────────────────── */
async function openPointsModal() {
  await loadPointsData();
  await loadMyGifts();
  switchPointsTab('balance');
  document.getElementById('pointsModal').style.display = 'flex';
}

function closePointsModal() {
  document.getElementById('pointsModal').style.display = 'none';
}

/* ── TAB VÁLTÁS ─────────────────────────────────────────── */
function switchPointsTab(tab) {
  // Tab gombok
  document.querySelectorAll('.points-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Tab tartalmak
  document.querySelectorAll('.points-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab${capitalize(tab)}`);
  });
}

/* ── PONT EGYENLEG BETÖLTÉSE ────────────────────────────── */
async function loadPointsData() {
  try {
    const res = await fetch('/api/points/balance', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load points');
    pointsData = await res.json();

    // Header badge frissítés
    const badge = document.getElementById('userPointsCount');
    if (badge) badge.textContent = pointsData.available_points;

    // Modal egyenleg
    const balanceEl = document.getElementById('balancePoints');
    const spentEl = document.getElementById('balanceSpent');
    if (balanceEl) balanceEl.textContent = pointsData.available_points;
    if (spentEl) spentEl.textContent = `Elköltve: ${pointsData.spent_points} pont`;

    // Log lista renderelése
    renderPointsLog(pointsData.log || []);

  } catch (err) {
    console.error('Points load error:', err);
    const badge = document.getElementById('userPointsCount');
    if (badge) badge.textContent = '?';
  }
}

/* ── PONT LOG RENDERELÉSE ───────────────────────────────── */
function renderPointsLog(log) {
  const logList = document.getElementById('pointsLogList');
  if (!logList) return;

  logList.innerHTML = '';

  if (!log || log.length === 0) {
    logList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        Még nincs pont történeted.<br>Javíts képeket és gyűjts pontokat!
      </div>
    `;
    return;
  }

  log.forEach(item => {
    const div = document.createElement('div');
    div.className = 'log-item';
    
    const imgName = item.image_file 
      ? decodeURIComponent(item.image_file).replace(/_\d+\.[^.]+$/, '') 
      : 'Ismeretlen kép';
    
    const date = new Date(item.earned_at).toLocaleDateString('hu-HU', {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    div.innerHTML = `
      <div class="log-item-icon">✅</div>
      <div class="log-item-info">
        <div class="log-item-title">${escapeHtml(imgName)}</div>
        <div class="log-item-meta">
          ${escapeHtml(item.manga_slug)} › ${escapeHtml(item.chapter)} › 
          Jóváhagyta: ${escapeHtml(item.approved_by_name || 'Admin')} › ${date}
        </div>
      </div>
      <div class="log-item-points ${item.spent ? 'spent' : ''}">
        ${item.spent ? '-' : '+'}${item.points}
      </div>
    `;

    logList.appendChild(div);
  });
}

/* ── SAJÁT GIFTJEIM BETÖLTÉSE ───────────────────────────── */
async function loadMyGifts() {
  try {
    const res = await fetch('/api/points/my-gifts', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load gifts');
    myGiftsData = await res.json();

    renderMyGifts(myGiftsData || []);

  } catch (err) {
    console.error('My gifts load error:', err);
  }
}

/* ── GIFTJEIM RENDERELÉSE ───────────────────────────────── */
function renderMyGifts(gifts) {
  const list = document.getElementById('myGiftsList');
  if (!list) return;

  list.innerHTML = '';

  if (!gifts || gifts.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎁</div>
        Még nincs megvásárolt előfizetésed.<br>
        Gyűjts 100 pontot és vásárolj egyet!
      </div>
    `;
    return;
  }

  gifts.forEach(gift => {
    const card = document.createElement('div');
    card.className = 'gift-card';

    const date = new Date(gift.purchased_at).toLocaleDateString('hu-HU', {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    card.innerHTML = `
      <div class="gift-card-header">
        <div class="gift-card-title">
          🎁 ${gift.duration_months} hónapos előfizetés
        </div>
        <div class="gift-card-date">${date}</div>
      </div>

      <div class="gift-code-box">
        <span id="giftCode${gift.id}">${escapeHtml(gift.gift_code)}</span>
        <button class="copy-btn" onclick="copyGiftCode(${gift.id}, '${escapeHtml(gift.gift_code)}')">
          📋 Másol
        </button>
      </div>

      <a href="${escapeHtml(gift.patreon_link)}" target="_blank" class="patreon-link-btn">
        🔗 Beváltás Patreonon
      </a>

      <div class="gift-card-footer">
        Költség: ${gift.cost_points} pont
      </div>
    `;

    list.appendChild(card);
  });
}

/* ── GIFT KÓD MÁSOLÁS ───────────────────────────────────── */
function copyGiftCode(giftId, code) {
  navigator.clipboard.writeText(code).then(() => {
    // Vizuális feedback
    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = '✅ Másolva';
    btn.style.background = 'rgba(34,197,94,.3)';
    
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.background = '';
    }, 2000);
  }).catch(err => {
    alert('Másolás sikertelen: ' + err);
  });
}

/* ── GIFT VÁSÁRLÁS ──────────────────────────────────────── */
async function purchaseGift() {
  if (!pointsData) {
    alert('Töltsd be az egyenlegedet először!');
    return;
  }

  if (pointsData.available_points < 100) {
    alert(`Nincs elég pontod! Szükséges: 100, Jelenlegi: ${pointsData.available_points}`);
    return;
  }

  if (!confirm('Biztosan vásárolsz egy 1 hónapos Patreon gift kódot 100 pontért?')) {
    return;
  }

  const btn = document.getElementById('purchaseGiftBtn');
  const feedback = document.getElementById('purchaseFeedback');
  
  btn.disabled = true;
  btn.innerHTML = '⏳ Feldolgozás...';

  try {
    const res = await fetch('/api/points/purchase-gift', {
      method: 'POST',
      credentials: 'include'
    });

    const data = await res.json();

    feedback.style.display = 'block';

    if (res.ok) {
      feedback.className = 'purchase-feedback success';
      feedback.innerHTML = `
        ✅ ${escapeHtml(data.message)}<br><br>
        <strong>Gift kód:</strong> <code style="background:rgba(0,0,0,.3);padding:4px 8px;border-radius:4px">${escapeHtml(data.gift.gift_code)}</code>
        <br><br>
        <a href="${escapeHtml(data.gift.patreon_link)}" target="_blank" class="patreon-link-btn">
          🔗 Beváltás Patreonon
        </a>
      `;

      // Frissítés
      await loadPointsData();
      await loadMyGifts();

      // Váltás a jutalmak tabra
      setTimeout(() => {
        switchPointsTab('mygifts');
      }, 3000);

    } else {
      feedback.className = 'purchase-feedback error';
      feedback.textContent = '❌ ' + (data.error || 'Ismeretlen hiba');
    }

  } catch (err) {
    feedback.style.display = 'block';
    feedback.className = 'purchase-feedback error';
    feedback.textContent = '❌ Szerverrel nem sikerült kapcsolatba lépni';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🛒 Vásárlás';
  }
}

/* ── SEGÉD FÜGGVÉNYEK ───────────────────────────────────── */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ── AUTOMATIKUS BETÖLTÉS OLDAL INDULÁSKOR ─────────────── */
(async () => {
  try {
    await loadPointsData();
  } catch (err) {
    console.warn('Points widget failed to load:', err);
  }
})();

/* ── ESC BILLENTYŰ MODAL BEZÁRÁSRA ──────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('pointsModal');
    if (modal && modal.style.display === 'flex') {
      closePointsModal();
    }
  }
});

/* ── MODAL HÁTTÉR KATTINTÁS ─────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('pointsModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closePointsModal();
      }
    });
  }
});
