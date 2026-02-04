// /public/js/search.js

let allManga = [];

async function loadMangaList() {
  try {
    const r = await fetch("/api/manga");
    allManga = await r.json();
  } catch (e) {
    console.error("Search: failed to load manga list", e);
  }
}

export function initSearch() {
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");

  if (!input || !results) {
    console.warn("Search: input or results not found");
    return;
  }

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    results.innerHTML = "";

    if (!q) {
      results.classList.add("hidden");
      return;
    }

    const matches = allManga
      .filter(m => m.title.toLowerCase().includes(q))
      .slice(0, 10);

    if (!matches.length) {
      results.classList.add("hidden");
      return;
    }

    matches.forEach(m => {
      const div = document.createElement("div");
      div.className = "search-item";

      div.innerHTML = `
        <img src="${m.cover_url || "/assets/no-cover.png"}" alt="">
        <span>${m.title}</span>
      `;

      div.addEventListener("click", () => {
        window.location.href = `/chapters.html?slug=${encodeURIComponent(m.slug)}`;
      });

      results.appendChild(div);
    });

    results.classList.remove("hidden");
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".search-wrapper")) {
      results.classList.add("hidden");
    }
  });
}

// automatikus indulás
loadMangaList();
