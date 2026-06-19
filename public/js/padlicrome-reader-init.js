/* ── KONFIG ──────────────────────────────────────────────── */
const API = "/api/padlicrome";
let pages = [];
let currentPage = 0;
let mode = localStorage.getItem("readerMode") || "scroll";

/* ── BETÖLTÉS ────────────────────────────────────────────── */
async function loadPages() {
  try {
    const resp = await fetch(`${API}/project`, { credentials: "include" });
    if (!resp.ok) { showError("Nem sikerült betölteni a projektet."); return; }
    const project = await resp.json();
    if (!project) { showError("Nincs aktív projekt."); return; }

    // Csak fordított és aktív képek, sorrendben
    pages = (project.images || [])
      .filter(img => img.translated && img.active !== false)
      .map(img => ({
        src: `${API}/image/translated/${img.filename}`,
        name: img.name || img.filename,
      }));

    if (!pages.length) {
      showError("Nincs lefordított kép a projektben.");
      return;
    }

    document.getElementById("chapterNum").textContent = `${pages.length} oldal`;
    document.title = `Fordított fejezet - ${pages.length} oldal`;

    renderPages();
    setMode(mode);
    showUI();
  } catch (err) {
    showError("Hiba: " + err.message);
  }
}

/* ── RENDER ──────────────────────────────────────────────── */
function renderPages() {
  const container = document.getElementById("pages");
  container.innerHTML = "";

  if (mode === "scroll") {
    pages.forEach((p, i) => {
      const img = document.createElement("img");
      img.src = p.src;
      img.alt = `${i + 1}. oldal`;
      img.loading = i < 3 ? "eager" : "lazy";
      container.appendChild(img);
    });
  } else {
    // Könyv mód
    pages.forEach((p, i) => {
      const div = document.createElement("div");
      div.className = "book-page" + (i === currentPage ? " visible" : "");
      div.dataset.idx = i;
      const img = document.createElement("img");
      img.src = p.src;
      img.alt = `${i + 1}. oldal`;
      div.appendChild(img);
      container.appendChild(div);
    });
    updateBookNav();
  }
}

/* ── MÓD ─────────────────────────────────────────────────── */
function setMode(m) {
  mode = m;
  localStorage.setItem("readerMode", m);
  document.body.classList.toggle("mode-book", m === "book");
  document.getElementById("pages").className = `mode-${m}`;

  document.querySelectorAll(".btn-mode").forEach(btn => {
    const isActive = btn.dataset.mode === m;
    btn.style.display = isActive ? "none" : "";
  });

  renderPages();
}

function cycleMode() {
  setMode(mode === "scroll" ? "book" : "scroll");
}

/* ── KÖNYV MÓD NAV ───────────────────────────────────────── */
function bookPrev() {
  if (currentPage > 0) { currentPage--; updateBookNav(); }
}
function bookNext() {
  if (currentPage < pages.length - 1) { currentPage++; updateBookNav(); }
  else if (currentPage >= pages.length - 1) {
    window.location.href = "/padlicrome.html";
  }
}

function updateBookNav() {
  document.querySelectorAll(".book-page").forEach((p, i) => {
    p.classList.toggle("visible", i === currentPage);
  });
  document.getElementById("chapterNum").textContent = `${currentPage + 1} / ${pages.length}`;
}

/* ── PREV/NEXT GOMBOK ────────────────────────────────────── */
document.getElementById("prevBtn").onclick = () => {
  if (mode === "book") { bookPrev(); return; }
  window.scrollTo({ top: 0, behavior: "smooth" });
};

document.getElementById("nextBtn").onclick = () => {
  if (mode === "book") { bookNext(); return; }
  window.location.href = "/padlicrome.html";
};

document.getElementById("bookPrev").addEventListener("click", bookPrev);
document.getElementById("bookNext").addEventListener("click", bookNext);

/* ── TELJES KÉPERNYŐ ─────────────────────────────────────── */
function toggleFullscreen() {
  document.body.classList.toggle("fullscreen");
}

/* ── UI MEGJELENÍTÉS ─────────────────────────────────────── */
function showUI() {
  document.querySelector(".topbar").style.opacity = "1";
  document.querySelector(".topbar").style.pointerEvents = "auto";
  document.querySelector(".bottombar").style.opacity = "1";
  document.querySelector(".bottombar").style.pointerEvents = "auto";
}

let uiTimeout;
document.addEventListener("mousemove", () => {
  showUI();
  clearTimeout(uiTimeout);
  uiTimeout = setTimeout(() => {
    if (!document.body.classList.contains("fullscreen")) return;
    document.querySelector(".topbar").style.opacity = "0";
    document.querySelector(".topbar").style.pointerEvents = "none";
    document.querySelector(".bottombar").style.opacity = "0";
    document.querySelector(".bottombar").style.pointerEvents = "none";
  }, 3000);
});

function showError(msg) {
  document.getElementById("pages").innerHTML = `
    <div style="text-align:center;padding:80px 20px;color:#aaa">
      <div style="font-size:3rem;margin-bottom:16px">😕</div>
      <p>${msg}</p>
      <a href="/padlicrome.html" style="color:#7c3aed;text-decoration:none;margin-top:16px;display:inline-block">← Vissza a fordítóhoz</a>
    </div>`;
  showUI();
}

/* ── KEYBOARD ────────────────────────────────────────────── */
document.addEventListener("keydown", e => {
  if (mode === "book") {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") bookPrev();
    if (e.key === "ArrowRight" || e.key === "ArrowDown") bookNext();
  }
  if (e.key === "f" || e.key === "F") toggleFullscreen();
});

// Init
loadPages();
