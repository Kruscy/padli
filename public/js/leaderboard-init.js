const API = '/api/points';

/* ── LEADERBOARD BETÖLTÉSE ────────────────────────────────── */
async function loadLeaderboard() {
  try {
    const res = await fetch(`${API}/leaderboard`);
    if (!res.ok) throw new Error('Failed to load leaderboard');
    const data = await res.json();

    document.getElementById('loadingState').style.display = 'none';

    if (!data || data.length === 0) {
      document.getElementById('emptyState').style.display = 'block';
      return;
    }

    // TOP 3 - Dobogó
    const top3 = data.slice(0, 3);
    if (top3.length > 0) {
      renderPodium(top3);
    }

    // 4-10 - Lista
    const rest = data.slice(3);
    if (rest.length > 0) {
      renderList(rest, 4); // Kezdő rank: 4
    }

  } catch (err) {
    console.error('Leaderboard load error:', err);
    document.getElementById('loadingState').innerHTML = `
      <div style="color:#ef4444">❌ Hiba történt a rangsor betöltésekor</div>
    `;
  }
}

/* ── DOBOGÓ RENDERELÉSE ────────────────────────────────────── */
function renderPodium(top3) {
  const container = document.getElementById('podiumContainer');
  container.innerHTML = '<div class="podium"></div>';
  const podium = container.querySelector('.podium');

  const places = ['first', 'second', 'third'];
  const medals = ['🥇', '🥈', '🥉'];

  top3.forEach((user, i) => {
    const div = document.createElement('div');
    div.className = `podium-place ${places[i]}`;

    const avatarSrc = user.avatar || '';
    const avatarEl = avatarSrc
      ? `<img class="podium-avatar" src="${esc(avatarSrc)}" alt="${esc(user.username)}">`
      : `<div class="podium-avatar avatar-placeholder">👤</div>`;

    div.innerHTML = `
      <div style="position:relative">
        ${avatarEl}
        <div class="podium-medal">${i + 1}</div>
      </div>
      <div class="podium-name">${esc(user.username)}</div>
      <div class="podium-stats">
        <span class="podium-count">${user.fixes_count}</span> javítás
      </div>
      <div class="podium-base">${medals[i]}</div>
    `;

    podium.appendChild(div);
  });
}

/* ── LISTA RENDERELÉSE (4-10) ──────────────────────────────── */
function renderList(users, startRank) {
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';

  users.forEach((user, i) => {
    const rank = startRank + i;
    const item = document.createElement('div');
    item.className = 'leaderboard-item';

    const avatarSrc = user.avatar || '';
    const avatarEl = avatarSrc
      ? `<img class="leaderboard-avatar" src="${esc(avatarSrc)}" alt="${esc(user.username)}">`
      : `<div class="leaderboard-avatar avatar-placeholder">👤</div>`;

    const lastFixDate = user.last_fix_date
      ? new Date(user.last_fix_date).toLocaleDateString('hu-HU', {
          year: 'numeric', month: 'short', day: 'numeric'
        })
      : '';

    item.innerHTML = `
      <div class="leaderboard-rank">#${rank}</div>
      ${avatarEl}
      <div class="leaderboard-info">
        <div class="leaderboard-name">${esc(user.username)}</div>
        <div class="leaderboard-meta">
          ${user.fixes_count} javítás
          ${user.total_points_earned ? ` · ${user.total_points_earned} pont szerzett` : ''}
          ${lastFixDate ? ` · Utolsó: ${lastFixDate}` : ''}
        </div>
      </div>
      <div class="leaderboard-count">${user.fixes_count}</div>
    `;

    list.appendChild(item);
  });
}

/* ── ESCAPE HTML ───────────────────────────────────────────── */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── INDÍTÁS ────────────────────────────────────────────────
loadLeaderboard();
