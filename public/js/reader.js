/* ============================================================
   reader.js - PadlizsanFanSub olvasó
   ============================================================ */
import * as RC from "./reader-core.js";

history.scrollRestoration = "manual";

const params   = new URLSearchParams(location.search);
const slug     = params.get("slug");
let chapter    = params.get("chapter");
let startPage  = parseInt(params.get("page") || "0", 10);

const pagesEl  = document.getElementById("pages");
const isMobile = window.innerWidth <= 768;

/* ── BEÁLLÍTÁSOK (mód, irány, méretezés…) ───────────────────
   Eszközönként (telefon / gép) külön, a fiókhoz mentve; a böngészőben is
   megtartjuk, hogy betöltéskor azonnal érvényes legyen. A logika:
   reader-core.js. */
const DEVICE = RC.deviceKind(window.innerWidth);
const PREFS_KEY = `reader_prefs_${DEVICE}`;
const LEGACY_MODE_KEY = `reader_mode_${DEVICE}`; // a korábbi, csak módot tároló kulcs

function readLocalPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (saved) return RC.normalizePrefs(saved);
    return RC.normalizePrefs({ mode: localStorage.getItem(LEGACY_MODE_KEY) || undefined });
  } catch { return RC.normalizePrefs({}); }
}

let prefs = readLocalPrefs();
let readMode = prefs.mode;
let webtoonOverride = false; // ebben a fejezetben már eldőlt (felismerés vagy kézi váltás)
let prefsSaveTimer = null;

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    fetch(`/api/reader-prefs/${DEVICE}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }).catch(() => {});
  }, 500);
}

// A fiókhoz mentett beállítás (másik böngészőből / eszközről)
async function loadServerPrefs() {
  try {
    const res = await fetch("/api/reader-prefs");
    if (!res.ok) return;
    const data = await res.json();
    if (!data[DEVICE]) return;
    prefs = RC.normalizePrefs(data[DEVICE]);
    readMode = prefs.mode;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  } catch {}
}

function applyLayout() {
  const b = document.body.classList;
  b.toggle("dir-rtl", prefs.direction === "rtl");
  for (const s of RC.CHOICES.scaling) b.toggle(`scale-${s}`, prefs.scaling === s);
  document.documentElement.style.setProperty("--reader-width", `${prefs.widthPct}vw`);
}

/* ── KÖNYV MÓD POZÍCIÓ ─────────────────────────────────────
   index: az első látható oldal, half: széles kép felezésénél melyik fele
   (0 / 1), egyébként null */
let bookPos = { index: 0, half: null };
const pageDims = {}; // index → { width, height } (a betöltött képekből)

function bookCtx() {
  return {
    total: allFiles.length,
    step: isMobile ? 1 : 2,
    split: prefs.splitWide === "split",
    isWide: (i) => !!pageDims[i] && RC.isWideImage(pageDims[i].width, pageDims[i].height),
  };
}

function setMode(mode) {
  readMode = mode;
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
let chapterVersion = null; // ha be van állítva, minden kép ezt kapja ?v= paraméterként
let chapters      = [];

function getCurrentPage() {
  if (readMode === "book") return bookPos.index + 1;

  // Wrap diveket használunk (nem img-et): a hidden képek rect.top=0, ami
  // félreviszi a számolást töltés közben — a wrap mindig layoutban van.
  // Csak a közvetlen gyerekeket kérdezzük le (>), mert a benne lévő <img>-en
  // is data-index van — descendant szelektorral duplán számolna.
  const wraps = [...document.querySelectorAll("#pages > [data-index]")];
  let current = 1;
  const mid = window.innerHeight / 2;

  wraps.forEach((wrap, i) => {
    if (wrap.getBoundingClientRect().top < mid) current = i + 1;
  });

  return current;
}

// AniList-szinkront csak összekötött fióknál küldünk (oldalbetöltésenként
// egyszer kérdezzük le). Ha az állapot nem kérhető le (nem 401), inkább
// küldjük, hogy a szinkron ne vesszen el.
let anilistConnectedPromise = null;
function isAnilistConnected() {
  if (!anilistConnectedPromise) {
    anilistConnectedPromise = fetch("/api/anilist/status")
      .then(r => r.status === 401 ? { connected: false } : r.ok ? r.json() : { connected: true })
      .then(d => !!d.connected)
      .catch(() => true);
  }
  return anilistConnectedPromise;
}

async function saveProgress(page) {
  if (!chapter || !page || page === lastSavedPage) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, chapter, page })
      });
      if (await isAnilistConnected()) {
        await fetch("/api/anilist/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, chapter })
        });
      }
      lastSavedPage = page;
    } catch {}
  }, 600);
}

// Azonnali mentés navigálás előtt (saveProgress debounced, navigation nem várja meg)
async function saveProgressNow(page) {
  if (!chapter || !page) return;
  clearTimeout(saveTimeout);
  try {
    await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, chapter, page })
    });
    lastSavedPage = page;
  } catch {}
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
      // Ugyanaz a fejezet → folytatjuk ahol abbahagytuk, de ?page= URL param elsőbbséget kap
      if (startPage === 0) startPage = data.page || 0;
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
    : `<p>Ez a fejezet támogatói tartalom. <a href="/settings.html">Előfizetés</a></p>`;

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
      <button class="lock-close">
        ← Vissza a fejezetlistához
      </button>
    </div>
  `;
  // A slug az URL-ből jön — inline onclick-be fűzve kitörhetett a
  // JS-stringből (reflektált XSS); most eseményfigyelő, kódolt URL-lel
  modal.querySelector(".lock-close").addEventListener("click", () => {
    location.href = `/chapters.html?slug=${encodeURIComponent(targetSlug || slug)}`;
  });
  document.body.appendChild(modal);
}

/* ── HIBAOLDAL (fejezet nem található / szerverhiba) ──────── */
function showErrorPage(message) {
  const existing = document.getElementById("readerLockModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "readerLockModal";
  modal.className = "locked-modal";
  modal.innerHTML = `
    <div class="locked-backdrop"></div>
    <div class="locked-box">
      <p>${message}</p>
      <button class="lock-close">
        ← Vissza a fejezetlistához
      </button>
    </div>
  `;
  modal.querySelector(".lock-close").addEventListener("click", () => {
    location.href = `/chapters.html?slug=${encodeURIComponent(slug)}`;
  });
  document.body.appendChild(modal);
}

/* ── KÉPEK BETÖLTÉSE (prioritásos, szekvenciális) ─────────── */
async function loadPages() {
  let res;
  try {
    res = await fetch(`/api/pages/${slug}/${chapter}`);
  } catch {
    showErrorPage("Hálózati hiba történt a fejezet betöltése közben. Próbáld újra később.");
    return false;
  }

  if (res.status === 403) {
    const errData = await res.clone().json().catch(() => ({}));
    if (errData.error === "age_restricted") {
      showErrorPage("🔞 Ez a tartalom csak 18 éven felülieknek elérhető. A fiókodhoz rögzített születési dátum alapján jelenleg nem férhetsz hozzá.");
    } else {
      await showLockPage(slug);
    }
    return false;
  }

  if (!res.ok) {
    showErrorPage("A fejezet nem található. Lehet, hogy törölve vagy átnevezve lett.");
    return false;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    showErrorPage("Hibás válasz érkezett a szervertől. Próbáld újra később.");
    return false;
  }

  allFiles = Array.isArray(data.pages) ? data.pages : [];
  currentLibrary = data.library;
  fixVersions = data.fixVersions || {};
  chapterVersion = data.chapterVersion || null;

  if (!allFiles.length) {
    showErrorPage("Ehhez a fejezethez jelenleg nincsenek elérhető oldalak.");
    return false;
  }

  // A mentett/URL-ben kapott oldalszám nagyobb is lehet, mint a fejezet
  // jelenlegi oldalszáma (pl. újraszkennelt, rövidebb verzió, vagy a
  // duplikátum-javítás miatt egy másik változat töltődött be) — enélkül
  // egy nem létező indexre hivatkozva a lapépítés elszáll.
  if (startPage > allFiles.length) {
    startPage = allFiles.length;
  }

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
    img.dataset.src = `/api/image/${currentLibrary}/${slug}/${chapter}/${encodeURIComponent(f)}?r2=1${chapterVersion ? `&v=${chapterVersion}` : (fixVersions[f] ? `&v=${fixVersions[f]}` : "")}`;
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
    img.dataset.src = `/api/image/${currentLibrary}/${slug}/${chapter}/${encodeURIComponent(f)}?r2=1${chapterVersion ? `&v=${chapterVersion}` : (fixVersions[f] ? `&v=${fixVersions[f]}` : "")}`;
    img.alt = "";
    img.addEventListener("load", () => {
      const wasWide = bookCtx().isWide(i);
      recordDims(i, img.naturalWidth, img.naturalHeight);
      // a most kiderült széles kép felezése, ha épp ez látszik
      if (!wasWide && i === bookPos.index && bookCtx().isWide(i) && bookCtx().split && isMobile) {
        bookPos = { index: i, half: 0 };
        renderBookView();
      }
    });

    // A felezett kép egyik felét a keret vágja ki (lásd reader.css)
    const clip = document.createElement("div");
    clip.className = "page-clip";
    clip.appendChild(img);
    div.appendChild(clip);
    pagesEl.appendChild(div);
  });

  const start = startPage > 0 ? startPage - 1 : 0;
  bookPos = { index: start, half: bookCtx().isWide(start) && prefs.splitWide === "split" && isMobile ? 0 : null };
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
      recordDims(idx, tmpImg.naturalWidth, tmpImg.naturalHeight);
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
  const first = bookPos.index;

  pages.forEach(p => p.classList.remove("visible", "split", "split-left", "split-right"));

  // Mobilon 1 oldal, asztalon 2 egymás mellett (jobbról balra olvasásnál
  // a sorrendet a CSS fordítja meg)
  const shown = isMobile ? [first] : [first, first + 1];
  for (const i of shown) {
    if (!pages[i]) continue;
    pages[i].classList.add("visible");
    loadBookImage(pages[i]);
  }

  // Széles kép fele (csak egyoldalas nézetben)
  const side = RC.halfSide(bookPos.half, prefs.direction);
  if (side && pages[first]) {
    const d = pageDims[first];
    pages[first].style.setProperty("--half-ar", d ? String(d.width / 2 / d.height) : "0.7");
    pages[first].classList.add("split", `split-${side}`);
  }

  // Előre betöltjük a következőket
  const preload = isMobile ? 2 : 4;
  for (let k = 1; k <= preload; k++) {
    const next = first + (isMobile ? k : k * 2);
    if (pages[next]) loadBookImage(pages[next]);
    if (pages[next + 1]) loadBookImage(pages[next + 1]);
  }

  // Progress frissítés
  saveProgress(first + 1);
}

function loadBookImage(pageDiv) {
  const img = pageDiv.querySelector("img");
  if (!img || img.src) return;
  img.src = img.dataset.src;
}

function moveBook(to) {
  if (!to) return;
  pagesEl.classList.add("page-flip-enter");
  setTimeout(() => pagesEl.classList.remove("page-flip-enter"), 300);
  bookPos = to;
  renderBookView();
}
function bookNext() { moveBook(RC.nextPosition(bookPos, bookCtx())); }
function bookPrev() { moveBook(RC.prevPosition(bookPos, bookCtx())); }
function bookAction(action) {
  if (action === "next") bookNext();
  else if (action === "prev") bookPrev();
}
// A képernyő bal / jobb nyila — jobbról balra olvasásnál a bal visz előre
window.bookArrow = (side) => bookAction(RC.arrowAction(side, prefs.direction));

/* ── KÖNYV MÓD: BILLENTYŰ, SWIPE, KATTINTÁS ─────────────── */
document.addEventListener("keydown", e => {
  if (readMode !== "book" || e.target.closest?.("input, select, textarea")) return;
  bookAction(RC.keyAction(e.key, prefs.direction));
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
  if (isSwiping) bookAction(RC.swipeAction(dx, prefs.direction));
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
        await saveProgressNow(getCurrentPage());
        goToChapter(next);
      }
    } else if (st <= 5) {
      hideChapterHint();
      const index = chapters.findIndex(c => c.folder === chapter);
      if (index > 0) {
        await saveProgressNow(getCurrentPage());
        goToChapter(chapters[index - 1].folder);
      }
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
  document.getElementById("prevBtn").onclick = async () => {
    if (index > 0) {
      await saveProgressNow(getCurrentPage());
      goToChapter(chapters[index - 1].folder);
    }
  };

  // Következő fejezet
  document.getElementById("nextBtn").onclick = async () => {
    if (index >= chapters.length - 1) {
      await saveProgressNow(getCurrentPage());
      location.href = `/chapters.html?slug=${slug}`;
      return;
    }
    const nextChapter = chapters[index + 1].folder;

    const checkRes = await fetch(`/api/pages/${slug}/${nextChapter}`);
    if (checkRes.status === 403) {
      await showLockPage(slug);
      return;
    }

    await saveProgressNow(getCurrentPage());
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
  webtoonOverride = true; // a kézi választás felülírja a webtoon-felismerést
  prefs.mode = next;
  savePrefs();
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
  if (e.target.closest("button") || e.target.closest("a") || e.target.closest(".reader-settings")) return;

  const xRatio = e.clientX / window.innerWidth;
  const now    = Date.now();
  const dbl    = now - lastClickTime < 300;
  lastClickTime = now;

  if (readMode === "book" && isMobile) {
    const action = RC.tapAction(xRatio, prefs.direction);
    if (action) { bookAction(action); return; }
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
  try {
    applyLayout();
    await Promise.all([loadProgress(), loadServerPrefs()]);
    applyLayout();
    const ok = await loadPages();
    if (ok) await loadNav();

    setMode(readMode);
  } catch (err) {
    console.error("[reader] init hiba:", err);
    showErrorPage("Váratlan hiba történt az oldal betöltése közben. Próbáld újra később.");
  }

  // Fullscreen mindig kikapcsolt állapotban indul
})();

/* ===== Fejléc-gombok (inline onclick helyett — CSP: script-src-attr) ===== */
document.getElementById("btnFullscreen")?.addEventListener("click", toggleFullscreen);
document.querySelector(".btn-mode")?.addEventListener("click", cycleMode);
document.getElementById("btnBugReport")?.addEventListener("click", bugReportClick);
document.getElementById("btnSettings")?.addEventListener("click", toggleSettingsPanel);

/* ── WEBTOON-FELISMERÉS ──────────────────────────────────────
   Hosszú, keskeny képeknél könyv mód helyett görgetős mód — csak erre a
   fejezetre, a mentett beállítás nem változik. */
function recordDims(index, width, height) {
  if (!width || !height) return;
  pageDims[index] = { width, height };
  if (readMode !== "book" || !prefs.autoWebtoon || webtoonOverride) return;
  const firstDims = [0, 1, 2].map(i => pageDims[i]);
  if (!RC.detectWebtoon(firstDims)) return;
  webtoonOverride = true;
  startPage = getCurrentPage();
  setMode("scroll");
  buildScrollPages();
  showToast("Webtoon: görgetős módra váltottam (a ⚙️ beállításokban kikapcsolható).");
}

function showToast(text) {
  const t = document.createElement("div");
  t.className = "reader-toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

/* ── BEÁLLÍTÁSOK PANEL ───────────────────────────────────── */
const SETTINGS_FIELDS = [
  { key: "direction", label: "Olvasási irány", options: [["ltr", "Balról jobbra"], ["rtl", "Jobbról balra (manga)"]] },
  { key: "scaling", label: "Méretezés", options: [["auto", "Automatikus"], ["width", "Szélességre"], ["height", "Magasságra"], ["original", "Eredeti méret"]] },
  { key: "splitWide", label: "Széles (kétoldalas) képek", hint: "könyv módban, egyoldalas nézetben", options: [["fit", "Egészben"], ["split", "Két félre bontva"]] },
];

function buildSettingsPanel() {
  const panel = document.createElement("div");
  panel.id = "readerSettings";
  panel.className = "reader-settings";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Olvasó beállításai");

  const title = document.createElement("h3");
  title.textContent = `Olvasó beállításai (${DEVICE === "mobile" ? "telefon" : "számítógép"})`;
  panel.appendChild(title);

  for (const f of SETTINGS_FIELDS) {
    const group = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = f.label + (f.hint ? ` — ${f.hint}` : "");
    group.appendChild(legend);
    for (const [value, text] of f.options) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `rs-${f.key}`;
      input.value = value;
      input.checked = prefs[f.key] === value;
      input.addEventListener("change", () => updatePref(f.key, value));
      label.append(input, " ", text);
      group.appendChild(label);
    }
    panel.appendChild(group);
  }

  const widthLabel = document.createElement("label");
  widthLabel.className = "rs-width";
  const range = document.createElement("input");
  range.type = "range"; range.min = "40"; range.max = "100"; range.step = "5";
  range.value = String(prefs.widthPct);
  const widthText = document.createElement("span");
  widthText.textContent = `${prefs.widthPct}%`;
  range.addEventListener("input", () => { widthText.textContent = `${range.value}%`; updatePref("widthPct", Number(range.value)); });
  widthLabel.append("Szélesség (görgetős mód, „Szélességre”): ", range, " ", widthText);
  panel.appendChild(widthLabel);

  const auto = document.createElement("label");
  const autoInput = document.createElement("input");
  autoInput.type = "checkbox";
  autoInput.checked = prefs.autoWebtoon;
  autoInput.addEventListener("change", () => updatePref("autoWebtoon", autoInput.checked));
  auto.append(autoInput, " Webtoonnál automatikusan görgetős mód");
  panel.appendChild(auto);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "rs-close";
  close.textContent = "Bezárás";
  close.addEventListener("click", toggleSettingsPanel);
  panel.appendChild(close);

  document.body.appendChild(panel);
  return panel;
}

function toggleSettingsPanel() {
  const panel = document.getElementById("readerSettings") || buildSettingsPanel();
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) showUI();
}

function updatePref(key, value) {
  prefs = RC.normalizePrefs({ ...prefs, [key]: value });
  savePrefs();
  applyLayout();
  if (readMode === "book" && (key === "splitWide" || key === "direction")) {
    const ctx = bookCtx();
    const split = ctx.split && isMobile && ctx.isWide(bookPos.index);
    bookPos = { index: bookPos.index, half: split ? 0 : null };
    renderBookView();
  }
}
