/* anime-feliratok-init.js – publikus anime-felirat katalógus */

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

(async () => {
  const listEl = document.getElementById("animeList");

  let animeList = [];
  try {
    const res = await fetch("/api/anime");
    if (!res.ok) throw new Error("Betöltési hiba");
    animeList = await res.json();
  } catch {
    listEl.innerHTML = "<p style='color:#ef4444; text-align:center;'>Nem sikerült betölteni a listát.</p>";
    return;
  }

  if (!animeList.length) {
    listEl.innerHTML = "<p style='color:#888; text-align:center;'>Még nincs feltöltött felirat.</p>";
    return;
  }

  listEl.innerHTML = "";
  animeList.forEach(anime => {
    const card = document.createElement("div");
    card.className = "anime-sub-card";
    card.innerHTML = `
      <div class="anime-sub-header">
        <img class="anime-sub-cover" src="${escHtml(anime.cover_url || "/assets/no-cover.png")}" alt="" loading="lazy">
        <div class="anime-sub-title-wrap">
          <div class="anime-sub-title">${escHtml(anime.title)}</div>
          <div class="anime-sub-meta">${anime.episode_count} feltöltött rész</div>
        </div>
        <span class="anime-sub-toggle-icon">▶</span>
      </div>
      <div class="anime-sub-body hidden" id="anime-body-${anime.id}">
        <p style="color:#888;">Betöltés...</p>
      </div>
    `;
    card.querySelector(".anime-sub-header").addEventListener("click", function() {
      toggleAnime(anime.slug, anime.id, this);
    });
    listEl.appendChild(card);
  });
})();

const loadedAnime = new Set();

async function toggleAnime(slug, id, headerEl) {
  const body = document.getElementById(`anime-body-${id}`);
  const icon = headerEl.querySelector(".anime-sub-toggle-icon");

  if (!body.classList.contains("hidden")) {
    body.classList.add("hidden");
    icon.textContent = "▶";
    return;
  }

  body.classList.remove("hidden");
  icon.textContent = "▼";

  if (loadedAnime.has(id)) return;
  loadedAnime.add(id);

  try {
    const res = await fetch(`/api/anime/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("Betöltési hiba");
    const detail = await res.json();
    renderSeasons(body, detail);
  } catch {
    body.innerHTML = "<p class='anime-sub-empty'>Nem sikerült betölteni a részleteket.</p>";
  }
}

function renderSeasons(body, anime) {
  if (!anime.seasons?.length) {
    body.innerHTML = "<p class='anime-sub-empty'>Még nincs feltöltött évad.</p>";
    return;
  }

  body.innerHTML = anime.seasons.map(season => `
    <div class="anime-sub-season">
      <div class="anime-sub-season-header">
        <span class="anime-sub-season-title">${season.season_number}. évad</span>
        ${season.episodes.length
          ? `<a class="anime-sub-season-download" href="/api/anime/season/${season.id}/download-all">📦 Egész évad (zip)</a>`
          : ""}
      </div>
      ${season.episodes.length
        ? season.episodes.map(ep => `
            <div class="anime-sub-episode-row">
              <span>${ep.episode_number}. rész</span>
              <a class="anime-sub-episode-download" href="/api/anime/episode/${ep.id}/download">⬇️ Letöltés</a>
            </div>
          `).join("")
        : "<p class='anime-sub-empty'>Nincs feltöltött rész ehhez az évadhoz.</p>"}
    </div>
  `).join("");
}
