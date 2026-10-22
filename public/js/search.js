// /public/js/search.js

let allManga = [];

// Kis-/nagybetű, ékezet és írásjel nem számít ("lets go" = "Let's Go")
function norm(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Előre normalizált nevek, hogy gépelés közben ne kelljen újraszámolni
function indexManga(list) {
  return list.map(m => ({
    ...m,
    _title: norm(m.title),
    _alts: (m.alt_titles || []).map(n => [n, norm(n)]).filter(([, k]) => k),
  }));
}

// Találat a fő címre, különben az első egyező alternatív névre.
// Elöl a cím elején egyezők, aztán a címben bárhol, végül az alt. nevek.
function findMatches(q, limit) {
  const hits = [];
  for (const m of allManga) {
    if (m._title.startsWith(q)) hits.push({ m, rank: 0 });
    else if (m._title.includes(q)) hits.push({ m, rank: 1 });
    else {
      const alt = m._alts.find(([, k]) => k.includes(q));
      if (alt) hits.push({ m, rank: 2, alt: alt[0] });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

async function loadMangaList() {
  try {
    const adultMode = localStorage.getItem("adultMode") === "1";
    const r = await fetch(adultMode ? "/api/manga?adult=1" : "/api/manga");
    allManga = indexManga(await r.json());
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
    const q = norm(input.value);
    results.innerHTML = "";

    if (!q) {
      results.classList.add("hidden");
      return;
    }

    const matches = findMatches(q, 10);

    if (!matches.length) {
      results.classList.add("hidden");
      return;
    }

    matches.forEach(({ m, alt }) => {
      const div = document.createElement("div");
      div.className = "search-item";

      // A cím/borító a DB-ből (AniList/admin) jön → szövegként, nem HTML-ként
      const img = document.createElement("img");
      img.src = m.cover_url || "/assets/no-cover.png";
      img.alt = "";
      const span = document.createElement("span");
      span.textContent = m.title;
      if (alt) {
        const small = document.createElement("small");
        small.className = "search-alt";
        small.textContent = `↳ ${alt}`;
        span.append(small);
      }
      div.append(img, span);

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
