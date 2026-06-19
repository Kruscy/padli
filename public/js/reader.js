/* ============================================================
   reader.js - PadlizsanFanSub olvasó
   ============================================================ */

history.scrollRestoration = "manual";

const params   = new URLSearchParams(location.search);
const slug     = params.get("slug");
let chapter    = params.get("chapter");
let startPage  = parseInt(params.get("page") || "0", 10);

const pagesEl  = document.getElementById("pages");
const isMobile = window.innerWidth <= 768;

/* ── OLVASÁSI MÓD ────────────────────────────────────────── */
// Preferencia mentés: userenként, platformonként
const PREF_KEY = `reader_mode_${isMobile ? "mobile" : "desktop"}`;

const MODES = ["scroll", "book"];
let readMode = localStorage.getItem(PREF_KEY) || (isMobile ? "scroll" : "scroll");
let bookPageIndex = 0; // melyik oldalpárnál tartunk könyv módban

function setMode(mode) {
  readMode = mode;
  localStorage.setItem(PREF_KEY, mode);
  document.body.classList.toggle("mode-book", mode === "book");
  pagesEl.className = "mode-" + mode;

  if (mode === "book") {
    renderBookView();
  }

  // Gomb aktív állapot
  document.querySelectorAll(".btn-mode").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
}

/* ── PROGRESS ────────────────────────────────────────────── */
let lastSavedPage = 0;
let lastSent      = 0;
let saveTimeout   = null;
let allFiles      = []; // betöltött fájlnévlista
let currentLibrary = ""; // library neve az image URL-hez
let fixVersions   = {}; // { filename: unix_timestamp } — javított képek cache-bust
let chapters      = [];

function getCurrentPage() {
  if (readMode === "book") return bookPageIndex + 1;

  const imgs = [...document.querySelectorAll("#pages img")];
  let current = 1;
  const mid = window.innerHeight / 2;

  imgs.forEach((img, i) => {
    if (img.getBoundingClientRect().top < mid) current = i + 1;
  });

  return current;
}

async function saveProgress(page) {
  if (!page || page === lastSavedPage) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, chapter, page })
      });
      await fetch("/api/anilist/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, chapter })
      });
      lastSavedPage = page;
    } catch {}
  }, 600);
}

window.addEventListener("scroll", () => {
  const now = Date.now();
  if (now - lastSent > 2000) {
    saveProgress(getCurrentPage());
    lastSent = now;
  }
});

/* ── PROGRESS BETÖLTÉS ───────────────────────────────────── */
async function loadProgress() {
  if (!slug) return;
  try {
    // Ha chapter már meg van adva az URL-ben, azt töltjük be
    // Ha nincs chapter, az API adja vissza az utolsót
    const url = chapter
      ? `/api/progress?slug=${slug}&chapter=${encodeURIComponent(chapter)}`
      : `/api/progress?slug=${slug}`;

    const res  = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    if (!data || !data.chapter) return;

    if (!chapter) {
      // Nincs chapter az URL-ben → mentsük el és töltjük be
      chapter   = data.chapter;
      startPage = data.page || 0;
    } else if (chapter === data.chapter) {
      // Ugyanaz a fejezet → folytatjuk ahol abbahagytuk
      startPage = data.page || 0;
    }
    // Ha más fejezet → az URL-ben lévőt töltjük be (szándékos navigálás)
  } catch (err) {
    console.error("PROGRESS LOAD ERROR:", err);
  }
}

/* ── LAKAT OLDAL ─────────────────────────────────────────── */
async function showLockPage(targetSlug) {
  let patreonConnected = false;
  try {
    const ps = await fetch("/api/patreon/status", { credentials: "include" });
    if (ps.ok) { const d = await ps.json(); patreonConnected = !!d.connected; }
  } catch {}

  // paywall.js module-ként töltődik — várunk rá max 2s
  if (!window._buildPaywallHTML) {
    await new Promise(r => {
      const t = setInterval(() => { if (window._buildPaywallHTML) { clearInterval(t); r(); } }, 50);
      setTimeout(() => { clearInterval(t); r(); }, 2000);
    });
  }
  const paywallHTML = window._buildPaywallHTML
    ? window._buildPaywallHTML({ patreonConnected })
    : `<p>Ez a fejezet prémium tartalom. <a href="/settings.html">Előfizetés</a></p>`;

  // Overlay modal — ugyanolyan mint a chapters oldalon
  const existing = document.getElementById("readerLockModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "readerLockModal";
  modal.className = "locked-modal";
  modal.innerHTML = `
    <div class="locked-backdrop"></div>
    <div class="locked-box">
      ${paywallHTML}
      <button class="lock-close" onclick="location.href='/chapters.html?slug=${targetSlug || slug}'">
        ← Vissza a fejezetlistához
      </button>
    </div>
  `;
  document.body.appendChild(modal);
}

/* ── KÉPEK BETÖLTÉSE (prioritásos, szekvenciális) ─────────── */
async function loadPages() {
  const res = await fetch(`/api/pages/${slug}/${chapter}`);

  if (res.status === 403) {
    await showLockPage(slug);
    return false;
  }

  const data = await res.json();
  allFiles = data.pages;
  currentLibrary = data.library;
  fixVersions = data.fixVersions || {};

  if (!allFiles.length) return true;

  if (readMode === "book") {
    buildBookPages();
  } else {
    buildScrollPages();
  }

  return true;
}

function buildScrollPages() {
  pagesEl.innerHTML = "";
  pagesEl.className = "mode-scroll";

  if (startPage === 0) window.scrollTo(0, 0);

  // Prioritásos betöltés: startPage körüli képek először
  const order = priorityOrder(allFiles.length, startPage > 0 ? startPage - 1 : 0);

  // Placeholder-ek létrehozása
  const imgEls = allFiles.map((f, i) => {
    const wrap = document.createElement("div");
    wrap.dataset.index = i;

    const img = document.createElement("img");
    img.dataset.src = `/api/image/${currentLibrary}/${slug}/${chapter}/${encodeURIComponent(f)}${fixVersions[f] ? `?v=${fixVersions[f]}` : ""}`;
    img.dataset.index = i;
    img.style.display = "none";

    const ph = document.createElement("div");
    ph.className = "img-placeholder";
    ph.style.aspectRatio = "3/4";

    wrap.appendChild(ph);
    wrap.appendChild(img);
    pagesEl.appendChild(wrap);

    return { img, ph, wrap };
  });

  // Sorban betöltjük prioritás szerint
  loadImagesInOrder(order, imgEls, startPage);
}

function buildBookPages() {
  pagesEl.innerHTML = "";
  pagesEl.className = "mode-book";

  allFiles.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "book-page";
    div.dataset.index = i;

    const img = document.createElement("img");
    img.dataset.src = `/api/image/${currentLibrary}/${slug}/${chapter}/${encodeURIComponent(f)}${fixVersions[f] ? `?v=${fixVersions[f]}` : ""}`;
    img.alt = "";

    div.appendChild(img);
    pagesEl.appendChild(div);
  });

  bookPageIndex = startPage > 0 ? startPage - 1 : 0;
  renderBookView();
}

function priorityOrder(total, pivot) {
  // pivot körüli indexek először, majd előre és hátra váltakozva
  const order = [];
  order.push(pivot);
  let lo = pivot - 1, hi = pivot + 1;
  while (lo >= 0 || hi < total) {
    if (hi < total)  order.push(hi++);
    if (lo >= 0)     order.push(lo--);
  }
  return order;
}

function loadImagesInOrder(order, imgEls, scrollTarget) {
  let i = 0;
  let scrollDone = false;

  function loadNext() {
    if (i >= order.length) return;
    const idx = order[i++];
    const { img, ph } = imgEls[idx];

    const tmpImg = new Image();
    tmpImg.onload = () => {
      img.src = tmpImg.src;
      img.style.display = "block";
      ph.remove();

      // Scroll az első céloldalra
      if (!scrollDone && idx === (scrollTarget > 0 ? scrollTarget - 1 : 0)) {
        scrollDone = true;
        setTimeout(() => img.scrollIntoView({ behavior: "auto", block: "start" }), 80);
      }

      loadNext();
    };
    tmpImg.onerror = () => {
      ph.textContent = "Kép nem található";
      loadNext();
    };
    tmpImg.src = img.dataset.src;
  }

  // Párhuzamosan indítunk néhány betöltést
  const parallel = isMobile ? 2 : 3;
  for (let p = 0; p < parallel && p < order.length; p++) loadNext();
}

/* ── KÖNYV MÓD RENDER ────────────────────────────────────── */
function renderBookView() {
  const pages = [...pagesEl.querySelectorAll(".book-page")];
  const total = pages.length;

  pages.forEach(p => p.classList.remove("visible"));

  if (isMobile) {
    // Mobil: 1 oldal
    if (pages[bookPageIndex]) {
      pages[bookPageIndex].classList.add("visible");
      loadBookImage(pages[bookPageIndex]);
    }
  } else {
    // Asztal: 2 oldal egymás mellett
    const left  = bookPageIndex;
    const right = bookPageIndex + 1;
    if (pages[left])  { pages[left].classList.add("visible");  loadBookImage(pages[left]); }
    if (pages[right]) { pages[right].classList.add("visible"); loadBookImage(pages[right]); }
  }

  // Előre betöltjük a következőket
  const preload = isMobile ? 2 : 4;
  for (let k = 1; k <= preload; k++) {
    const next = bookPageIndex + (isMobile ? k : k * 2);
    if (pages[next]) loadBookImage(pages[next]);
    if (pages[next + 1]) loadBookImage(pages[next + 1]);
  }

  // Progress frissítés
  saveProgress(bookPageIndex + 1);
}

function loadBookImage(pageDiv) {
  const img = pageDiv.querySelector("img");
  if (!img || img.src) return;
  img.src = img.dataset.src;
}

function bookNext() {
  const step = isMobile ? 1 : 2;
  const total = allFiles.length;
  if (bookPageIndex + step < total) {
    pagesEl.classList.add("page-flip-enter");
    setTimeout(() => pagesEl.classList.remove("page-flip-enter"), 300);
    bookPageIndex += step;
    renderBookView();
  }
}

function bookPrev() {
  const step = isMobile ? 1 : 2;
  if (bookPageIndex - step >= 0) {
    pagesEl.classList.add("page-flip-enter");
    setTimeout(() => pagesEl.classList.remove("page-flip-enter"), 300);
    bookPageIndex -= step;
    renderBookView();
  }
}

/* ── KÖNYV MÓD: BILLENTYŰ, SWIPE, KATTINTÁS ─────────────── */
document.addEventListener("keydown", e => {
  if (readMode !== "book") return;
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") bookNext();
  if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") bookPrev();
});

// Touch kezelő
let touchStartX = 0;
let touchStartY = 0;
let isSwiping   = false;
let touchScrollStartY = 0;
let touchScrollOverflow = 0;
const OVERFLOW_THRESHOLD = 80;

// Könyv mód swipe
pagesEl.addEventListener("touchstart", e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  isSwiping = false;
}, { passive: true });

pagesEl.addEventListener("touchmove", e => {
  const dx = Math.abs(e.touches[0].clientX - touchStartX);
  const dy = Math.abs(e.touches[0].clientY - touchStartY);
  if (dx > 10 && dx > dy) isSwiping = true;
}, { passive: true });

pagesEl.addEventListener("touchend", e => {
  if (readMode !== "book") return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (isSwiping) {
    if (dx < -40) bookNext();
    if (dx >  40) bookPrev();
  }
});

// Scroll mód: túlhúzás fejezet váltás
function showChapterHint(dir, progress) {
  let hint = document.getElementById("chapterHint");
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "chapterHint";
    hint.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);z-index:200;" +
      "background:rgba(124,92,255,.92);color:#fff;padding:10px 24px;border-radius:999px;" +
      "font-size:.88rem;font-weight:600;pointer-events:none;transition:opacity .2s;opacity:0;";
    document.body.appendChild(hint);
  }
  hint.textContent = dir === "next" ? "Következő fejezet →" : "← Előző fejezet";
  hint.style.bottom = dir === "next" ? "90px" : "auto";
  hint.style.top    = dir === "prev" ? "70px"  : "auto";
  hint.style.opacity = Math.min((progress || 0) * 1.5, 1).toString();
}

function hideChapterHint() {
  const h = document.getElementById("chapterHint");
  if (h) h.style.opacity = "0";
}

window.addEventListener("touchstart", e => {
  touchScrollStartY = e.touches[0].clientY;
  touchScrollOverflow = 0;
}, { passive: true });

window.addEventListener("touchmove", e => {
  if (readMode !== "scroll") return;
  const dy = touchScrollStartY - e.touches[0].clientY;
  const st = window.scrollY;
  const sm = document.body.scrollHeight - window.innerHeight;
  if (st >= sm - 5 && dy > 0) {
    touchScrollOverflow = dy;
    showChapterHint("next", touchScrollOverflow / OVERFLOW_THRESHOLD);
  } else if (st <= 5 && dy < 0) {
    touchScrollOverflow = Math.abs(dy);
    showChapterHint("prev", touchScrollOverflow / OVERFLOW_THRESHOLD);
  }
}, { passive: true });

window.addEventListener("touchend", async () => {
  if (readMode !== "scroll") { hideChapterHint(); return; }
  const st = window.scrollY;
  const sm = document.body.scrollHeight - window.innerHeight;
  if (touchScrollOverflow >= OVERFLOW_THRESHOLD) {
    if (st >= sm - 5) {
      hideChapterHint();
      const index = chapters.findIndex(c => c.folder === chapter);
      if (index >= 0 && index < chapters.length - 1) {
        const next = chapters[index + 1].folder;
        const checkRes = await fetch(`/api/pages/${slug}/${next}`);
        if (checkRes.status === 403) { await showLockPage(slug); return; }
        await saveProgress(getCurrentPage());
        goToChapter(next);
      }
    } else if (st <= 5) {
      hideChapterHint();
      const index = chapters.findIndex(c => c.folder === chapter);
      if (index > 0) goToChapter(chapters[index - 1].folder);
    }
  }
  touchScrollOverflow = 0;
  hideChapterHint();
});

/* ── NAV ─────────────────────────────────────────────────── */
async function loadNav() {
  const [chaptersRes, metaRes] = await Promise.all([
    fetch(`/api/chapters/${slug}`),
    fetch(`/api/manga/${slug}`)
  ]);

  const chaptersData = await chaptersRes.json();
  chapters = (chaptersData.chapters || chaptersData).sort(compareChapters);
  const meta = await metaRes.json();

  const index = chapters.findIndex(c => c.folder === chapter);

  document.getElementById("mangaTitle").textContent  = meta.title || slug;
  document.getElementById("chapterNum").textContent  = `${chapter} (${index + 1} / ${chapters.length})`;
  document.getElementById("backBtn").href = `/chapters.html?slug=${slug}`;

  // Előző fejezet
  document.getElementById("prevBtn").onclick = () => {
    if (index > 0) goToChapter(chapters[index - 1].folder);
  };

  // Következő fejezet
  document.getElementById("nextBtn").onclick = async () => {
    if (index >= chapters.length - 1) {
      await saveProgress(getCurrentPage());
      location.href = `/chapters.html?slug=${slug}`;
      return;
    }
    const nextChapter = chapters[index + 1].folder;

    const checkRes = await fetch(`/api/pages/${slug}/${nextChapter}`);
    if (checkRes.status === 403) {
      await showLockPage(slug);
      return;
    }

    await saveProgress(getCurrentPage());
    goToChapter(nextChapter);
  };
}

function goToChapter(folder) {
  location.href = `/reader.html?slug=${slug}&chapter=${encodeURIComponent(folder)}`;
}

function compareChapters(a, b) {
  const ak = a.folder.split(".").map(n => parseInt(n, 10));
  const bk = b.folder.split(".").map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(ak.length, bk.length); i++) {
    const av = ak[i] ?? 0;
    const bv = bk[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/* ── TELJES KÉPERNYŐ ─────────────────────────────────────── */
let isFullscreen = false;

function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  document.body.classList.toggle("fullscreen", isFullscreen);

  const btn = document.getElementById("btnFullscreen");
  if (btn) btn.textContent = isFullscreen ? "⤡" : "⤢";

  if (isFullscreen) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    hideUI();
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.();
    showUI();
  }
}

document.addEventListener("fullscreenchange", () => {
  // Böngésző kilépett valódi fullscreenből (pl. ESC) - CSS fullscreen marad
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && isFullscreen) toggleFullscreen();
});

/* ── OLVASÁSI MÓD VÁLTÓ GOMB ─────────────────────────────── */
function cycleMode() {
  const next = readMode === "scroll" ? "book" : "scroll";
  setMode(next);
  // Ha módot váltunk, újra kell rendernünk
  if (allFiles.length) {
    if (next === "book") {
      buildBookPages();
    } else {
      buildScrollPages();
    }
  }
}

/* ── UI TOGGLE ───────────────────────────────────────────── */
const topbar    = document.querySelector(".topbar");
const bottombar = document.querySelector(".bottombar");
let uiVisible   = false;
let uiHideTimer = null;

function showUI() {
  uiVisible = true;
  topbar.style.opacity          = "1";
  bottombar.style.opacity       = "1";
  topbar.style.pointerEvents    = "auto";
  bottombar.style.pointerEvents = "auto";
  clearTimeout(uiHideTimer);
  // Fullscreen módban 4mp után elrejtés, normál módban is
  uiHideTimer = setTimeout(hideUI, 4000);
}

function hideUI() {
  uiVisible = false;
  topbar.style.opacity          = "";
  bottombar.style.opacity       = "";
  topbar.style.pointerEvents    = "";
  bottombar.style.pointerEvents = "";
}

// Kattintás: szimpla = UI, dupla = fullscreen
let lastClickTime = 0;
let clickTimer    = null;

document.addEventListener("click", e => {
  if (e.target.closest("button") || e.target.closest("a")) return;

  const xRatio = e.clientX / window.innerWidth;
  const now    = Date.now();
  const dbl    = now - lastClickTime < 300;
  lastClickTime = now;

  if (readMode === "book" && isMobile) {
    if (xRatio < 0.25) { bookPrev(); return; }
    if (xRatio > 0.75) { bookNext(); return; }
  }

  // Középső zóna: szimpla/dupla detektálás
  if (xRatio > 0.2 && xRatio < 0.8) {
    clearTimeout(clickTimer);
    if (dbl) {
      // Dupla kattintás → fullscreen
      toggleFullscreen();
    } else {
      // Szimpla kattintás → UI (késleltetett hogy ne fusson dupla esetén)
      clickTimer = setTimeout(() => {
        if (uiVisible) hideUI(); else showUI();
      }, 280);
    }
  }
});

/* ── HIBABEJELENTŐ ───────────────────────────────────────── */
function bugReportClick() {
  if (typeof openBugModal !== "function") return;
  // data-src tartalmazza a teljes URL-t providerrel együtt
  const imageUrls = [...document.querySelectorAll("#pages img")].map(img =>
    img.dataset.src || (img.src ? new URL(img.src).pathname : null)
  );
  openBugModal(getCurrentPage(), allFiles, slug, chapter, imageUrls);
}

/* ── INIT ────────────────────────────────────────────────── */
(async () => {
  await loadProgress();
  const ok = await loadPages();
  if (ok) await loadNav();

  setMode(readMode);

  // Fullscreen mindig kikapcsolt állapotban indul
})();
