/* ═══════════════════════════════════════════════════════════
   BUG-REPORTS.JS - JAVÍTOTT LOGIKA
   1. Javított = fix_id van, de még nyitott
   2. Leírás = első komment
   ═══════════════════════════════════════════════════════════ */

let allBugReports = [];
let currentUser = null;
let activeTab = 'open'; // open, fixed, closed
let expandedManga = {};
let expandedReports = {};

/* ──────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────── */
(async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      currentUser = await res.json();
    }
  } catch (err) {
    console.error('Auth check error:', err);
  }

  // Fül gombok
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderBugReports();
    });
  });

  await loadBugReports();
})();

/* ──────────────────────────────────────────────────────────
   BUG REPORTS BETÖLTÉSE
   ────────────────────────────────────────────────────────── */
async function loadBugReports() {
  try {
    const res = await fetch('/api/bug-reports');
    allBugReports = await res.json();
    
    updateBadges();
    renderBugReports();
    
  } catch (err) {
    console.error('Load bug reports error:', err);
  }
}

/* ──────────────────────────────────────────────────────────
   BADGE SZÁMOK FRISSÍTÉSE (ÚJ LOGIKA)
   ────────────────────────────────────────────────────────── */
function updateBadges() {
  // JAVÍTANI VALÓ: Nyitott, nincs javítás
  const open = allBugReports.filter(r => !r.is_closed && !r.fix_id).length;
  
  // JAVÍTOTT: Nyitott, van javítás (még nem lett lezárva!)
  const fixed = allBugReports.filter(r => !r.is_closed && r.fix_id).length;
  
  // LEZÁRT: Mindegy mi az oka, lezárva van
  const closed = allBugReports.filter(r => r.is_closed).length;
  
  const openBadge = document.getElementById('badge-open');
  const fixedBadge = document.getElementById('badge-fixed');
  const closedBadge = document.getElementById('badge-closed');
  
  if (openBadge) openBadge.textContent = open;
  if (fixedBadge) fixedBadge.textContent = fixed;
  if (closedBadge) closedBadge.textContent = closed;
}

/* ──────────────────────────────────────────────────────────
   SZŰRÉS AKTÍV FÜL SZERINT (ÚJ LOGIKA)
   ────────────────────────────────────────────────────────── */
function filterByTab(reports) {
  if (activeTab === 'open') {
    // Javítani való: nyitott, nincs javítás
    return reports.filter(r => !r.is_closed && !r.fix_id);
  } else if (activeTab === 'fixed') {
    // Javított: nyitott, VAN javítás (ellenőrzésre vár!)
    return reports.filter(r => !r.is_closed && r.fix_id);
  } else if (activeTab === 'closed') {
    // Lezárt: mindegy mi, lezárva van
    return reports.filter(r => r.is_closed);
  }
  return reports;
}

/* ──────────────────────────────────────────────────────────
   CSOPORTOSÍTÁS MANGA → CHAPTER SZERINT
   ────────────────────────────────────────────────────────── */
function groupReports(reports) {
  const grouped = {};
  
  reports.forEach(report => {
    const manga = report.manga_slug;
    const chapter = report.chapter;
    
    if (!grouped[manga]) {
      grouped[manga] = {
        title: report.manga_title || manga,
        translator: report.translator,
        chapters: {}
      };
    }
    
    if (!grouped[manga].chapters[chapter]) {
      grouped[manga].chapters[chapter] = [];
    }
    
    grouped[manga].chapters[chapter].push(report);
  });
  
  return grouped;
}

/* ──────────────────────────────────────────────────────────
   BUG REPORTS RENDERELÉSE
   ────────────────────────────────────────────────────────── */
function renderBugReports() {
  const container = document.getElementById('bugReportsContainer');
  
  const filtered = filterByTab(allBugReports);
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📭</div>
        <p>Nincs hibajegy ebben a kategóriában</p>
      </div>
    `;
    return;
  }
  
  const grouped = groupReports(filtered);
  
  let html = '';
  
  Object.entries(grouped).forEach(([slug, data]) => {
    html += renderMangaGroup(slug, data);
  });
  
  container.innerHTML = html;
}

/* ──────────────────────────────────────────────────────────
   MANGA CSOPORT RENDERELÉSE
   ────────────────────────────────────────────────────────── */
function renderMangaGroup(slug, data) {
  const isExpanded = expandedManga[slug];
  const title = data.title;
  const translator = data.translator || '';
  
  const chapterCount = Object.keys(data.chapters).length;
  const imageCount = Object.values(data.chapters).flat().length;
  
  return `
    <div class="report-group">
      <div class="group-header" onclick="toggleManga('${slug}')">
        <div class="group-title">
          <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
          <span class="manga-title">${escapeHtml(title)}</span>
          ${translator ? `<span class="translator-badge">👤 ${escapeHtml(translator)}</span>` : ''}
        </div>
        <div class="group-meta">
          <span>${chapterCount} chapter • ${imageCount} kép</span>
        </div>
      </div>
      
      ${isExpanded ? renderChapters(slug, data.chapters) : ''}
    </div>
  `;
}

/* ──────────────────────────────────────────────────────────
   CHAPTER-EK RENDERELÉSE
   ────────────────────────────────────────────────────────── */
function renderChapters(slug, chapters) {
  let html = '<div class="chapters-container">';
  
  Object.entries(chapters)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([chapter, reports]) => {
      html += `
        <div class="chapter-block">
          <div class="chapter-title">${chapter} (${reports.length} kép)</div>
          ${reports.map(report => renderImageReport(report)).join('')}
        </div>
      `;
    });
  
  html += '</div>';
  return html;
}

/* ──────────────────────────────────────────────────────────
   KÉP REPORT RENDERELÉSE
   ────────────────────────────────────────────────────────── */
function renderImageReport(report) {
  const isAdmin = currentUser?.role === 'admin';
  const isExpanded = expandedReports[report.id];
  
  let statusBadge = '';
  if (!report.is_closed) {
    if (report.fix_id) {
      statusBadge = `<span class="status fixed">✅ Javítva</span>`;
    } else {
      statusBadge = `<span class="status open">⚠️ Nyitott</span>`;
    }
  } else {
    if (report.closed_without_fix) {
      statusBadge = `<span class="status closed">❌ Elutasítva</span>`;
    } else {
      statusBadge = `<span class="status closed-fixed">🔒 Lezárva (javítva)</span>`;
    }
  }
  
  const commentCount = report.comment_count || 0;
  
  return `
    <div class="report-card ${isExpanded ? 'expanded' : ''}">
      <div class="report-header" onclick="toggleReport(${report.id})">
        <div class="report-info">
          <span class="image-num">Kép #${report.image_index}</span>
          ${statusBadge}
          ${commentCount > 0 ? `<span class="comment-count">💬 ${commentCount}</span>` : ''}
        </div>
        <div class="report-meta">
          <span>👤 ${escapeHtml(report.username)}</span>
          <span>📅 ${formatDate(report.created_at)}</span>
        </div>
      </div>
      
      ${isExpanded ? renderReportDetails(report, isAdmin) : ''}
    </div>
  `;
}

/* ──────────────────────────────────────────────────────────
   REPORT RÉSZLETEK - LEÍRÁS MINT ELSŐ KOMMENT
   ────────────────────────────────────────────────────────── */
function renderReportDetails(report, isAdmin) {
  return `
    <div class="report-details">
      <div class="details-grid">
        
        <!-- BAL: Kép -->
        <div class="left-col">
          <div class="image-box">
            <img src="${report.image_url}" alt="Bug preview" loading="lazy">
          </div>
          
          ${report.close_reason ? `
            <div class="close-reason-box">
              <strong>Lezárás oka:</strong>
              <p>${escapeHtml(report.close_reason)}</p>
            </div>
          ` : ''}
          
          ${report.is_closed ? `
            <div class="closed-info">
              🔒 Lezárta: ${escapeHtml(report.closed_by_name || 'Ismeretlen')}
            </div>
          ` : ''}
        </div>
        
        <!-- JOBB: Kommentek (leírás ELSŐ komment) -->
        <div class="right-col">
          <h4>💬 Kommentek</h4>
          <div id="comments-${report.id}" class="comments-box">
            <div class="loading">Betöltés...</div>
          </div>
          
          ${!report.is_closed ? `
            <div class="new-comment">
              <textarea 
                id="newComment-${report.id}" 
                placeholder="Írj kommentet..."
                rows="2"
              ></textarea>
              <button onclick="postComment(${report.id})" class="send-btn">
                Küldés
              </button>
            </div>
          ` : ''}
        </div>
        
      </div>
      
      <!-- Admin gombok -->
      ${isAdmin && !report.is_closed ? `
        <div class="admin-bar">
          <button onclick="openFixEditor(${report.id})" class="btn-fix">
            ✏️ Javítom
          </button>
          <button onclick="openCloseReasonModal(${report.id})" class="btn-close">
            ❌ Lezárás
          </button>
          <button onclick="deleteBugReport(${report.id})" class="btn-delete">
            🗑️ Törlés
          </button>
        </div>
      ` : ''}
      
      ${isAdmin && report.is_closed ? `
        <div class="admin-bar">
          <button onclick="reopenBugReport(${report.id})" class="btn-reopen">
            🔓 Újranyitás
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/* ──────────────────────────────────────────────────────────
   TOGGLE FUNKCIÓK
   ────────────────────────────────────────────────────────── */
function toggleManga(slug) {
  expandedManga[slug] = !expandedManga[slug];
  renderBugReports();
}

function toggleReport(id) {
  expandedReports[id] = !expandedReports[id];
  if (expandedReports[id]) {
    setTimeout(() => loadComments(id), 100);
  }
  renderBugReports();
}

/* ──────────────────────────────────────────────────────────
   KOMMENTEK BETÖLTÉSE - LEÍRÁS ELSŐ
   ────────────────────────────────────────────────────────── */
async function loadComments(reportId) {
  const container = document.getElementById(`comments-${reportId}`);
  if (!container) return;
  
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/comments`);
    const comments = await res.json();
    
    // Leírás megkeresése
    const report = allBugReports.find(r => r.id === reportId);
    const description = report?.description || '';
    const reporterName = report?.username || 'Ismeretlen';
    const reportDate = report?.created_at || new Date();
    
    let html = '';
    
    // ELSŐ komment: Leírás (bejelentő neve)
    if (description) {
      html += `
        <div class="comment original-report">
          <div class="comment-head">
            <span class="author">👤 ${escapeHtml(reporterName)}</span>
            <span class="date">${formatDate(reportDate)}</span>
          </div>
          <div class="description-label">Leírás:</div>
          <div class="comment-text">${escapeHtml(description)}</div>
        </div>
      `;
    }
    
    // Többi komment
    if (comments.length > 0) {
      html += comments.map(c => `
        <div class="comment ${c.role === 'admin' ? 'admin' : ''}">
          <div class="comment-head">
            <span class="author">${c.role === 'admin' ? '👑' : '👤'} ${escapeHtml(c.username)}</span>
            <span class="date">${formatDate(c.created_at)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.comment)}</div>
        </div>
      `).join('');
    }
    
    if (!description && comments.length === 0) {
      html = '<div class="no-comments">Nincs komment</div>';
    }
    
    container.innerHTML = html;
    
  } catch (err) {
    console.error('Load comments error:', err);
    container.innerHTML = '<div class="error">Hiba</div>';
  }
}

/* ──────────────────────────────────────────────────────────
   KOMMENT KÜLDÉSE
   ────────────────────────────────────────────────────────── */
async function postComment(reportId) {
  const textarea = document.getElementById(`newComment-${reportId}`);
  const comment = textarea.value.trim();
  
  if (!comment) {
    textarea.style.borderColor = '#ef4444';
    setTimeout(() => textarea.style.borderColor = '', 2000);
    return;
  }
  
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment })
    });
    
    if (!res.ok) {
      alert('Hiba');
      return;
    }
    
    textarea.value = '';
    await loadComments(reportId);
    
  } catch (err) {
    console.error('Post comment error:', err);
    alert('Hiba');
  }
}

/* ──────────────────────────────────────────────────────────
   ADMIN MŰVELETEK
   ────────────────────────────────────────────────────────── */
function openFixEditor(reportId) {
  const report = allBugReports.find(r => r.id === reportId);
  if (!report) return;
  
  const url = `/editor.html?provider=${encodeURIComponent(report.provider || '')}&slug=${encodeURIComponent(report.manga_slug)}&chapter=${encodeURIComponent(report.chapter)}&image_index=${report.image_index}&image_url=${encodeURIComponent(report.image_url)}`;
  window.location.href = url;
}

function openCloseReasonModal(reportId) {
  const reason = prompt('Lezárás oka:');
  if (!reason || !reason.trim()) return;
  closeWithReason(reportId, reason.trim());
}

async function closeWithReason(reportId, reason) {
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/close-with-reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    
    if (!res.ok) {
      alert('Hiba');
      return;
    }
    
    alert('✅ Lezárva!');
    await loadBugReports();
    
  } catch (err) {
    console.error('Close error:', err);
    alert('Hiba');
  }
}

async function deleteBugReport(reportId) {
  if (!confirm('Biztosan törölni?')) return;
  
  try {
    const res = await fetch(`/api/bug-reports/${reportId}`, { method: 'DELETE' });
    if (!res.ok) {
      alert('Hiba');
      return;
    }
    
    alert('✅ Törölve!');
    await loadBugReports();
    
  } catch (err) {
    console.error('Delete error:', err);
    alert('Hiba');
  }
}

async function reopenBugReport(reportId) {
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/reopen`, { method: 'POST' });
    if (!res.ok) {
      alert('Hiba');
      return;
    }
    
    alert('✅ Újranyitva!');
    await loadBugReports();
    
  } catch (err) {
    console.error('Reopen error:', err);
    alert('Hiba');
  }
}

/* ──────────────────────────────────────────────────────────
   HELPER FUNKCIÓK
   ────────────────────────────────────────────────────────── */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
