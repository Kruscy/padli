/* anilist-sync-modal.js – Padli ⇄ AniList olvasási előrehaladás egyeztető modal a profil oldalon */

let syncMismatches = [];

/* ── STÁTUSZ BETÖLTÉSE ──────────────────────────────────── */
async function loadAniListSyncStatus() {
  const btn  = document.getElementById("anilistSyncBtn");
  const hint = document.getElementById("anilistSyncHint");
  if (!btn) return;

  try {
    const res  = await fetch("/api/anilist/status");
    const data = await res.json();
    if (data.connected) {
      hint?.classList.add("hidden");
      btn.disabled = false;
    } else {
      hint?.classList.remove("hidden");
      btn.disabled = true;
    }
  } catch (err) {
    console.error("ANILIST SYNC STATUS ERROR:", err);
  }
}

/* ── ÖSSZEVETÉS INDÍTÁSA ─────────────────────────────────── */
async function startAniListCompare() {
  const btn = document.getElementById("anilistSyncBtn");
  const fb  = document.getElementById("anilistSyncFeedback");
  if (fb) { fb.textContent = ""; }
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Ellenőrzés..."; }

  try {
    const res  = await fetch("/api/anilist/compare");
    const data = await res.json();

    if (!res.ok) {
      if (fb) { fb.style.color = "#ef4444"; fb.textContent = "❌ Nincs AniList összekapcsolva"; }
      return;
    }

    syncMismatches = data.mismatches || [];

    if (!syncMismatches.length) {
      if (fb) { fb.style.color = "#22c55e"; fb.textContent = "✔ Minden fejezet egyezik!"; }
      return;
    }

    openSyncModal();

  } catch (err) {
    console.error("ANILIST COMPARE ERROR:", err);
    if (fb) { fb.style.color = "#ef4444"; fb.textContent = "❌ Szerverrel nem sikerült kapcsolatba lépni"; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Szinkronizálás"; }
  }
}

/* ── MODAL LÉTREHOZÁSA ───────────────────────────────────── */
function createSyncModal() {
  if (document.getElementById("syncModal")) return;

  const modal = document.createElement("div");
  modal.id = "syncModal";
  modal.style.cssText = `
    display:none; position:fixed; inset:0; z-index:500;
    background:rgba(0,0,0,.92); overflow:hidden;
    flex-direction:column; align-items:center; justify-content:center;
  `;

  modal.innerHTML = `
    <div id="syncModalBox" style="
      width:min(96vw, 700px); max-height:96vh; max-height:96dvh; background:#0f0f1a;
      border:1px solid rgba(255,255,255,.1); border-radius:18px;
      display:flex; flex-direction:column; overflow:hidden;
    ">
      <!-- Fejléc -->
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:14px 20px; border-bottom:1px solid rgba(255,255,255,.08);
        flex-shrink:0;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:1.2rem">📚</span>
          <span style="font-weight:700; color:#f0f0fa; font-size:1rem">AniList szinkron</span>
        </div>
        <button id="syncCloseBtn" style="
          background:none; border:none; color:#888; font-size:1.4rem;
          cursor:pointer; padding:4px 8px; border-radius:6px;
        ">✕</button>
      </div>

      <!-- Görgethető lista -->
      <div id="syncList" style="overflow-y:auto; flex:1 1 auto; min-height:0; padding:16px 20px;"></div>

      <!-- Lábléc -->
      <div style="
        padding:14px 20px 18px; display:flex; justify-content:flex-end; gap:10px;
        flex-shrink:0; position:sticky; bottom:0; background:#0f0f1a; z-index:2;
      ">
        <button id="syncCancelBtn" style="
          background:none; border:1px solid rgba(255,255,255,.12);
          color:#888; padding:9px 20px; border-radius:9px;
          cursor:pointer; font-size:.88rem; font-weight:600;
        ">Mégse</button>
        <button id="syncOkBtn" style="
          background:linear-gradient(135deg,#7c3aed,#5b21b6);
          border:none; color:#fff; padding:9px 22px; border-radius:9px;
          cursor:pointer; font-size:.88rem; font-weight:700;
        ">✔ OK</button>
      </div>

      <!-- Visszajelzés -->
      <div id="syncFeedback" style="
        display:none; padding:12px 20px; text-align:center;
        font-size:.88rem; font-weight:600;
      "></div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .sync-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,.1);
      background: #1a1a2e; margin-bottom: 10px;
    }
    .sync-row img {
      width: 42px; height: 58px; object-fit: cover;
      border-radius: 6px; flex-shrink: 0;
    }
    .sync-row .sync-title {
      font-weight: 600; color: #f0f0fa; font-size: .85rem;
      margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sync-row .sync-values {
      display: flex; align-items: center; gap: 8px;
      font-size: .78rem; color: #888;
    }
    .sync-toggle {
      position: relative; display: inline-block;
      width: 40px; height: 22px; flex-shrink: 0; cursor: pointer;
    }
    .sync-toggle input { opacity: 0; width: 0; height: 0; }
    .sync-toggle-slider {
      position: absolute; inset: 0;
      background: #7c3aed; border-radius: 22px;
      transition: background .2s;
    }
    .sync-toggle-slider::before {
      content: ''; position: absolute;
      width: 16px; height: 16px; left: 3px; top: 3px;
      background: #fff; border-radius: 50%;
      transition: transform .2s;
    }
    .sync-toggle input:checked + .sync-toggle-slider { background: #22c55e; }
    .sync-toggle input:checked + .sync-toggle-slider::before { transform: translateX(18px); }
  `;
  document.head.appendChild(style);

  document.body.appendChild(modal);

  document.getElementById("syncCloseBtn").addEventListener("click", closeSyncModal);
  document.getElementById("syncCancelBtn").addEventListener("click", closeSyncModal);
  document.getElementById("syncModalBox").addEventListener("click", e => e.stopPropagation());
  modal.addEventListener("click", e => { if (e.target === modal) closeSyncModal(); });
  document.getElementById("syncOkBtn").addEventListener("click", applySyncResolutions);
}

/* ── MODAL MEGNYITÁSA ────────────────────────────────────── */
function openSyncModal() {
  createSyncModal();

  const list = document.getElementById("syncList");
  list.innerHTML = syncMismatches.map((m, i) => {
    // Alapértelmezett: a magasabb progress oldala nyer
    const keepAnilist = m.anilistProgress > m.padliProgress;
    return `
      <div class="sync-row" data-index="${i}">
        <img src="${m.cover_url || "/assets/no-cover.png"}" alt="">
        <div style="flex:1; min-width:0;">
          <div class="sync-title">${escapeHtml(m.title)}</div>
          <div class="sync-values">
            <span>Padli: Ch${m.padliProgress}</span>
            <label class="sync-toggle">
              <input type="checkbox" ${keepAnilist ? "checked" : ""}>
              <span class="sync-toggle-slider"></span>
            </label>
            <span>AniList: Ch${m.anilistProgress}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  const fb = document.getElementById("syncFeedback");
  fb.style.display = "none";
  fb.textContent = "";

  const okBtn = document.getElementById("syncOkBtn");
  okBtn.style.display = "";
  okBtn.disabled = false;
  okBtn.textContent = "✔ OK";

  document.getElementById("syncModal").style.display = "flex";
}

function closeSyncModal() {
  const modal = document.getElementById("syncModal");
  if (modal) modal.style.display = "none";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ── DÖNTÉSEK ALKALMAZÁSA ────────────────────────────────── */
async function applySyncResolutions() {
  const okBtn = document.getElementById("syncOkBtn");
  const fb    = document.getElementById("syncFeedback");

  const rows = [...document.querySelectorAll("#syncList .sync-row")];
  const resolutions = rows.map(row => {
    const i = parseInt(row.dataset.index, 10);
    const m = syncMismatches[i];
    const keepAnilist = row.querySelector(".sync-toggle input").checked;
    return {
      slug: m.slug,
      anilist_id: m.anilist_id,
      resolution: keepAnilist ? "anilist" : "padli",
      padliProgress: m.padliProgress,
      anilistProgress: m.anilistProgress,
    };
  });

  okBtn.textContent = "⏳ Mentés...";
  okBtn.disabled = true;

  try {
    const res = await fetch("/api/anilist/apply-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutions }),
    });
    const data = await res.json();

    fb.style.display = "block";
    if (res.ok) {
      const failedCount = data.failed?.length || 0;
      fb.style.color = failedCount ? "#f59e0b" : "#22c55e";
      fb.textContent = failedCount
        ? `⚠ ${data.applied.length} mentve, ${failedCount} nem sikerült`
        : `✅ ${data.applied.length} fejezet frissítve!`;
      okBtn.style.display = "none";
      setTimeout(closeSyncModal, 2200);
    } else {
      fb.style.color = "#ef4444";
      fb.textContent = "❌ " + (data.error || "Hiba történt");
      okBtn.textContent = "✔ OK";
      okBtn.disabled = false;
    }
  } catch (err) {
    console.error("ANILIST APPLY-SYNC ERROR:", err);
    fb.style.display = "block";
    fb.style.color = "#ef4444";
    fb.textContent = "❌ Szerverrel nem sikerült kapcsolatba lépni";
    okBtn.textContent = "✔ OK";
    okBtn.disabled = false;
  }
}

/* ── INDÍTÁS ──────────────────────────────────────────────── */
document.getElementById("anilistSyncBtn")?.addEventListener("click", startAniListCompare);
loadAniListSyncStatus();
