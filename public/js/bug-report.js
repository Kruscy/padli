/* bug-report.js - Hibajegy beküldő modal a readerben */

/* ── ÁLLAPOT ─────────────────────────────────────────────── */
let bugModalOpen    = false;
let bugCurrentIndex = 0;
let bugAllFiles     = [];
let bugImageUrls    = [];   // teljes /api/image/PROVIDER/... URL-ek
let bugSlug         = "";
let bugChapter      = "";
let bugProvider     = "";   // ÚJ: Provider tracking

/* ── MODAL LÉTREHOZÁSA ───────────────────────────────────── */
function createBugModal() {
  if (document.getElementById("bugModal")) return;

  const modal = document.createElement("div");
  modal.id = "bugModal";
  modal.style.cssText = `
    display:none; position:fixed; inset:0; z-index:500;
    background:rgba(0,0,0,.92); overflow:hidden;
    flex-direction:column; align-items:center; justify-content:center;
  `;

  modal.innerHTML = `
    <div id="bugModalBox" style="
      width:min(96vw, 700px); max-height:96vh; background:#0f0f1a;
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
          <span style="font-size:1.2rem">🐛</span>
          <span style="font-weight:700; color:#f0f0fa; font-size:1rem">Hibabejelentés</span>
        </div>
        <button id="bugCloseBtn" style="
          background:none; border:none; color:#888; font-size:1.4rem;
          cursor:pointer; padding:4px 8px; border-radius:6px;
          transition:color .15s;
        ">✕</button>
      </div>

      <!-- Kép választó -->
      <div style="padding:16px 20px 0; flex-shrink:0;">
        <div style="
          font-size:.78rem; color:#666; text-transform:uppercase;
          letter-spacing:.08em; font-weight:700; margin-bottom:8px;
        ">Melyik kép a hibás?</div>

        <!-- Navigáció -->
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
          <button id="bugPrevImg" style="
            background:#1e1e30; border:1px solid rgba(255,255,255,.1);
            color:#fff; padding:6px 14px; border-radius:8px; cursor:pointer;
            font-size:.9rem; transition:background .15s;
          ">← Előző</button>
          <span id="bugPageInfo" style="
            flex:1; text-align:center; font-size:.85rem; color:#888;
          ">1 / 1</span>
          <button id="bugNextImg" style="
            background:#1e1e30; border:1px solid rgba(255,255,255,.1);
            color:#fff; padding:6px 14px; border-radius:8px; cursor:pointer;
            font-size:.9rem; transition:background .15s;
          ">Következő →</button>
        </div>

        <!-- Kép előnézet (zoom-olható) -->
        <div id="bugImgWrap" style="
          width:100%; height:38vh; min-height:180px;
          overflow:hidden; border-radius:10px;
          background:#080810; position:relative; cursor:zoom-in;
          border:2px solid rgba(124,92,255,.3);
          display:flex; align-items:center; justify-content:center;
        ">
          <img id="bugPreviewImg" src="" alt="" style="
            max-width:100%; max-height:100%; display:block;
            object-fit:contain; transform-origin:center center;
            transition:transform .2s; user-select:none;
          ">
          <!-- Zoom vezérlő -->
          <div style="
            position:absolute; bottom:8px; right:8px; display:flex; gap:6px;
          ">
            <button id="bugZoomIn" style="
              background:rgba(0,0,0,.7); border:1px solid rgba(255,255,255,.2);
              color:#fff; width:32px; height:32px; border-radius:8px;
              cursor:pointer; font-size:1.1rem; display:flex;
              align-items:center; justify-content:center;
            ">+</button>
            <button id="bugZoomOut" style="
              background:rgba(0,0,0,.7); border:1px solid rgba(255,255,255,.2);
              color:#fff; width:32px; height:32px; border-radius:8px;
              cursor:pointer; font-size:1.1rem; display:flex;
              align-items:center; justify-content:center;
            ">-</button>
            <button id="bugZoomReset" style="
              background:rgba(0,0,0,.7); border:1px solid rgba(255,255,255,.2);
              color:#888; width:32px; height:32px; border-radius:8px;
              cursor:pointer; font-size:.7rem; display:flex;
              align-items:center; justify-content:center;
            ">1:1</button>
          </div>
        </div>

        <!-- Kép azonosító -->
        <div id="bugImgName" style="
          font-size:.73rem; color:#444; margin-top:6px;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        "></div>
      </div>

      <!-- Leírás -->
      <div style="padding:14px 20px 0; flex-shrink:0;">
        <div style="
          font-size:.78rem; color:#666; text-transform:uppercase;
          letter-spacing:.08em; font-weight:700; margin-bottom:8px;
        ">Mi a hiba? <span style="color:#7c3aed">*</span></div>
        <textarea id="bugDescription" rows="3" placeholder="Pl. fordítási hiba, rossz szöveg, pixeles kép, hiányzó buborék..." style="
          width:100%; box-sizing:border-box;
          background:#080810; border:1px solid rgba(255,255,255,.12);
          color:#e0e0f0; border-radius:10px; padding:10px 14px;
          font-family:system-ui, sans-serif; font-size:.88rem;
          resize:vertical; outline:none; min-height:70px;
          transition:border-color .18s;
        "></textarea>
      </div>

      <!-- Küldés -->
      <div style="padding:14px 20px 18px; display:flex; justify-content:flex-end; gap:10px; flex-shrink:0;">
        <button id="bugCancelBtn" style="
          background:none; border:1px solid rgba(255,255,255,.12);
          color:#888; padding:9px 20px; border-radius:9px;
          cursor:pointer; font-size:.88rem; font-weight:600;
          transition:all .15s;
        ">Mégse</button>
        <button id="bugSubmitBtn" style="
          background:linear-gradient(135deg,#7c3aed,#5b21b6);
          border:none; color:#fff; padding:9px 22px; border-radius:9px;
          cursor:pointer; font-size:.88rem; font-weight:700;
          transition:opacity .15s;
        ">🐛 Beküldés</button>
      </div>

      <!-- Visszajelzés -->
      <div id="bugFeedback" style="
        display:none; padding:12px 20px; text-align:center;
        font-size:.88rem; font-weight:600;
      "></div>
    </div>
  `;

  document.body.appendChild(modal);
  initBugModalEvents(modal);
}

/* ── ZOOM ────────────────────────────────────────────────── */
let bugZoomLevel = 1;

function setBugZoom(level) {
  bugZoomLevel = Math.max(1, Math.min(4, level));
  const img  = document.getElementById("bugPreviewImg");
  const wrap = document.getElementById("bugImgWrap");
  if (img && wrap) {
    img.style.transform  = bugZoomLevel > 1 ? `scale(${bugZoomLevel})` : "none";
    img.style.maxWidth   = bugZoomLevel > 1 ? "none" : "100%";
    img.style.maxHeight  = bugZoomLevel > 1 ? "none" : "100%";
    wrap.style.overflow  = bugZoomLevel > 1 ? "auto" : "hidden";
    wrap.style.cursor    = bugZoomLevel > 1 ? "grab" : "zoom-in";
    wrap.style.alignItems   = bugZoomLevel > 1 ? "flex-start" : "center";
    wrap.style.justifyContent = bugZoomLevel > 1 ? "flex-start" : "center";
  }
}

/* ── KÉPVÁLTÁS ───────────────────────────────────────────── */
function bugUpdatePreview() {
  const img    = document.getElementById("bugPreviewImg");
  const info   = document.getElementById("bugPageInfo");
  const nameEl = document.getElementById("bugImgName");
  if (!img || !bugAllFiles.length) return;

  const f = bugAllFiles[bugCurrentIndex];
  
  // ÚJ: Provider-t is használjuk az URL-ben
  if (bugImageUrls && bugImageUrls[bugCurrentIndex]) {
    img.src = bugImageUrls[bugCurrentIndex];
  } else if (bugProvider) {
    img.src = `/api/image/${bugProvider}/${bugSlug}/${bugChapter}/${encodeURIComponent(f)}`;
  } else {
    img.src = `/api/image/${bugSlug}/${bugChapter}/${encodeURIComponent(f)}`;
  }
  
  info.textContent = `${bugCurrentIndex + 1} / ${bugAllFiles.length}`;
  nameEl.textContent = decodeURIComponent(f);
  setBugZoom(1);
}

/* ── MODAL MEGNYITÁSA ────────────────────────────────────── */
// ÚJ: provider paraméter hozzáadva
function openBugModal(currentPage, allFiles, slug, chapter, imageUrls, provider) {
  createBugModal();
  bugAllFiles   = allFiles || [];
  bugImageUrls  = imageUrls || [];
  bugSlug       = slug || "";
  bugChapter    = chapter || "";
  bugProvider   = provider || ""; // ÚJ
  bugCurrentIndex = Math.max(0, (currentPage || 1) - 1);

  // Reset
  bugZoomLevel = 1;
  const desc = document.getElementById("bugDescription");
  if (desc) desc.value = "";
  const fb = document.getElementById("bugFeedback");
  if (fb) { fb.style.display = "none"; fb.textContent = ""; }

  bugUpdatePreview();

  const modal = document.getElementById("bugModal");
  modal.style.display = "flex";
  bugModalOpen = true;
}

/* ── MODAL BEZÁRÁSA ──────────────────────────────────────── */
function closeBugModal() {
  const modal = document.getElementById("bugModal");
  if (modal) modal.style.display = "none";
  bugModalOpen = false;
}

/* ── ESEMÉNYKEZELŐK ──────────────────────────────────────── */
function initBugModalEvents(modal) {
  // Bezárás
  document.getElementById("bugCloseBtn")?.addEventListener("click", closeBugModal);
  document.getElementById("bugCancelBtn")?.addEventListener("click", closeBugModal);

  // Háttérre kattintás bezár
  modal.addEventListener("click", e => {
    if (e.target === modal) closeBugModal();
  });

  // Kép navigáció
  document.getElementById("bugPrevImg")?.addEventListener("click", () => {
    if (bugCurrentIndex > 0) { bugCurrentIndex--; bugUpdatePreview(); }
  });

  document.getElementById("bugNextImg")?.addEventListener("click", () => {
    if (bugCurrentIndex < bugAllFiles.length - 1) { bugCurrentIndex++; bugUpdatePreview(); }
  });

  // Zoom
  document.getElementById("bugZoomIn")?.addEventListener("click",    () => setBugZoom(bugZoomLevel + 0.5));
  document.getElementById("bugZoomOut")?.addEventListener("click",   () => setBugZoom(bugZoomLevel - 0.5));
  document.getElementById("bugZoomReset")?.addEventListener("click", () => setBugZoom(1));

  // Kép dupla kattintás = zoom in/out
  document.getElementById("bugPreviewImg")?.addEventListener("dblclick", () => {
    setBugZoom(bugZoomLevel > 1 ? 1 : 2);
  });

  // Textarea focus - border highlight
  const ta = document.getElementById("bugDescription");
  ta?.addEventListener("focus", () => { ta.style.borderColor = "rgba(124,92,255,.6)"; });
  ta?.addEventListener("blur",  () => { ta.style.borderColor = "rgba(255,255,255,.12)"; });

  // Beküldés
  document.getElementById("bugSubmitBtn")?.addEventListener("click", submitBugReport);
}

/* ── BEKÜLDÉS ────────────────────────────────────────────── */
async function submitBugReport() {
  const desc    = document.getElementById("bugDescription")?.value?.trim();
  const submitBtn = document.getElementById("bugSubmitBtn");
  const fb      = document.getElementById("bugFeedback");

  if (!desc) {
    document.getElementById("bugDescription").style.borderColor = "#ef4444";
    setTimeout(() => {
      document.getElementById("bugDescription").style.borderColor = "rgba(255,255,255,.12)";
    }, 2000);
    return;
  }

  const f = bugAllFiles[bugCurrentIndex];
  if (!f) return;

  // ÚJ: Provider support az URL-ben
  let imageUrl;
  if (bugImageUrls && bugImageUrls[bugCurrentIndex]) {
    imageUrl = bugImageUrls[bugCurrentIndex];
  } else if (bugProvider) {
    imageUrl = `/api/image/${bugProvider}/${bugSlug}/${bugChapter}/${encodeURIComponent(f)}`;
  } else {
    imageUrl = `/api/image/${bugSlug}/${bugChapter}/${encodeURIComponent(f)}`;
  }

  submitBtn.textContent = "⏳ Küldés...";
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        image_url: imageUrl, 
        description: desc 
      })
    });

    const data = await res.json();

    if (res.ok) {
      fb.style.display = "block";
      fb.style.color   = "#22c55e";
      fb.textContent   = "✅ Hibajegy sikeresen beküldve! Köszönjük!";
      submitBtn.style.display = "none";
      setTimeout(closeBugModal, 2000);
    } else {
      fb.style.display = "block";
      fb.style.color   = "#ef4444";
      fb.textContent   = "❌ " + (data.error || "Hiba történt");
      submitBtn.textContent = "🐛 Beküldés";
      submitBtn.disabled = false;
    }
  } catch {
    fb.style.display = "block";
    fb.style.color   = "#ef4444";
    fb.textContent   = "❌ Szerverrel nem sikerült kapcsolatba lépni";
    submitBtn.textContent = "🐛 Beküldés";
    submitBtn.disabled = false;
  }
}

/* ── EXPORTÁLÁS (reader.js hívja) ────────────────────────── */
window.openBugModal  = openBugModal;
window.closeBugModal = closeBugModal;
