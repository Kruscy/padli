/* ═══════════════════════════════════════════════════════════
   BUG-REPORTS.JS
   ═══════════════════════════════════════════════════════════ */

let allBugReports = [];
let allChapterBugs = [];
window.currentUser = window.currentUser || null;
let activeTab = 'open';
let expandedManga = {};
let expandedChapterBugs = {};
let expandedReports = {};
let fixIndexes = {}; // reportId → aktív javítás indexe

/* ──────────────────────────────────────────────────────────
   KÉP LIGHTBOX (szélességre optimalizált, görgethető)
   ────────────────────────────────────────────────────────── */
function openImageLightbox(src, label) {
  let overlay = document.getElementById('imgLightboxOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'imgLightboxOverlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10002;
      background:rgba(0,0,0,.92);
      display:flex;justify-content:center;
      overflow-y:auto;
      padding:24px 0 40px;
      cursor:zoom-out;
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target === overlay.firstChild) closeImageLightbox(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeImageLightbox(); });

    const inner = document.createElement('div');
    inner.style.cssText = `
      width:min(98vw,900px);
      display:flex;flex-direction:column;align-items:stretch;
      cursor:default;
    `;

    const header = document.createElement('div');
    header.id = 'imgLightboxLabel';
    header.style.cssText = `
      color:#888;font-size:.78rem;padding:0 0 8px 2px;flex-shrink:0;
      display:flex;justify-content:space-between;align-items:center;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      position:fixed;top:16px;right:20px;z-index:10003;
      background:rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.2);
      color:#ccc;padding:8px 14px;border-radius:8px;cursor:pointer;
      font-size:.9rem;font-weight:700;backdrop-filter:blur(4px);
      transition:background .15s;
    `;
    closeBtn.onmouseenter = () => closeBtn.style.background = 'rgba(60,60,60,.9)';
    closeBtn.onmouseleave = () => closeBtn.style.background = 'rgba(0,0,0,.7)';
    closeBtn.addEventListener('click', closeImageLightbox);

    const img = document.createElement('img');
    img.id = 'imgLightboxImg';
    img.style.cssText = `
      width:100%;height:auto;display:block;
      border-radius:8px;border:1px solid rgba(255,255,255,.08);
    `;

    header.appendChild(document.createElement('span'));
    inner.appendChild(header);
    inner.appendChild(img);
    overlay.appendChild(inner);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);
  }

  document.getElementById('imgLightboxImg').src = src;
  document.getElementById('imgLightboxLabel').firstChild.textContent = label || '';
  overlay.style.display = 'flex';
  overlay.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeImageLightbox() {
  const overlay = document.getElementById('imgLightboxOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

/* ──────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────── */
(async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) window.currentUser = await res.json();
  } catch (_) {}

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderBugReports();
    });
  });

  await Promise.all([loadBugReports(), loadChapterBugs()]);

  // Ha URL-ben van id, nyissa ki azt a reportot
  const urlId = new URLSearchParams(location.search).get('id');
  if (urlId) window.openBugReportById && window.openBugReportById(parseInt(urlId));
})();

/* ──────────────────────────────────────────────────────────
   BETÖLTÉS
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

async function loadChapterBugs() {
  try {
    const res = await fetch('/api/chapter-bugs');
    if (res.ok) allChapterBugs = await res.json();
    updateBadges();
    if (activeTab === 'chapter') renderBugReports();
  } catch (err) {
    console.error('Load chapter bugs error:', err);
  }
}

function updateBadges() {
  const open    = allBugReports.filter(r => !r.is_closed && !(r.fixes?.length > 0)).length;
  const fixed   = allBugReports.filter(r => !r.is_closed &&  (r.fixes?.length > 0)).length;
  const closed  = allBugReports.filter(r =>  r.is_closed).length;
  const chapter = allChapterBugs.filter(r => !r.is_fixed).length;
  const ob = document.getElementById('badge-open');
  const fb = document.getElementById('badge-fixed');
  const cb = document.getElementById('badge-closed');
  const chb = document.getElementById('badge-chapter');
  if (ob)  ob.textContent  = open;
  if (fb)  fb.textContent  = fixed;
  if (cb)  cb.textContent  = closed;
  if (chb) chb.textContent = chapter;
}

function filterByTab(reports) {
  if (activeTab === 'open')   return reports.filter(r => !r.is_closed && !(r.fixes?.length > 0));
  if (activeTab === 'fixed')  return reports.filter(r => !r.is_closed &&  (r.fixes?.length > 0));
  if (activeTab === 'closed') return reports.filter(r =>  r.is_closed);
  return reports;
}

/* ──────────────────────────────────────────────────────────
   CSOPORTOSÍTÁS
   ────────────────────────────────────────────────────────── */
function groupReports(reports) {
  const grouped = {};
  reports.forEach(report => {
    const manga = report.manga_slug;
    const chapter = report.chapter;
    if (!grouped[manga]) grouped[manga] = { title: report.manga_title || manga, translator: report.translator, chapters: {} };
    if (!grouped[manga].chapters[chapter]) grouped[manga].chapters[chapter] = [];
    grouped[manga].chapters[chapter].push(report);
  });
  return grouped;
}

/* ──────────────────────────────────────────────────────────
   RENDERELÉS
   ────────────────────────────────────────────────────────── */
function renderBugReports() {
  const container = document.getElementById('bugReportsContainer');

  if (activeTab === 'chapter') {
    renderChapterBugReports(container);
    return;
  }

  const filtered = filterByTab(allBugReports);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><p>Nincs hibajegy ebben a kategóriában</p></div>`;
    return;
  }

  const grouped = groupReports(filtered);
  let html = '';
  Object.entries(grouped).forEach(([slug, data]) => { html += renderMangaGroup(slug, data); });
  container.innerHTML = html;
}

/* ──────────────────────────────────────────────────────────
   HIBÁS RÉSZ TAB
   ────────────────────────────────────────────────────────── */
const CHAPTER_TYPE_LABELS = {
  english_remained: '🇬🇧 Angol maradt',
  wrong_chapter:    '❌ Rossz fejezet',
  other:            '💬 Egyéb'
};

function renderChapterBugReports(container) {
  const isAdmin = window.currentUser?.role === 'admin';
  const all = allChapterBugs.filter(r => !r.is_fixed);

  if (!all.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><p>Nincs rész szintű hibajegy</p></div>`;
    return;
  }

  // Csoportosítás manga + fejezet szerint
  const grouped = {};
  all.forEach(r => {
    const k = r.manga_slug;
    if (!grouped[k]) grouped[k] = { title: r.manga_title || r.manga_slug, chapters: {} };
    if (!grouped[k].chapters[r.chapter]) grouped[k].chapters[r.chapter] = [];
    grouped[k].chapters[r.chapter].push(r);
  });

  let html = '';
  Object.entries(grouped).forEach(([slug, data]) => {
    const isExp = expandedChapterBugs[slug];
    const chCount = Object.keys(data.chapters).length;
    const bugCount = Object.values(data.chapters).flat().length;
    html += `
      <div class="report-group">
        <div class="group-header" onclick="toggleChapterGroup('${escapeHtml(slug)}')">
          <div class="group-title">
            <span class="expand-icon">${isExp ? '▼' : '▶'}</span>
            <span class="manga-title">${escapeHtml(data.title)}</span>
          </div>
          <div class="group-meta"><span>${chCount} fejezet • ${bugCount} bejelentés</span></div>
        </div>
        ${isExp ? renderChapterBugChapters(slug, data.chapters, isAdmin) : ''}
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderChapterBugChapters(slug, chapters, isAdmin) {
  let html = '<div class="chapters-container">';
  Object.entries(chapters).sort((a, b) => a[0].localeCompare(b[0])).forEach(([chapter, reports]) => {
    html += `<div class="chapter-block"><div class="chapter-title">${escapeHtml(chapter)} (${reports.length} bejelentés)</div>`;
    reports.forEach(r => { html += renderChapterBugCard(r, isAdmin); });
    html += `</div>`;
  });
  html += '</div>';
  return html;
}

function renderChapterBugCard(r, isAdmin) {
  const typeLabel = CHAPTER_TYPE_LABELS[r.type] || r.type;
  const statusBadge = r.is_fixed
    ? `<span class="status closed-fixed">✅ Javítva</span>`
    : `<span class="status open">⚠️ Nyitott</span>`;

  const padliBtn = window.currentUser && !r.is_fixed ? `
    <button onclick="sendChapterToPadlicrome('${escapeHtml(r.manga_slug)}','${escapeHtml(r.chapter)}',${r.id},this)"
      class="btn-fix" style="background:#4f46e5;margin-top:8px;">🔮 Egész fejezet Padlicrome-ba</button>
  ` : '';

  const adminBar = isAdmin && !r.is_fixed ? `
    <div class="admin-bar" style="margin-top:10px;">
      <button onclick="markChapterBugFixed(${r.id})" class="btn-apply">✅ Javítva (+ CF cache frissítés)</button>
      <button onclick="purgeChapterCache('${escapeHtml(r.manga_slug)}','${escapeHtml(r.chapter)}','${escapeHtml(r.provider||'')}',${r.id},this)" class="btn-fix" style="background:#1e40af;">🔄 Csak CF cache frissítés</button>
      <button onclick="deleteChapterBug(${r.id})" class="btn-delete">🗑️ Törlés</button>
    </div>
  ` : '';

  const fixedInfo = r.is_fixed ? `
    <div class="closed-info" style="margin-top:8px;">✅ Javítva: ${escapeHtml(r.fixed_by_name || 'Ismeretlen')} · ${formatDate(r.fixed_at)}</div>
  ` : '';

  return `
    <div class="report-card" style="margin-bottom:10px;">
      <div class="report-header" style="cursor:default;">
        <div class="report-info" style="gap:8px;flex-wrap:wrap;">
          <span class="chapter-bug-type-badge">${typeLabel}</span>
          ${statusBadge}
          <span style="color:#888;font-size:.8rem;">👤 ${escapeHtml(r.reported_by_name || 'Ismeretlen')}</span>
          <span style="color:#666;font-size:.78rem;">📅 ${formatDate(r.created_at)}</span>
        </div>
      </div>
      ${r.description ? `<div style="padding:8px 16px;color:#ccc;font-size:.85rem;">💬 ${escapeHtml(r.description)}</div>` : ''}
      ${fixedInfo}
      ${padliBtn}
      ${adminBar}
    </div>
  `;
}

function toggleChapterGroup(slug) {
  expandedChapterBugs[slug] = !expandedChapterBugs[slug];
  renderBugReports();
}

async function markChapterBugFixed(id) {
  if (!confirm('Megjelölöd javítottként és frissíted a Cloudflare cache-t?')) return;
  try {
    const res = await fetch(`/api/chapter-bugs/${id}/fix`, { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (res.ok) {
      const purged = data.purged;
      let msg = '✅ Javítva!';
      if (purged?.purged)  msg += ` CF cache: ${purged.purged}/${purged.total} URL frissítve.`;
      if (purged?.skipped) msg += ` (CF purge kihagyva: ${purged.reason})`;
      if (purged?.error)   msg += ` (CF purge hiba: ${purged.error})`;
      alert(msg);
      await loadChapterBugs();
    } else {
      alert('❌ Hiba: ' + (data.error || 'Ismeretlen'));
    }
  } catch (_) { alert('❌ Szerver hiba'); }
}

async function purgeChapterCache(mangaSlug, chapter, provider, bugId, btnEl) {
  const btn = btnEl || null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Frissítés...'; }
  try {
    const res = await fetch('/api/chapter-bugs/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ manga_slug: mangaSlug, chapter, provider: provider || undefined })
    });
    const data = await res.json();
    if (res.ok) {
      const p = data.purged;
      let msg = '🔄 CF cache frissítés:';
      if (p?.purged)  msg += ` ${p.purged}/${p.total} URL frissítve.`;
      if (p?.skipped) msg += ` Kihagyva: ${p.reason}`;
      if (p?.error)   msg += ` Hiba: ${p.error}`;
      alert(msg);
    } else {
      alert('❌ Hiba: ' + (data.error || 'Ismeretlen'));
    }
  } catch (_) { alert('❌ Szerver hiba'); }
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Csak CF cache frissítés'; }
}

async function deleteChapterBug(id) {
  if (!confirm('Biztosan törölni?')) return;
  try {
    const res = await fetch(`/api/chapter-bugs/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { alert('Hiba'); return; }
    await loadChapterBugs();
  } catch (_) { alert('Hiba'); }
}

function renderMangaGroup(slug, data) {
  const isExpanded = expandedManga[slug];
  const chapterCount = Object.keys(data.chapters).length;
  const imageCount = Object.values(data.chapters).flat().length;
  return `
    <div class="report-group">
      <div class="group-header" onclick="toggleManga('${escapeHtml(slug)}')">
        <div class="group-title">
          <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
          <span class="manga-title">${escapeHtml(data.title)}</span>
          ${data.translator ? `<span class="translator-badge">👤 ${escapeHtml(data.translator)}</span>` : ''}
        </div>
        <div class="group-meta"><span>${chapterCount} chapter • ${imageCount} kép</span></div>
      </div>
      ${isExpanded ? renderChapters(slug, data.chapters) : ''}
    </div>
  `;
}

function renderChapters(slug, chapters) {
  let html = '<div class="chapters-container">';
  Object.entries(chapters).sort((a, b) => a[0].localeCompare(b[0])).forEach(([chapter, reports]) => {
    html += `
      <div class="chapter-block">
        <div class="chapter-title">${escapeHtml(chapter)} (${reports.length} kép)</div>
        ${reports.map(r => renderImageReport(r)).join('')}
      </div>
    `;
  });
  html += '</div>';
  return html;
}

function renderImageReport(report) {
  const isAdmin = window.currentUser?.role === 'admin';
  const isExpanded = expandedReports[report.id];
  const hasFixes = report.fixes?.length > 0;

  let statusBadge = '';
  if (!report.is_closed) {
    statusBadge = hasFixes
      ? `<span class="status fixed">✅ Javítva</span>`
      : `<span class="status open">⚠️ Nyitott</span>`;
  } else {
    statusBadge = report.closed_without_fix
      ? `<span class="status closed">❌ Elutasítva</span>`
      : `<span class="status closed-fixed">🔒 Lezárva (javítva)</span>`;
  }

  const reportCount = report.report_count || 1;
  const commentCount = report.comment_count || 0;

  return `
    <div class="report-card ${isExpanded ? 'expanded' : ''}" data-report-id="${report.id}">
      <div class="report-header" onclick="toggleReport(${report.id})">
        <div class="report-info">
          <span class="image-num">Kép #${report.image_index}</span>
          ${statusBadge}
          ${reportCount > 1 ? `<span class="report-count-badge">🚩 ${reportCount}× bejelentve</span>` : ''}
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
   REPORT RÉSZLETEK
   ────────────────────────────────────────────────────────── */
function renderReportDetails(report, isAdmin) {
  const hasFixes = report.fixes?.length > 0;
  const fixes = report.fixes || [];
  const fixIdx = fixIndexes[report.id] || 0;
  const activeFix = fixes[fixIdx] || null;

  // JAVÍTANI VALÓ tab: eredeti kép nagy, feltöltés/editor gombok
  if (!hasFixes && !report.is_closed) {
    return `
      <div class="report-details">
        <div class="details-grid">
          <div class="left-col">
            <div class="image-box-large">
              <div class="image-label">🔴 Eredeti (hibás) kép <span style="font-weight:400;color:#555;font-size:.72rem">— kattints a nagyításhoz</span></div>
              <img src="${escapeHtml(report.image_url)}" alt="Bug preview" loading="lazy" style="cursor:zoom-in"
                onclick="openImageLightbox(this.src, 'Kép #${report.image_index} — ${escapeHtml(report.manga_slug)} ${escapeHtml(report.chapter)}')">
            </div>
          </div>
          <div class="right-col">
            <h4>💬 Kommentek</h4>
            <div id="comments-${report.id}" class="comments-box"><div class="loading">Betöltés...</div></div>
            <div class="new-comment">
              <textarea id="newComment-${report.id}" placeholder="Írj kommentet..." rows="2"></textarea>
              <button onclick="postComment(${report.id})" class="send-btn">Küldés</button>
            </div>
          </div>
        </div>
        <div class="action-bar">
          <button onclick="openFixEditor(${report.id})" class="btn-fix">✏️ Megnyitás szerkesztőben</button>
          <button onclick="openDirectUpload(${report.id})" class="btn-upload-fix">📷 Javított kép feltöltése</button>
          <input type="file" id="directUpload-${report.id}" accept="image/*" style="display:none" onchange="submitDirectUpload(${report.id})">
          ${window.currentUser ? `<button onclick="sendToPadlicrome(${report.id}, '${escapeHtml(report.image_url)}', '${escapeHtml(report.manga_slug)}', '${escapeHtml(report.chapter)}', ${report.image_index ?? 'null'}, '${escapeHtml(report.image_file ?? '')}')" class="btn-fix" style="background:#4f46e5">🔮 Padlicrome fordítás</button>` : ''}
        </div>
        ${isAdmin ? `
          <div class="admin-bar">
            <button onclick="openCloseReasonModal(${report.id})" class="btn-close">❌ Lezárás</button>
            <button onclick="deleteBugReport(${report.id})" class="btn-delete">🗑️ Törlés</button>
          </div>` : ''}
      </div>
    `;
  }

  // JAVÍTOTT tab: javított kép nagy, eredeti kis thumbnail
  if (hasFixes && !report.is_closed) {
    const fixNavHtml = fixes.length > 1 ? `
      <div class="fix-nav">
        <button onclick="prevFix(${report.id})" class="fix-nav-btn" ${fixIdx === 0 ? 'disabled' : ''}>← Előző</button>
        <span class="fix-nav-count">${fixIdx + 1} / ${fixes.length} javítás</span>
        <button onclick="nextFix(${report.id})" class="fix-nav-btn" ${fixIdx === fixes.length - 1 ? 'disabled' : ''}>Következő →</button>
      </div>
    ` : '';

    const pointToggleHtml = isAdmin ? `
      <label class="toggle-label">
        <span>Pont jár érte:</span>
        <label class="toggle-switch">
          <input type="checkbox" id="awardPoints-${activeFix?.id}" ${activeFix?.award_points !== false ? 'checked' : ''}
            onchange="toggleAwardPoints(${activeFix?.id}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </label>
    ` : '';

    const acceptBtnHtml = isAdmin && activeFix && !activeFix.is_applied ? `
      <button onclick="applyFix(${activeFix.id}, ${report.id})" class="btn-apply">✅ Ez a javítás elfogadása</button>
    ` : (activeFix?.is_applied ? `<span class="applied-badge">✅ Elfogadott javítás</span>` : '');

    return `
      <div class="report-details">
        <div class="details-grid fix-tab-grid">
          <div class="left-col">
            ${activeFix ? `
              <div class="image-box-large fix-image-box">
                <div class="image-label">✅ Javított kép${fixes.length > 1 ? ` (${fixIdx + 1}/${fixes.length})` : ''} <span style="font-weight:400;color:#555;font-size:.72rem">— kattints a nagyításhoz</span></div>
                <img src="${escapeHtml(activeFix.fixed_image_url)}" alt="Javított kép" loading="lazy" style="cursor:zoom-in"
                  onclick="openImageLightbox(this.src, '✅ Javított kép #${report.image_index} — ${escapeHtml(report.manga_slug)} ${escapeHtml(report.chapter)}')">
              </div>
              ${fixNavHtml}
              <div class="fix-meta">
                <span>👤 ${escapeHtml(activeFix.fixed_by_name || 'Ismeretlen')}</span>
                <span>📅 ${formatDate(activeFix.fixed_at)}</span>
              </div>
              <div class="fix-actions">
                ${pointToggleHtml}
                ${acceptBtnHtml}
              </div>
            ` : ''}
            <div class="original-thumb-box">
              <div class="image-label small-label">🔴 Eredeti (hibás) <span style="font-weight:400;color:#555;font-size:.68rem">— kattints</span></div>
              <img src="${escapeHtml(report.image_url)}" alt="Eredeti kép" loading="lazy" class="original-thumb" style="cursor:zoom-in"
                onclick="openImageLightbox(this.src, '🔴 Eredeti kép #${report.image_index} — ${escapeHtml(report.manga_slug)} ${escapeHtml(report.chapter)}')">
            </div>
          </div>
          <div class="right-col">
            <h4>💬 Kommentek</h4>
            <div id="comments-${report.id}" class="comments-box"><div class="loading">Betöltés...</div></div>
            <div class="new-comment">
              <textarea id="newComment-${report.id}" placeholder="Írj kommentet..." rows="2"></textarea>
              <button onclick="postComment(${report.id})" class="send-btn">Küldés</button>
            </div>
          </div>
        </div>
        <div class="action-bar">
          <button onclick="openDirectUpload(${report.id})" class="btn-upload-fix">📷 Saját javítás feltöltése</button>
          <input type="file" id="directUpload-${report.id}" accept="image/*" style="display:none" onchange="submitDirectUpload(${report.id})">
        </div>
        ${isAdmin ? `
          <div class="admin-bar">
            <button onclick="openCloseReasonModal(${report.id})" class="btn-close">❌ Lezárás</button>
            <button onclick="deleteBugReport(${report.id})" class="btn-delete">🗑️ Törlés</button>
            ${activeFix ? `
              <button onclick="openEditorForCorrection(${activeFix.id}, '${escapeHtml(activeFix.fixed_image_url)}', '${escapeHtml(report.manga_slug)}', '${escapeHtml(report.chapter)}', ${report.image_index ?? 0}, '${escapeHtml(report.provider || '')}')" class="btn-fix" style="background:#7c3aed">✏️ Finomítás az editorban</button>
            ` : ''}
          </div>` : ''}
      </div>
    `;
  }

  // LEZÁRT tab
  const appliedFix = (report.fixes || []).find(f => f.is_applied);
  return `
    <div class="report-details">
      <div class="details-grid">
        <div class="left-col">
          ${appliedFix ? `
            <div class="image-box-large fix-image-box">
              <div class="image-label">✅ Javított kép <span style="font-weight:400;color:#555;font-size:.72rem">— kattints a nagyításhoz</span></div>
              <img src="${escapeHtml(appliedFix.fixed_image_url)}" alt="Javított kép" loading="lazy" style="cursor:zoom-in"
                onclick="openImageLightbox(this.src, '✅ Javított kép #${report.image_index} — ${escapeHtml(report.manga_slug)} ${escapeHtml(report.chapter)}')">
            </div>
            <div class="fix-meta">
              <span>👤 ${escapeHtml(appliedFix.fixed_by_name || 'Ismeretlen')}</span>
              <span>📅 ${formatDate(appliedFix.fixed_at)}</span>
            </div>
          ` : `
            <div class="image-box-large">
              <div class="image-label">Eredeti kép <span style="font-weight:400;color:#555;font-size:.72rem">— kattints a nagyításhoz</span></div>
              <img src="${escapeHtml(report.image_url)}" alt="Bug preview" loading="lazy" style="cursor:zoom-in"
                onclick="openImageLightbox(this.src, 'Kép #${report.image_index} — ${escapeHtml(report.manga_slug)} ${escapeHtml(report.chapter)}')">
            </div>
          `}
          ${report.close_reason ? `<div class="close-reason-box"><strong>Lezárás oka:</strong><p>${escapeHtml(report.close_reason)}</p></div>` : ''}
          <div class="closed-info">🔒 Lezárta: ${escapeHtml(report.closed_by_name || 'Ismeretlen')}</div>
        </div>
        <div class="right-col">
          <h4>💬 Kommentek</h4>
          <div id="comments-${report.id}" class="comments-box"><div class="loading">Betöltés...</div></div>
        </div>
      </div>
      ${isAdmin ? `
        <div class="admin-bar">
          <button onclick="reopenBugReport(${report.id})" class="btn-reopen">🔓 Újranyitás</button>
          ${appliedFix ? `
            <label class="toggle-label">
              <span>Pont jár érte:</span>
              <label class="toggle-switch">
                <input type="checkbox" id="awardPoints-${appliedFix.id}" ${appliedFix.award_points !== false ? 'checked' : ''}
                  onchange="toggleAwardPoints(${appliedFix.id}, this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </label>
            <button onclick="document.getElementById('correctInput-${appliedFix.id}').click()" class="btn-fix" style="background:#7c3aed">✏️ Javítás korrigálása</button>
            <input type="file" id="correctInput-${appliedFix.id}" accept="image/*" style="display:none"
              onchange="submitCorrection(${appliedFix.id}, ${report.id}, this)">
          ` : ''}
        </div>` : ''}
    </div>
  `;
}

/* ──────────────────────────────────────────────────────────
   FIX NAVIGÁCIÓ
   ────────────────────────────────────────────────────────── */
function prevFix(reportId) {
  const report = allBugReports.find(r => r.id === reportId);
  if (!report) return;
  const idx = fixIndexes[reportId] || 0;
  if (idx > 0) {
    fixIndexes[reportId] = idx - 1;
    expandedReports[reportId] = true;
    renderBugReports();
    setTimeout(() => loadComments(reportId), 50);
  }
}

function nextFix(reportId) {
  const report = allBugReports.find(r => r.id === reportId);
  if (!report) return;
  const fixes = report.fixes || [];
  const idx = fixIndexes[reportId] || 0;
  if (idx < fixes.length - 1) {
    fixIndexes[reportId] = idx + 1;
    expandedReports[reportId] = true;
    renderBugReports();
    setTimeout(() => loadComments(reportId), 50);
  }
}

/* ──────────────────────────────────────────────────────────
   TOGGLE
   ────────────────────────────────────────────────────────── */
function toggleManga(slug) {
  expandedManga[slug] = !expandedManga[slug];
  renderBugReports();
}

function toggleReport(id) {
  expandedReports[id] = !expandedReports[id];
  if (expandedReports[id]) setTimeout(() => loadComments(id), 100);
  renderBugReports();
}

/* ──────────────────────────────────────────────────────────
   KOMMENTEK
   ────────────────────────────────────────────────────────── */
async function loadComments(reportId) {
  const container = document.getElementById(`comments-${reportId}`);
  if (!container) return;
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/comments`);
    const comments = await res.json();
    const report = allBugReports.find(r => r.id === reportId);
    const description = report?.description || '';
    const reporterName = report?.username || 'Ismeretlen';
    const reportDate = report?.created_at || new Date();
    const reportCount = report?.report_count || 1;

    let html = '';
    if (description) {
      html += `
        <div class="comment original-report">
          <div class="comment-head">
            <span class="author">👤 ${escapeHtml(reporterName)}</span>
            <span class="date">${formatDate(reportDate)}</span>
            ${reportCount > 1 ? `<span class="also-reported">+${reportCount - 1} másik felhasználó is jelezte</span>` : ''}
          </div>
          <div class="description-label">Leírás:</div>
          <div class="comment-text">${escapeHtml(description)}</div>
        </div>
      `;
    }
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
    if (!description && comments.length === 0) html = '<div class="no-comments">Nincs komment</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="error">Hiba</div>';
  }
}

async function postComment(reportId) {
  const textarea = document.getElementById(`newComment-${reportId}`);
  const comment = textarea.value.trim();
  if (!comment) { textarea.style.borderColor = '#ef4444'; setTimeout(() => textarea.style.borderColor = '', 2000); return; }
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment })
    });
    if (!res.ok) { alert('Hiba'); return; }
    textarea.value = '';
    await loadComments(reportId);
  } catch (_) { alert('Hiba'); }
}

/* ──────────────────────────────────────────────────────────
   FIX FELTÖLTÉS (közvetlen)
   ────────────────────────────────────────────────────────── */
function openDirectUpload(reportId) {
  document.getElementById(`directUpload-${reportId}`)?.click();
}

async function submitDirectUpload(reportId) {
  const input = document.getElementById(`directUpload-${reportId}`);
  if (!input?.files?.length) return;
  const report = allBugReports.find(r => r.id === reportId);
  if (!report) return;

  const formData = new FormData();
  formData.append('image', input.files[0]);
  formData.append('manga_slug', report.manga_slug);
  formData.append('chapter', report.chapter);
  formData.append('image_index', report.image_index);
  formData.append('provider', report.provider || '');

  try {
    const uploadBtn = document.querySelector(`button[onclick="openDirectUpload(${reportId})"]`);
    if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '⏳ Feltöltés...'; }

    const res = await fetch('/api/bug-reports/fix/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok) {
      await loadBugReports();
      // Javított fülre váltás
      document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.dataset.tab === 'fixed') { b.click(); }
      });
    } else {
      alert('❌ Hiba: ' + (data.error || 'Ismeretlen'));
      if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = '📷 Javított kép feltöltése'; }
    }
  } catch (_) {
    alert('❌ Szerver hiba');
  }
  input.value = '';
}

/* ──────────────────────────────────────────────────────────
   PONT TOGGLE
   ────────────────────────────────────────────────────────── */
async function toggleAwardPoints(fixId, value) {
  try {
    await fetch(`/api/bug-reports/fix/${fixId}/award-points`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ award_points: value })
    });
    // Frissítjük a helyi adatot is
    allBugReports.forEach(r => {
      if (r.fixes) r.fixes.forEach(f => { if (f.id === fixId) f.award_points = value; });
    });
  } catch (_) {}
}

/* ──────────────────────────────────────────────────────────
   ADMIN MŰVELETEK
   ────────────────────────────────────────────────────────── */
async function applyFix(fixId, reportId) {
  const awardEl = document.getElementById(`awardPoints-${fixId}`);
  const awardPoints = awardEl ? awardEl.checked : true;
  const msg = awardPoints
    ? 'Elfogadod a javítást? A javító +5 pontot kap és a hibajegy lezárul.'
    : 'Elfogadod a javítást? (Pont NEM kerül jóváírásra)';
  if (!confirm(msg)) return;

  const btn = document.querySelector(`button[onclick="applyFix(${fixId}, ${reportId})"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Alkalmazás...'; }

  try {
    // Biztos hogy a toggle értéke mentve van
    await fetch(`/api/bug-reports/fix/${fixId}/award-points`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ award_points: awardPoints })
    });

    const res = await fetch(`/api/bug-reports/fix/${fixId}/apply`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      alert(awardPoints ? '✅ Javítás elfogadva! +5 pont jóváírva.' : '✅ Javítás elfogadva (pont nélkül).');
      await loadBugReports();
    } else {
      alert('❌ Hiba: ' + (data.error || 'Ismeretlen hiba'));
      if (btn) { btn.disabled = false; btn.textContent = '✅ Ez a javítás elfogadása'; }
    }
  } catch (_) {
    alert('❌ Szerver hiba');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Ez a javítás elfogadása'; }
  }
}

function openFixEditor(reportId) {
  const report = allBugReports.find(r => r.id === reportId);
  if (!report) return;
  const url = `/editor.html?provider=${encodeURIComponent(report.provider || '')}&slug=${encodeURIComponent(report.manga_slug)}&chapter=${encodeURIComponent(report.chapter)}&image_index=${report.image_index}&image_url=${encodeURIComponent(report.image_url)}`;
  window.location.href = url;
}

function openCloseReasonModal(reportId) {
  const reason = prompt('Lezárás oka:');
  if (!reason?.trim()) return;
  closeWithReason(reportId, reason.trim());
}

async function closeWithReason(reportId, reason) {
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/close-with-reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) { alert('Hiba'); return; }
    alert('✅ Lezárva!');
    await loadBugReports();
  } catch (_) { alert('Hiba'); }
}

async function deleteBugReport(reportId) {
  if (!confirm('Biztosan törölni?')) return;
  try {
    const res = await fetch(`/api/bug-reports/${reportId}`, { method: 'DELETE' });
    if (!res.ok) { alert('Hiba'); return; }
    alert('✅ Törölve!');
    await loadBugReports();
  } catch (_) { alert('Hiba'); }
}

async function reopenBugReport(reportId) {
  try {
    const res = await fetch(`/api/bug-reports/${reportId}/reopen`, { method: 'POST' });
    if (!res.ok) { alert('Hiba'); return; }
    alert('✅ Újranyitva!');
    await loadBugReports();
  } catch (_) { alert('Hiba'); }
}

/* ──────────────────────────────────────────────────────────
   HELPER
   ────────────────────────────────────────────────────────── */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

window.openBugReportById = function(id) {
  const report = allBugReports.find(r => r.id === id);
  if (!report) return;
  if (report.is_closed) {
    document.querySelectorAll('.tab-btn').forEach(b => { if (b.dataset.tab === 'closed') b.click(); });
  } else if (report.fixes?.length > 0) {
    document.querySelectorAll('.tab-btn').forEach(b => { if (b.dataset.tab === 'fixed') b.click(); });
  }
  expandedManga[report.manga_slug] = true;
  expandedReports[id] = true;
  renderBugReports();
  setTimeout(() => {
    loadComments(id);
    const card = document.querySelector(`.report-card[data-report-id="${id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 150);
};

/* ── Admin javítás korrekció ─────────────────────────────── */
window.sendChapterToPadlicrome = async function(mangaSlug, chapter, chapterBugId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Importálás...'; }
  try {
    const res = await fetch('/api/padlicrome/import-chapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mangaSlug, chapter, chapterBugId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba');
    if (btnEl) { btnEl.textContent = `✅ ${data.added} kép hozzáadva`; }
    _updatePadliCounter();
    if (data.added > 0) setTimeout(() => window.open('/padlicrome.html', '_blank'), 600);
  } catch (err) {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔮 Egész fejezet Padlicrome-ba'; }
    alert('❌ ' + err.message);
  }
};

window.openEditorForCorrection = function(fixId, imageUrl, slug, chapter, imageIndex, provider) {
  const url = `/editor.html?fix_id=${fixId}&image_url=${encodeURIComponent(imageUrl)}&slug=${encodeURIComponent(slug)}&chapter=${encodeURIComponent(chapter)}&image_index=${imageIndex}&provider=${encodeURIComponent(provider)}`;
  window.open(url, '_blank');
};

window.submitCorrection = async function(fixId, reportId, input) {
  const file = input.files[0];
  if (!file) return;
  const btn = input.previousElementSibling;
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Feltöltés...'; }
  try {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`/api/bug-reports/fix/${fixId}/correct`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba');
    if (btn) { btn.textContent = '✅ Korrigálva!'; btn.style.background = '#166534'; }
    await loadBugReports();
  } catch (err) {
    alert('Korrekció hiba: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
  input.value = '';
};

/* ── Padlicrome fordítás adminoknak ─────────────────────── */
let _padliBugCount = 0;

function _updatePadliCounter() {
  let bar = document.getElementById('padliBugBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'padliBugBar';
    bar.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:10px;font-size:.88rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:12px';
    bar.innerHTML = `<span id="padliBugCountText"></span><a href="/padlicrome.html" target="_blank" style="color:#c4b5fd;text-decoration:underline;white-space:nowrap">🔮 Megnyitás</a>`;
    document.body.appendChild(bar);
  }
  const full = _padliBugCount >= 30;
  document.getElementById('padliBugCountText').textContent = full
    ? `🔮 Teli! (30/30) — Padlicrome megnyílik...`
    : `🔮 ${_padliBugCount}/30 kép a Padlicrome-ban`;
  if (full) {
    setTimeout(() => window.open('/padlicrome.html', '_blank'), 1200);
  }
}

window.sendToPadlicrome = async function(reportId, imageUrl, mangaSlug, chapter, imageIndex, imageFile) {
  const btn = event?.target;
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    const mangaTitle = document.querySelector(`.manga-group[data-slug="${mangaSlug}"] .manga-title`)?.textContent?.trim() || mangaSlug;
    const res = await fetch('/api/padlicrome/import-bug-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ imageUrl, reportId, mangaSlug, chapter, imageIndex, imageFile, mangaTitle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba');
    if (data.alreadyAdded) {
      if (btn) { btn.textContent = '✅ Már bent van'; btn.style.background = '#166534'; }
      return;
    }
    _padliBugCount++;
    _updatePadliCounter();
    if (btn) { btn.textContent = '✅ Hozzáadva'; btn.style.background = '#166534'; }
  } catch (err) {
    alert('Padlicrome import hiba: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
};
