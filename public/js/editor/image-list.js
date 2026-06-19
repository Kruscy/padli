/* ============================================================
   editor-image-list.js
   ============================================================ */

let currentUserId = null;
let userFixes = {};      // imageIndex → { url, id }
let imageDirty = false;  // van-e nem mentett módosítás

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
window.addEventListener("DOMContentLoaded", async () => {
  // Bejelentkezett user lekérése
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) { const u = await r.json(); currentUserId = u.id; }
  } catch (_) {}

  const panel = document.getElementById("image-list-panel");
  const toggle = panel?.querySelector(".panel-toggle");
  if (panel) {
    panel.classList.remove("collapsed");
    if (toggle) toggle.textContent = "◀";
  }

  if (BUG_SLUG && BUG_CHAPTER) {
    await loadImageList();
  }

  // Dirty tracking: bármi változik → dirty = true
  const mc = document.getElementById("mask-canvas");
  const oc2 = document.getElementById("overlay-canvas");
  if (mc) mc.addEventListener("mouseup", markDirty);
  if (mc) mc.addEventListener("touchend", markDirty);
});

function markDirty() { imageDirty = true; }

/* ══════════════════════════════════════════════════════════
   IMAGE LIST BETÖLTÉS
   ══════════════════════════════════════════════════════════ */
async function loadImageList() {
  if (!BUG_SLUG || !BUG_CHAPTER) return;
  try {
    const res = await fetch(`/api/pages/${BUG_SLUG}/${BUG_CHAPTER}`);
    if (!res.ok) throw new Error("Képlista nem tölthető be");
    const data = await res.json();
    allImages = data.pages || [];
    let parsedIndex = parseInt(BUG_INDEX);
    if (isNaN(parsedIndex) && BUG_URL) {
      // BUG_INDEX="null" esetén a fájlnév alapján keressük meg az indexet
      const urlFilename = decodeURIComponent(BUG_URL.split("/").pop().split("?")[0]);
      parsedIndex = allImages.findIndex(img => img === urlFilename);
    }
    currentImageIndex = isNaN(parsedIndex) || parsedIndex < 0 ? 0 : parsedIndex;
    await loadBugReportsStatus();
    renderImageList();
    checkCurrentImageBugReport();
  } catch (err) {
    console.error("Image list load error:", err);
  }
}

/* ══════════════════════════════════════════════════════════
   BUG REPORTS + SAJÁT JAVÍTÁSOK STATUS
   ══════════════════════════════════════════════════════════ */
async function loadBugReportsStatus() {
  if (!BUG_SLUG || !BUG_CHAPTER) return;
  try {
    const res = await fetch(`/api/bug-reports?manga_slug=${encodeURIComponent(BUG_SLUG)}&chapter=${encodeURIComponent(BUG_CHAPTER)}&closed=false`);
    if (!res.ok) return;
    const reports = await res.json();

    imageHasBugReport = {};
    userFixes = {};

    reports.forEach(report => {
      let idx = report.image_index;
      // Ha a DB-ben null az index, próbáljuk megtalálni a fájlnév alapján
      if ((idx === null || idx === undefined) && report.image_file && allImages.length) {
        idx = allImages.findIndex(img => img === report.image_file);
        if (idx < 0) idx = null;
      }
      if (idx === null || idx === undefined || idx < 0) return;
      imageHasBugReport[idx] = true;

      // Saját korábbi javítás keresése
      if (currentUserId && Array.isArray(report.fixes)) {
        const myFix = report.fixes.find(f => f.fixed_by === currentUserId);
        if (myFix) {
          userFixes[idx] = { url: myFix.fixed_image_url, id: myFix.id };
        }
      }
    });
  } catch (err) {
    console.error("Bug reports status load error:", err);
  }
}

/* ══════════════════════════════════════════════════════════
   IMAGE LIST RENDERELÉSE (csak szöveg, nincs thumbnail)
   ══════════════════════════════════════════════════════════ */
function renderImageList() {
  const container = document.getElementById("imageListScroll");
  if (!container) return;
  container.innerHTML = "";

  allImages.forEach((imageFile, index) => {
    const hasBug = !!imageHasBugReport[index];
    const isCurrent = index === currentImageIndex;
    const hasMyFix = !!userFixes[index];

    const item = document.createElement("div");
    item.className = "image-list-item" +
      (isCurrent ? " current" : "") +
      (hasBug ? " has-bug-report" : " no-bug") +
      (hasMyFix ? " has-my-fix" : "");

    // Fájlnév megjelenítés — lerövidítve
    const shortName = imageFile.length > 22 ? imageFile.slice(0, 20) + "…" : imageFile;

    let statusIcon = "";
    if (!hasBug) statusIcon = `<span class="img-item-status grey">— nincs jegy</span>`;
    else if (hasMyFix) statusIcon = `<span class="img-item-status green">✔ javítottam</span>`;
    else statusIcon = `<span class="img-item-status red">⚠ jegy van</span>`;

    item.innerHTML = `
      <div class="img-item-num">#${index}</div>
      <div class="img-item-name" title="${imageFile}">${shortName}</div>
      ${statusIcon}
    `;

    item.addEventListener("click", () => switchToImage(index));
    container.appendChild(item);
  });

  updateNavButtons();

  // Aktuális elem láthatóvá görgetése
  const currentEl = container.querySelector(".current");
  if (currentEl) currentEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* ══════════════════════════════════════════════════════════
   NAVIGÁCIÓ
   ══════════════════════════════════════════════════════════ */
function updateNavButtons() {
  const prevBtn = document.getElementById("prevImageBtn");
  const nextBtn = document.getElementById("nextImageBtn");
  if (prevBtn) prevBtn.disabled = currentImageIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentImageIndex >= allImages.length - 1;
}

function navigateImage(direction) {
  const newIndex = currentImageIndex + direction;
  if (newIndex < 0 || newIndex >= allImages.length) return;
  switchToImage(newIndex);
}

/* ══════════════════════════════════════════════════════════
   KÉP VÁLTÁS — automatikus mentés + saját javítás betöltése
   ══════════════════════════════════════════════════════════ */
async function switchToImage(newIndex) {
  if (newIndex < 0 || newIndex >= allImages.length) return;
  if (newIndex === currentImageIndex) return;

  // Ha van unsaved work és az aktuális képnek van bug reportja → auto-mentés
  if (imageDirty && imageHasBugReport[currentImageIndex]) {
    setStatus("⏳ Javítás automatikus mentése...", "info");
    await autoSaveCurrentImage();
    // Frissítjük a userFixes-t az aktuális indexre
    userFixes[currentImageIndex] = userFixes[currentImageIndex] || { url: null };
  }

  imageDirty = false;
  currentImageIndex = newIndex;
  const imageFile = allImages[newIndex];
  const originalUrl = `/api/image/${BUG_PROVIDER}/${BUG_SLUG}/${BUG_CHAPTER}/${encodeURIComponent(imageFile)}`;

  // URL frissítése
  const newUrl = new URL(location.href);
  newUrl.searchParams.set("image_index", newIndex);
  newUrl.searchParams.set("image_url", originalUrl);
  history.replaceState({}, "", newUrl);

  // Ha volt saját korábbi javítás → azt töltjük be
  if (userFixes[newIndex]?.url) {
    setStatus("📂 Korábbi javításod betöltése...", "info");
    await loadImageFromUrl(userFixes[newIndex].url);
  } else {
    await loadImageFromUrl(originalUrl);
  }

  renderImageList();
  checkCurrentImageBugReport();
}

/* ══════════════════════════════════════════════════════════
   AUTO-MENTÉS (képváltáskor, csendben)
   ══════════════════════════════════════════════════════════ */
async function autoSaveCurrentImage() {
  if (!imgEl) return;

  try {
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = imgEl.width;
    finalCanvas.height = imgEl.height;
    const ctx = finalCanvas.getContext("2d");

    ctx.drawImage(origCanvas, 0, 0);
    if (editCanvas) ctx.drawImage(editCanvas, 0, 0);

    // Szövegdobozok ráégetése
    if (textBoxes && textBoxes.length > 0) {
      textBoxes.forEach(tb => {
        ctx.fillStyle = tb.color;
        ctx.font = `${tb.fontStyle} ${tb.fontSize}px "${tb.fontFamily}"`;
        ctx.textAlign = tb.align;
        ctx.textBaseline = "middle";
        if (tb.strokeWidth > 0) { ctx.strokeStyle = tb.strokeColor; ctx.lineWidth = tb.strokeWidth; }
        const lines = wrapLines(ctx, tb.text, tb.w - 10);
        const lineH = tb.fontSize * 1.2;
        const totalH = lines.length * lineH;
        const startY = tb.y + (tb.h - totalH) / 2 + lineH / 2;
        lines.forEach((line, i) => {
          const tx = tb.align === "center" ? tb.x + tb.w/2 : tb.align === "right" ? tb.x + tb.w - 5 : tb.x + 5;
          if (tb.strokeWidth > 0) ctx.strokeText(line, tx, startY + i * lineH);
          ctx.fillText(line, tx, startY + i * lineH);
        });
      });
    }

    await new Promise((resolve, reject) => {
      finalCanvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error("Blob létrehozás sikertelen")); return; }
        const formData = new FormData();
        formData.append("image", blob, `fixed_${currentImageIndex}.jpg`);
        formData.append("manga_slug", BUG_SLUG);
        formData.append("chapter", BUG_CHAPTER);
        formData.append("image_index", currentImageIndex);
        formData.append("provider", BUG_PROVIDER || "");
        const r = await fetch("/api/bug-reports/fix/upload", { method: "POST", credentials: "include", body: formData });
        if (r.ok) {
          const data = await r.json();
          userFixes[currentImageIndex] = { url: data.url, id: data.fix?.id };
          setStatus("✅ Automatikusan mentve", "ok");
        }
        resolve();
      }, "image/jpeg", 0.95);
    });
  } catch (err) {
    console.error("Auto-save error:", err);
    setStatus("⚠ Auto-mentés sikertelen", "err");
  }
}

/* ══════════════════════════════════════════════════════════
   BUG REPORT ELLENŐRZÉS
   ══════════════════════════════════════════════════════════ */
function checkCurrentImageBugReport() {
  const hasBugReport = imageHasBugReport[currentImageIndex];
  const banner = document.getElementById("fix-request-banner");

  if (hasBugReport) {
    isEditingBlocked = false;
    if (banner) banner.classList.remove("show");
    enableEditing();
  } else {
    isEditingBlocked = true;
    if (banner) banner.classList.add("show");
    disableEditing();
  }
}

function enableEditing() {
  document.querySelectorAll("#topbar .btn").forEach(btn => {
    if (!btn.id.includes("nav") && !btn.id.includes("zoom")) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });
}

function disableEditing() {
  document.querySelectorAll("#topbar .btn").forEach(btn => {
    if (!btn.id.includes("zoom") && !btn.id.includes("pan") &&
        btn.textContent.trim() !== "← Vissza" && btn.textContent.trim() !== "Illeszkedj") {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    }
  });
  if (mode !== "pan") setMode("pan");
}

/* ══════════════════════════════════════════════════════════
   BUG REPORT LÉTREHOZÁS (ha nincs jegy)
   ══════════════════════════════════════════════════════════ */
async function reportCurrentImage() {
  if (currentImageIndex < 0) return;
  const imageFile = allImages[currentImageIndex];
  const imageUrl = `/api/image/${BUG_PROVIDER}/${BUG_SLUG}/${BUG_CHAPTER}/${encodeURIComponent(imageFile)}`;

  try {
    showProgress(true, "Hibajegy létrehozása...");
    const res = await fetch("/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, description: "Ezt is javítani kell", image_index: currentImageIndex })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Hiba"); }
    imageHasBugReport[currentImageIndex] = true;
    renderImageList();
    checkCurrentImageBugReport();
    setStatus("✅ Hibajegy létrehozva!", "ok");
    showProgress(false);
  } catch (err) {
    showProgress(false);
    setStatus("❌ " + err.message, "err");
    alert("Hiba: " + err.message);
  }
}

/* ══════════════════════════════════════════════════════════
   PANEL TOGGLE
   ══════════════════════════════════════════════════════════ */
function toggleImageListPanel() {
  const panel = document.getElementById("image-list-panel");
  const toggle = panel?.querySelector(".panel-toggle");
  if (panel?.classList.contains("collapsed")) {
    panel.classList.remove("collapsed");
    if (toggle) toggle.textContent = "◀";
  } else {
    panel?.classList.add("collapsed");
    if (toggle) toggle.textContent = "▶";
  }
}
