let selectedRequestAnime = null;

(async () => {
  const keyOfferBox = document.getElementById("keyOfferBox");
  const requestSearchBox = document.getElementById("requestSearchBox");
  if (!keyOfferBox || !requestSearchBox) return;

  let statusRes;
  try {
    statusRes = await fetch("/api/user/gemini-key-status");
  } catch {
    return;
  }
  if (!statusRes.ok) return; // nincs bejelentkezve vagy szerver hiba - ne mutassunk semmit

  const status = await statusRes.json();
  if (status.contributed) {
    requestSearchBox.style.display = "block";
    initRequestSearch();
  } else {
    keyOfferBox.style.display = "block";
    initKeyOffer();
  }
})();

function initKeyOffer() {
  const input = document.getElementById("geminiKeyInput");
  const btn = document.getElementById("geminiKeySubmitBtn");
  const msg = document.getElementById("geminiKeyMsg");

  btn.addEventListener("click", async () => {
    const apiKey = input.value.trim();
    if (!apiKey) {
      msg.textContent = "Add meg a kulcsot.";
      msg.style.color = "#f87171";
      return;
    }
    btn.disabled = true;
    msg.textContent = "Ellenőrzés...";
    msg.style.color = "#888";
    try {
      const res = await fetch("/api/user/gemini-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = "❌ " + (data.error || "Hiba történt");
        msg.style.color = "#f87171";
        btn.disabled = false;
        return;
      }
      msg.textContent = "✅ Köszönjük! Mostantól kérhetsz fordítást.";
      msg.style.color = "#4ade80";
      setTimeout(() => {
        document.getElementById("keyOfferBox").style.display = "none";
        document.getElementById("requestSearchBox").style.display = "block";
        initRequestSearch();
      }, 1200);
    } catch {
      msg.textContent = "❌ Szerver hiba";
      msg.style.color = "#f87171";
      btn.disabled = false;
    }
  });
}

function initRequestSearch() {
  const input = document.getElementById("animeReqSearchInput");
  const resultsBox = document.getElementById("animeReqSearchResults");
  const selectedBox = document.getElementById("animeReqSelected");
  const msg = document.getElementById("animeReqMsg");

  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      resultsBox.innerHTML = "";
      return;
    }
    debounceTimer = setTimeout(async () => {
      const res = await fetch(`/api/anilist/search?type=anime&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      resultsBox.innerHTML = "";
      data.forEach(m => {
        const div = document.createElement("div");
        div.className = "search-item";
        const title = m.title.english || m.title.romaji;
        div.innerHTML = `
          <img src="${m.coverImage?.medium || ""}">
          <span>${title}${m.episodes ? ` <small style="opacity:.6">(${m.episodes} rész)</small>` : ""}</span>
        `;
        div.addEventListener("click", () => selectAnime(m));
        resultsBox.appendChild(div);
      });
    }, 350);
  });

  function selectAnime(m) {
    selectedRequestAnime = m;
    resultsBox.innerHTML = "";
    input.value = "";
    msg.textContent = "";
    const title = m.title.english || m.title.romaji;
    selectedBox.style.display = "block";
    selectedBox.innerHTML = `
      <div class="anime-sub-req-selected-header">
        <img src="${m.coverImage?.medium || ""}" class="anime-sub-req-selected-cover">
        <div class="anime-sub-req-selected-title">${title}</div>
      </div>
      <div class="anime-sub-req-form">
        <label>Évad száma
          <input id="reqSeasonInput" type="number" min="1" value="1">
        </label>
        <label>Rész száma (üresen: egész évad)
          <input id="reqEpisodeInput" type="number" min="1" placeholder="pl. 5">
        </label>
        <button id="reqSubmitBtn">Kérés elküldése</button>
      </div>
    `;
    document.getElementById("reqSubmitBtn").addEventListener("click", submitRequest);
  }

  async function submitRequest() {
    const btn = document.getElementById("reqSubmitBtn");
    const seasonNumber = document.getElementById("reqSeasonInput").value;
    const episodeNumber = document.getElementById("reqEpisodeInput").value;
    btn.disabled = true;
    msg.textContent = "Küldés...";
    msg.style.color = "#888";
    try {
      const res = await fetch("/api/subtitle-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anilist_id: selectedRequestAnime.id,
          anime_title: selectedRequestAnime.title.english || selectedRequestAnime.title.romaji,
          cover_url: selectedRequestAnime.coverImage?.medium || null,
          season_number: seasonNumber,
          episode_number: episodeNumber || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = "❌ " + (data.error || "Hiba történt");
        msg.style.color = "#f87171";
        btn.disabled = false;
        return;
      }
      msg.textContent = "✅ Elküldve, hamarosan foglalkozunk vele!";
      msg.style.color = "#4ade80";
      selectedBox.style.display = "none";
      selectedRequestAnime = null;
    } catch {
      msg.textContent = "❌ Szerver hiba";
      msg.style.color = "#f87171";
      btn.disabled = false;
    }
  }
}
