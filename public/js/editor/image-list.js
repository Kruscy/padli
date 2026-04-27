/* ============================================================
   editor-image-list.js - Képlista, navigáció, bug reports
   JAVÍTOTT - Eredeti működő logika alapján
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   IMAGE LIST LOADING
   ══════════════════════════════════════════════════════════ */

async function loadImageList() {
  if (!BUG_SLUG || !BUG_CHAPTER) return;
  
  try {
    // JAVÍTOTT: /api/pages/ endpoint (nem /api/chapters/)
    const res = await fetch(`/api/pages/${BUG_SLUG}/${BUG_CHAPTER}`);
    if (!res.ok) throw new Error("Képlista nem tölthető be");
    
    const data = await res.json();
    allImages = data.pages || []; // JAVÍTOTT: data.pages
    
    // Aktuális kép indexének megkeresése
    if (BUG_INDEX !== null) {
      currentImageIndex = parseInt(BUG_INDEX);
    }
    
    // Bug reportok lekérése
    await loadBugReportsStatus();
    
    // Képlista renderelése
    renderImageList();
    
    // Aktuális kép ellenőrzése
    checkCurrentImageBugReport();
    
  } catch (err) {
    console.error("Image list load error:", err);
  }
}

/* ══════════════════════════════════════════════════════════
   BUG REPORTS STATUS
   ══════════════════════════════════════════════════════════ */

async function loadBugReportsStatus() {
  if (!BUG_SLUG || !BUG_CHAPTER) return;
  
  try {
    // JAVÍTOTT: API query formátum
    const res = await fetch(`/api/bug-reports?manga_slug=${encodeURIComponent(BUG_SLUG)}&chapter=${encodeURIComponent(BUG_CHAPTER)}&closed=false`);
    if (!res.ok) return;
    
    const reports = await res.json();
    
    // Indexeljük melyik képnek van bug reportja
    imageHasBugReport = {};
    reports.forEach(report => {
      if (report.image_index !== null && report.image_index !== undefined) {
        imageHasBugReport[report.image_index] = true;
      }
    });
    
  } catch (err) {
    console.error("Bug reports status load error:", err);
  }
}

/* ══════════════════════════════════════════════════════════
   IMAGE LIST RENDERING
   ══════════════════════════════════════════════════════════ */

function renderImageList() {
  const container = document.getElementById("imageListScroll");
  if (!container) return;
  
  container.innerHTML = "";
  
  allImages.forEach((imageFile, index) => {
    const item = document.createElement("div");
    item.className = "image-list-item";
    
    if (index === currentImageIndex) {
      item.classList.add("current");
    }
    
    if (imageHasBugReport[index]) {
      item.classList.add("has-bug-report");
    }
    
    // JAVÍTOTT: Thumbnail URL képzés
    const thumbUrl = `/api/image/${BUG_PROVIDER}/${BUG_SLUG}/${BUG_CHAPTER}/${encodeURIComponent(imageFile)}`;
    
    item.innerHTML = `
      <img class="image-thumb-mini" src="${thumbUrl}" alt="${index}" loading="lazy">
      <div class="image-list-info">
        <div class="image-list-name">#${index}</div>
        <div class="image-list-status ${imageHasBugReport[index] ? 'reported' : ''}">
          ${imageHasBugReport[index] ? '✓ Bejelentve' : 'Nincs jegy'}
        </div>
      </div>
    `;
    
    item.addEventListener("click", () => {
      switchToImage(index);
    });
    
    container.appendChild(item);
  });
  
  // Navigációs gombok állapota
  updateNavButtons();
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
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

async function switchToImage(newIndex) {
  if (newIndex < 0 || newIndex >= allImages.length) return;
  
  currentImageIndex = newIndex;
  const imageFile = allImages[newIndex];
  // JAVÍTOTT: URL képzés fájlnévből
  const imageUrl = `/api/image/${BUG_PROVIDER}/${BUG_SLUG}/${BUG_CHAPTER}/${encodeURIComponent(imageFile)}`;
  
  // URL frissítése (history.replaceState használata)
  const newUrl = new URL(location.href);
  newUrl.searchParams.set("image_index", newIndex);
  newUrl.searchParams.set("image_url", imageUrl);
  history.replaceState({}, "", newUrl);
  
  // Kép betöltése
  await loadImageFromUrl(imageUrl);
  
  // UI frissítés
  renderImageList();
  checkCurrentImageBugReport();
}

function toggleImageListPanel() {
  const panel = document.getElementById("image-list-panel");
  const toggle = panel?.querySelector(".panel-toggle");
  
  if (panel?.classList.contains("collapsed")) {
    panel.classList.remove("collapsed");
    if (toggle) toggle.textContent = "▶";
  } else {
    panel?.classList.add("collapsed");
    if (toggle) toggle.textContent = "◀";
  }
}

/* ══════════════════════════════════════════════════════════
   BUG REPORT CHECK & EDITING
   ══════════════════════════════════════════════════════════ */

function checkCurrentImageBugReport() {
  const hasBugReport = imageHasBugReport[currentImageIndex];
  const banner = document.getElementById("fix-request-banner");
  
  if (hasBugReport) {
    // Van bug report - szerkesztés engedélyezve
    isEditingBlocked = false;
    if (banner) banner.classList.remove("show");
    enableEditing();
  } else {
    // Nincs bug report - szerkesztés blokkolva
    isEditingBlocked = true;
    if (banner) banner.classList.add("show");
    disableEditing();
  }
}

function enableEditing() {
  // Gombok aktiválása
  document.querySelectorAll("#topbar .btn").forEach(btn => {
    if (!btn.id.includes("nav") && !btn.id.includes("zoom")) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });
}

function disableEditing() {
  // Csak zoom/pan és vissza gombok maradjanak aktívak
  document.querySelectorAll("#topbar .btn").forEach(btn => {
    if (!btn.id.includes("zoom") && !btn.id.includes("pan") && 
        btn.textContent !== "← Vissza" && btn.textContent !== "Illeszkedj") {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    }
  });
  
  // Maszk és szöveg módokat is tiltjuk
  if (mode !== "pan") {
    setMode("pan");
  }
}

/* ══════════════════════════════════════════════════════════
   BUG REPORT CREATION
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
      body: JSON.stringify({
        image_url: imageUrl,
        description: "Ezt is javítani kell"
      })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Hibajegy létrehozása sikertelen");
    }
    
    // Sikeres létrehozás
    imageHasBugReport[currentImageIndex] = true;
    renderImageList();
    checkCurrentImageBugReport();
    
    setStatus("✅ Hibajegy létrehozva!", "ok");
    showProgress(false);
    
  } catch (err) {
    showProgress(false);
    setStatus("❌ " + err.message, "err");
    alert("Hiba a hibajegy létrehozásakor: " + err.message);
  }
}

/* ══════════════════════════════════════════════════════════
   INITIALIZATION
   ══════════════════════════════════════════════════════════ */

window.addEventListener("DOMContentLoaded", () => {
  // ✅ Alapértelmezett állapot: BEZÁRVA
  const panel = document.getElementById("image-list-panel");
  const toggle = panel?.querySelector(".panel-toggle");
  
  if (panel) {
    panel.classList.add("collapsed");
    if (toggle) toggle.textContent = "▶";
  }
  
  // Képlista betöltése
  if (BUG_SLUG && BUG_CHAPTER) {
    loadImageList();
  }
});
