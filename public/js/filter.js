/* ===== MANGA FILTER + GRID ===== */

let allMangas = [];
let mangaGenres = {};
let mangaTags = {};
let selectedGenres = new Set();
let selectedTags = new Set();
let sortChaptersState = 0; // 0=default, 1=desc (legtöbb), 2=asc (legkevesebb)

async function init() {
  await loadMangas();
  await loadMangaFilter();
}

async function loadMangas() {
  try {
    const res = await fetch("/api/manga");
    allMangas = await res.json();

    const progressMap = {};
    await Promise.all(
      allMangas.map(async (m) => {
        try {
          const r = await fetch(`/api/progress/${m.slug}`);
          if (r.ok) {
            const p = await r.json();
            if (p) progressMap[m.slug] = p;
          }
        } catch {}
      })
    );

    const grid = document.getElementById("grid");
    grid.innerHTML = "";

    allMangas.forEach(m => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.slug = m.slug;
      card.dataset.chapterCount = m.chapter_count || 0;

      const coverLink = document.createElement("a");
      coverLink.className = "cover";
      coverLink.href = `/chapters.html?slug=${encodeURIComponent(m.slug)}`;

      if (m.cover_url) {
        const img = document.createElement("img");
        img.src = m.cover_url;
        img.loading = "lazy";
        coverLink.appendChild(img);
      } else {
        coverLink.textContent = "No Cover";
      }

      if (m.chapter_count != null) {
        const chBadge = document.createElement("div");
        chBadge.className = "chapter-count-badge";
        chBadge.textContent = m.chapter_count + " rész";
        coverLink.appendChild(chBadge);
      }

      if (progressMap[m.slug]) {
        const badge = document.createElement("div");
        badge.className = "continue-badge";
        badge.textContent = "▶ Folytatás";
        coverLink.appendChild(badge);
        coverLink.href = `/reader.html?slug=${encodeURIComponent(m.slug)}&chapter=${encodeURIComponent(progressMap[m.slug].chapter)}&page=${progressMap[m.slug].page}`;
      }

      const titleLink = document.createElement("a");
      titleLink.className = "title";
      titleLink.href = `/chapters.html?slug=${encodeURIComponent(m.slug)}`;
      titleLink.textContent = m.title;

      card.appendChild(coverLink);
      card.appendChild(titleLink);
      grid.appendChild(card);
    });

  } catch (e) {
    console.error("Failed to load manga", e);
  }
}

async function loadMangaFilter() {
  try {
    const res = await fetch("/api/manga-list");
    const data = await res.json();

    allMangas.forEach(m => {
      mangaGenres[m.slug] = data[m.slug]?.genres || [];
      mangaTags[m.slug] = data[m.slug]?.tags || [];
    });
  } catch (e) {
    console.error("Filter load error", e);
  }

  buildFilterUI();
}
function buildFilterUI() {
  const panel = document.getElementById("filterPanel");
  if (!panel) return;

  const allGenres = [...new Set(Object.values(mangaGenres).flat())].sort();
  const allTags = [...new Set(Object.values(mangaTags).flat())].sort();

  panel.innerHTML = `
    <div class="filter-section open" id="genreSection">
      <div class="filter-section-header" onclick="toggleFilterSection('genreSection')">
        <span>🎭 Műfaj</span>
        <span class="filter-toggle-icon">▶</span>
      </div>
      <div class="filter-tags" id="genreTags">
        ${allGenres.map(g => `
          <button class="filter-genre-btn" data-genre="${g}" onclick="toggleGenre('${g.replace(/'/g, "\\'")}')">
            ${g}
          </button>
        `).join("")}
      </div>
    </div>

    <div class="filter-section" id="tagSection">
      <div class="filter-section-header" onclick="toggleFilterSection('tagSection')">
        <span>🏷️ Tag</span>
        <span class="filter-toggle-icon">▶</span>
      </div>
      <div class="filter-tags collapsed" id="tagTags">
        ${allTags.map(t => `
          <button class="filter-tag-btn" data-tag="${t}" onclick="toggleTag('${t.replace(/'/g, "\\'")}')">
            ${t}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function toggleFilterSection(id) {
  const section = document.getElementById(id);
  const tagsEl = section.querySelector(".filter-tags");
  section.classList.toggle("open");
  tagsEl.classList.toggle("collapsed");
}

function toggleGenre(genre) {
  if (selectedGenres.has(genre)) {
    selectedGenres.delete(genre);
  } else {
    selectedGenres.add(genre);
  }
  updateFilterUI();
  applyFilter();
}

function toggleTag(tag) {
  if (selectedTags.has(tag)) {
    selectedTags.delete(tag);
  } else {
    selectedTags.add(tag);
  }
  updateFilterUI();
  applyFilter();
}

function clearFilters() {
  selectedGenres.clear();
  selectedTags.clear();
  updateFilterUI();
  applyFilter();
}

function cycleSortChapters() {
  sortChaptersState = (sortChaptersState + 1) % 3;
  const btn = document.getElementById("sortChaptersBtn");
  if (sortChaptersState === 0) {
    btn.textContent = "📚 Részek";
    btn.classList.remove("active", "asc");
    // ABC sorrend visszaállítás
    const grid = document.getElementById("grid");
    const cards = [...grid.querySelectorAll(".card")];
    cards.sort((a, b) => {
      const ta = a.querySelector(".title")?.textContent || "";
      const tb = b.querySelector(".title")?.textContent || "";
      return ta.localeCompare(tb, "hu");
    });
    cards.forEach(c => grid.appendChild(c));
    applyFilter();
    return;
  } else if (sortChaptersState === 1) {
    btn.textContent = "📚 Részek ↓";
    btn.classList.add("active");
    btn.classList.remove("asc");
  } else {
    btn.textContent = "📚 Részek ↑";
    btn.classList.add("active", "asc");
  }
  applyFilter();
}

function updateFilterUI() {
  document.querySelectorAll(".filter-genre-btn").forEach(btn => {
    btn.classList.toggle("selected", selectedGenres.has(btn.dataset.genre));
  });

  document.querySelectorAll(".filter-tag-btn").forEach(btn => {
    btn.classList.toggle("selected", selectedTags.has(btn.dataset.tag));
  });

  const summary = document.getElementById("filterSummary");
  const total = selectedGenres.size + selectedTags.size;

  if (total === 0) {
    summary.innerHTML = "";
    document.getElementById("filterCount").textContent = "";
    return;
  }

  const labels = [
    ...[...selectedGenres].map(g => `<span style="color:#7dd3fc">${g}</span>`),
    ...[...selectedTags].map(t => `<span style="color:#a78bfa">${t}</span>`)
  ].join(", ");

  summary.innerHTML = `
    Szűrő: ${labels}
    <button class="filter-clear-btn" onclick="clearFilters()">✕ Törlés</button>
  `;
}

function applyFilter() {
  const grid = document.getElementById("grid");
  const cards = [...document.querySelectorAll(".card")];
  let visible = 0;

  // Szűrés
  cards.forEach(card => {
    const slug = card.dataset.slug;
    if (!slug) return;

    const genres = mangaGenres[slug] || [];
    const tags = mangaTags[slug] || [];

    const genreMatch = selectedGenres.size === 0 ||
      [...selectedGenres].every(g => genres.includes(g));

    const tagMatch = selectedTags.size === 0 ||
      [...selectedTags].every(t => tags.includes(t));

    const show = genreMatch && tagMatch;
    card.style.display = show ? "" : "none";
    if (show) visible++;
  });

  // Rendezés fejezetek szerint
  if (sortChaptersState !== 0) {
    const visibleCards = cards.filter(c => c.style.display !== "none");
    visibleCards.sort((a, b) => {
      const ca = parseInt(a.dataset.chapterCount) || 0;
      const cb = parseInt(b.dataset.chapterCount) || 0;
      return sortChaptersState === 1 ? cb - ca : ca - cb;
    });
    visibleCards.forEach(c => grid.appendChild(c));
  }

  const noResults = document.getElementById("filterNoResults");
  if (noResults) {
    noResults.style.display = visible === 0 ? "block" : "none";
  }

  const countEl = document.getElementById("filterCount");
  if (countEl) {
    const total = selectedGenres.size + selectedTags.size;
    countEl.textContent = total > 0 ? `${visible} találat` : "";
  }
}

function waitForAuth() {
  if (window.currentUser) {
    init();
  } else {
    setTimeout(waitForAuth, 100);
  }
}

document.addEventListener("DOMContentLoaded", waitForAuth);
