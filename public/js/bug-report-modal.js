/* bug-report-modal.js – Hibajegy beküldő modal a readerben */

/* ── ÁLLAPOT ─────────────────────────────────────────────── */
let bugModalOpen    = false;
let bugCurrentIndex = 0;
let bugAllFiles     = [];
let bugImageUrls    = [];
let bugSlug         = "";
let bugChapter      = "";
let bugProvider     = "";

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
          <span id="bugModalTitle" style="font-weight:700; color:#f0f0fa; font-size:1rem">Hibabejelentés</span>
        </div>
        <button id="bugCloseBtn" style="
          background:none; border:none; color:#888; font-size:1.4rem;
          cursor:pointer; padding:4px 8px; border-radius:6px;
          transition:color .15s;
        ">✕</button>
      </div>

      <!-- TAB VÁLASZTÓ -->
      <div style="display:flex; padding:12px 20px 0; gap:8px; flex-shrink:0;">
        <button id="bugTabImage" class="bug-tab-btn bug-tab-active" onclick="switchBugTab('image')">
          📄 Képhiba
        </button>
        <button id="bugTabChapter" class="bug-tab-btn" onclick="switchBugTab('chapter')">
          📕 Részszintű hiba
        </button>
      </div>

      <!-- ══ KÉP HIBA PANEL ══ -->
      <div id="bugPanelImage">
        <!-- Kép választó -->
        <div style="padding:16px 20px 0; flex-shrink:0;">
          <div style="
            font-size:.78rem; color:#666; text-transform:uppercase;
            letter-spacing:.08em; font-weight:700; margin-bottom:8px;
          ">Melyik kép a hibás?</div>

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
            <div style="position:absolute; bottom:8px; right:8px; display:flex; gap:6px;">
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
          ">Mégse</button>
          <button id="bugSubmitBtn" style="
            background:linear-gradient(135deg,#7c3aed,#5b21b6);
            border:none; color:#fff; padding:9px 22px; border-radius:9px;
            cursor:pointer; font-size:.88rem; font-weight:700;
          ">🐛 Beküldés</button>
        </div>
      </div>

      <!-- ══ RÉSZSZINTŰ HIBA PANEL ══ -->
      <div id="bugPanelChapter" style="display:none;">
        <div style="padding:20px 20px 0; flex-shrink:0;">
          <div style="
            font-size:.78rem; color:#666; text-transform:uppercase;
            letter-spacing:.08em; font-weight:700; margin-bottom:12px;
          ">Hiba típusa <span style="color:#7c3aed">*</span></div>

          <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
            <label class="bug-type-option">
              <input type="radio" name="bugChapterType" value="english_remained" id="bugTypeEng">
              <span class="bug-type-label">
                <span style="font-size:1.1rem">🇬🇧</span>
                <div>
                  <div style="font-weight:600;color:#f0f0fa;">Angol maradt</div>
                  <div style="font-size:.75rem;color:#666;margin-top:2px;">A fejezet fordítatlan vagy részben angolul maradt</div>
                </div>
              </span>
            </label>
            <label class="bug-type-option">
              <input type="radio" name="bugChapterType" value="wrong_chapter" id="bugTypeWrong">
              <span class="bug-type-label">
                <span style="font-size:1.1rem">❌</span>
                <div>
                  <div style="font-weight:600;color:#f0f0fa;">Rossz fejezet</div>
                  <div style="font-size:.75rem;color:#666;margin-top:2px;">Rossz rész töltődött fel / nem egyezik a fejezet száma</div>
                </div>
              </span>
            </label>
            <label class="bug-type-option">
              <input type="radio" name="bugChapterType" value="other" id="bugTypeOther">
              <span class="bug-type-label">
                <span style="font-size:1.1rem">💬</span>
                <div>
                  <div style="font-weight:600;color:#f0f0fa;">Egyéb</div>
                  <div style="font-size:.75rem;color:#666;margin-top:2px;">Egyéb rész szintű hiba</div>
                </div>
              </span>
            </label>
          </div>

          <!-- Egyéb leírás (csak Egyéb esetén) -->
          <div id="bugOtherDescWrap" style="display:none; margin-bottom:4px;">
            <div style="
              font-size:.78rem; color:#666; text-transform:uppercase;
              letter-spacing:.08em; font-weight:700; margin-bottom:8px;
            ">Leírás <span style="color:#7c3aed">*</span></div>
            <textarea id="bugOtherDesc" rows="3" placeholder="Írd le a hibát..." style="
              width:100%; box-sizing:border-box;
              background:#080810; border:1px solid rgba(255,255,255,.12);
              color:#e0e0f0; border-radius:10px; padding:10px 14px;
              font-family:system-ui, sans-serif; font-size:.88rem;
              resize:vertical; outline:none; min-height:60px;
              transition:border-color .18s;
            "></textarea>
          </div>
        </div>

        <!-- Küldés -->
        <div style="padding:14px 20px 18px; display:flex; justify-content:flex-end; gap:10px; flex-shrink:0;">
          <button id="bugChapterCancelBtn" style="
            background:none; border:1px solid rgba(255,255,255,.12);
            color:#888; padding:9px 20px; border-radius:9px;
            cursor:pointer; font-size:.88rem; font-weight:600;
          ">Mégse</button>
          <button id="bugChapterSubmitBtn" style="
            background:linear-gradient(135deg,#dc2626,#991b1b);
            border:none; color:#fff; padding:9px 22px; border-radius:9px;
            cursor:pointer; font-size:.88rem; font-weight:700;
          ">📕 Beküldés</button>
        </div>
      </div>

      <!-- Visszajelzés -->
      <div id="bugFeedback" style="
        display:none; padding:12px 20px; text-align:center;
        font-size:.88rem; font-weight:600;
      "></div>
    </div>
  `;

  // CSS tab stílus
  const style = document.createElement("style");
  style.textContent = `
    .bug-tab-btn {
      background: #1e1e30;
      border: 1px solid rgba(255,255,255,.1);
      color: #888;
      padding: 7px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: .82rem;
      font-weight: 600;
      transition: all .15s;
    }
    .bug-tab-btn.bug-tab-active {
      background: #2d1e5c;
      border-color: #7c3aed;
      color: #c4b5fd;
    }
    .bug-type-option {
      display: flex;
      cursor: pointer;
    }
    .bug-type-option input[type=radio] {
      display: none;
    }
    .bug-type-label {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.1);
      background: #1a1a2e;
      width: 100%;
      transition: all .15s;
    }
    .bug-type-option input[type=radio]:checked + .bug-type-label {
      border-color: #7c3aed;
      background: #2d1e5c;
    }
    .bug-type-option:hover .bug-type-label {
      border-color: rgba(124,92,255,.4);
      background: #20203a;
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(modal);
  initBugModalEvents(modal);
}

/* ── TAB VÁLTÁS ──────────────────────────────────────────── */
function switchBugTab(tab) {
  const imgPanel  = document.getElementById("bugPanelImage");
  const chapPanel = document.getElementById("bugPanelChapter");
  const tabImg    = document.getElementById("bugTabImage");
  const tabChap   = document.getElementById("bugTabChapter");
  const fb        = document.getElementById("bugFeedback");
  if (fb) { fb.style.display = "none"; }

  if (tab === "image") {
    imgPanel.style.display  = "";
    chapPanel.style.display = "none";
    tabImg.classList.add("bug-tab-active");
    tabChap.classList.remove("bug-tab-active");
  } else {
    imgPanel.style.display  = "none";
    chapPanel.style.display = "";
    tabChap.classList.add("bug-tab-active");
    tabImg.classList.remove("bug-tab-active");
  }
}
window.switchBugTab = switchBugTab;

/* ── ZOOM ────────────────────────────────────────────────── */
let bugZoomLevel = 1;

function setBugZoom(level) {
  bugZoomLevel = Math.max(1, Math.min(4, level));
  const img  = document.getElementById("bugPreviewImg");
  const wrap = document.getElementById("bugImgWrap");
  if (img && wrap) {
    img.style.transform    = bugZoomLevel > 1 ? `scale(${bugZoomLevel})` : "none";
    img.style.maxWidth     = bugZoomLevel > 1 ? "none" : "100%";
    img.style.maxHeight    = bugZoomLevel > 1 ? "none" : "100%";
    wrap.style.overflow    = bugZoomLevel > 1 ? "auto" : "hidden";
    wrap.style.cursor      = bugZoomLevel > 1 ? "grab" : "zoom-in";
    wrap.style.alignItems      = bugZoomLevel > 1 ? "flex-start" : "center";
    wrap.style.justifyContent  = bugZoomLevel > 1 ? "flex-start" : "center";
  }
}

/* ── KÉPVÁLTÁS ───────────────────────────────────────────── */
function bugUpdatePreview() {
  const img    = document.getElementById("bugPreviewImg");
  const info   = document.getElementById("bugPageInfo");
  const nameEl = document.getElementById("bugImgName");
  if (!img || !bugAllFiles.length) return;

  const f = bugAllFiles[bugCurrentIndex];
  if (bugImageUrls?.[bugCurrentIndex]) {
    img.src = bugImageUrls[bugCurrentIndex];
  } else if (bugProvider) {
    img.src = `/api/image/${bugProvider}/${bugSlug}/${bugChapter}/${encodeURIComponent(f)}`;
  } else {
    img.src = `/api/image/${bugSlug}/${bugChapter}/${encodeURIComponent(f)}`;
  }

  info.textContent  = `${bugCurrentIndex + 1} / ${bugAllFiles.length}`;
  nameEl.textContent = decodeURIComponent(f);
  setBugZoom(1);
}

/* ── MODAL MEGNYITÁSA ────────────────────────────────────── */
function openBugModal(currentPage, allFiles, slug, chapter, imageUrls, provider) {
  createBugModal();
  bugAllFiles     = allFiles || [];
  bugImageUrls    = imageUrls || [];
  bugSlug         = slug    || "";
  bugChapter      = chapter || "";
  bugProvider     = provider || "";
  bugCurrentIndex = Math.max(0, (currentPage || 1) - 1);

  // Reset közös
  bugZoomLevel = 1;
  const fb = document.getElementById("bugFeedback");
  if (fb) { fb.style.display = "none"; fb.textContent = ""; }

  // Reset kép tab
  const desc = document.getElementById("bugDescription");
  if (desc) desc.value = "";
  const submitBtn = document.getElementById("bugSubmitBtn");
  if (submitBtn) { submitBtn.style.display = ""; submitBtn.disabled = false; submitBtn.textContent = "🐛 Beküldés"; }

  // Reset fejezet tab
  document.querySelectorAll("input[name=bugChapterType]").forEach(r => r.checked = false);
  const otherDesc = document.getElementById("bugOtherDesc");
  if (otherDesc) otherDesc.value = "";
  const otherWrap = document.getElementById("bugOtherDescWrap");
  if (otherWrap) otherWrap.style.display = "none";
  const chSubmit = document.getElementById("bugChapterSubmitBtn");
  if (chSubmit) { chSubmit.style.display = ""; chSubmit.disabled = false; chSubmit.textContent = "📕 Beküldés"; }

  // Mindig képhiba tab-on nyílik
  switchBugTab("image");

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
  document.getElementById("bugCloseBtn")?.addEventListener("click", closeBugModal);
  document.getElementById("bugCancelBtn")?.addEventListener("click", closeBugModal);
  document.getElementById("bugChapterCancelBtn")?.addEventListener("click", closeBugModal);

  document.getElementById("bugModalBox")?.addEventListener("click", e => e.stopPropagation());
  modal.addEventListener("click", e => { if (e.target === modal) closeBugModal(); });

  document.getElementById("bugPrevImg")?.addEventListener("click", () => {
    if (bugCurrentIndex > 0) { bugCurrentIndex--; bugUpdatePreview(); }
  });
  document.getElementById("bugNextImg")?.addEventListener("click", () => {
    if (bugCurrentIndex < bugAllFiles.length - 1) { bugCurrentIndex++; bugUpdatePreview(); }
  });

  document.getElementById("bugZoomIn")?.addEventListener("click",    () => setBugZoom(bugZoomLevel + 0.5));
  document.getElementById("bugZoomOut")?.addEventListener("click",   () => setBugZoom(bugZoomLevel - 0.5));
  document.getElementById("bugZoomReset")?.addEventListener("click", () => setBugZoom(1));
  document.getElementById("bugPreviewImg")?.addEventListener("dblclick", () => {
    setBugZoom(bugZoomLevel > 1 ? 1 : 2);
  });

  const ta = document.getElementById("bugDescription");
  ta?.addEventListener("focus", () => { ta.style.borderColor = "rgba(124,92,255,.6)"; });
  ta?.addEventListener("blur",  () => { ta.style.borderColor = "rgba(255,255,255,.12)"; });

  // Egyéb típus kiválasztásakor megjelenik a szöveges mező
  document.querySelectorAll("input[name=bugChapterType]").forEach(radio => {
    radio.addEventListener("change", () => {
      const wrap = document.getElementById("bugOtherDescWrap");
      if (wrap) wrap.style.display = radio.value === "other" && radio.checked ? "" : "none";
      // Ha másra váltottunk, elrejtjük
      if (radio.value !== "other") {
        const wrap2 = document.getElementById("bugOtherDescWrap");
        if (wrap2) wrap2.style.display = "none";
      }
    });
  });
  document.getElementById("bugTypeOther")?.addEventListener("change", () => {
    const wrap = document.getElementById("bugOtherDescWrap");
    if (wrap) wrap.style.display = "";
  });

  document.getElementById("bugSubmitBtn")?.addEventListener("click", submitBugReport);
  document.getElementById("bugChapterSubmitBtn")?.addEventListener("click", submitChapterBugReport);
}

/* ── KÉPHIBA BEKÜLDÉS ────────────────────────────────────── */
async function submitBugReport() {
  const desc      = document.getElementById("bugDescription")?.value?.trim();
  const submitBtn = document.getElementById("bugSubmitBtn");
  const fb        = document.getElementById("bugFeedback");

  if (!desc) {
    document.getElementById("bugDescription").style.borderColor = "#ef4444";
    setTimeout(() => {
      document.getElementById("bugDescription").style.borderColor = "rgba(255,255,255,.12)";
    }, 2000);
    return;
  }

  const f = bugAllFiles[bugCurrentIndex];
  if (!f) return;

  function buildUrl(idx) {
    const file = bugAllFiles[idx];
    if (bugImageUrls?.[idx]) return bugImageUrls[idx];
    if (bugProvider) return `/api/image/${bugProvider}/${bugSlug}/${bugChapter}/${encodeURIComponent(file)}`;
    return `/api/image/${bugSlug}/${bugChapter}/${encodeURIComponent(file)}`;
  }

  submitBtn.textContent = "⏳ Küldés...";
  submitBtn.disabled    = true;

  try {
    const res = await fetch("/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: buildUrl(bugCurrentIndex), description: desc })
    });
    const data = await res.json();
    fb.style.display = "block";
    if (res.ok) {
      fb.style.color   = "#22c55e";
      fb.textContent   = "✅ Hibajegy sikeresen beküldve! Köszönjük!";
      submitBtn.style.display = "none";
      setTimeout(closeBugModal, 2000);
    } else {
      fb.style.color        = "#ef4444";
      fb.textContent        = "❌ " + (data.error || "Hiba történt");
      submitBtn.textContent = "🐛 Beküldés";
      submitBtn.disabled    = false;
    }
  } catch {
    fb.style.display  = "block";
    fb.style.color    = "#ef4444";
    fb.textContent    = "❌ Szerverrel nem sikerült kapcsolatba lépni";
    submitBtn.textContent = "🐛 Beküldés";
    submitBtn.disabled    = false;
  }
}

/* ── RÉSZSZINTŰ HIBA BEKÜLDÉS ────────────────────────────── */
async function submitChapterBugReport() {
  const typeRadio = document.querySelector("input[name=bugChapterType]:checked");
  const submitBtn = document.getElementById("bugChapterSubmitBtn");
  const fb        = document.getElementById("bugFeedback");

  if (!typeRadio) {
    // Villog, hogy ki kell választani
    document.querySelectorAll(".bug-type-label").forEach(el => {
      el.style.borderColor = "#ef4444";
      setTimeout(() => { el.style.borderColor = "rgba(255,255,255,.1)"; }, 1500);
    });
    return;
  }

  const type = typeRadio.value;
  let description = "";
  if (type === "other") {
    description = document.getElementById("bugOtherDesc")?.value?.trim();
    if (!description) {
      const ta = document.getElementById("bugOtherDesc");
      if (ta) { ta.style.borderColor = "#ef4444"; setTimeout(() => { ta.style.borderColor = "rgba(255,255,255,.12)"; }, 1500); }
      return;
    }
  }

  submitBtn.textContent = "⏳ Küldés...";
  submitBtn.disabled    = true;

  try {
    const res = await fetch("/api/chapter-bugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ manga_slug: bugSlug, chapter: bugChapter, provider: bugProvider, type, description: description || null })
    });
    const data = await res.json();
    fb.style.display = "block";
    if (res.ok) {
      fb.style.color   = "#22c55e";
      fb.textContent   = "✅ Rész szintű hibajegy beküldve! Köszönjük!";
      submitBtn.style.display = "none";
      setTimeout(closeBugModal, 2000);
    } else {
      fb.style.color        = "#ef4444";
      fb.textContent        = "❌ " + (data.error || "Hiba történt");
      submitBtn.textContent = "📕 Beküldés";
      submitBtn.disabled    = false;
    }
  } catch {
    fb.style.display  = "block";
    fb.style.color    = "#ef4444";
    fb.textContent    = "❌ Szerverrel nem sikerült kapcsolatba lépni";
    submitBtn.textContent = "📕 Beküldés";
    submitBtn.disabled    = false;
  }
}

/* ── EXPORTÁLÁS ──────────────────────────────────────────── */
window.openBugModal  = openBugModal;
window.closeBugModal = closeBugModal;
