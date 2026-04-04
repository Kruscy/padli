(async function () {
  const heroContent = document.getElementById("heroContent");
  const heroInner = heroContent.querySelector(".hero-inner");
  const prevBtn = document.getElementById("heroPrev");
  const nextBtn = document.getElementById("heroNext");
  const dotsContainer = document.getElementById("heroDots");

  let slides = [];
  let current = 0;
  let startX = 0;
  let autoTimer = null;

  /* ===== DATA BETÖLTÉS ===== */
  try {
    const annRes = await fetch("/api/announcements");
    const announcements = annRes.ok ? await annRes.json() : [];
    const announcementSlides = announcements.map(a => ({
      type: "announcement",
      id: a.id,
      title: a.title,
      body: a.body,
      image_url: a.image_url
    }));

    const pollRes = await fetch("/api/polls/active");
    const polls = pollRes.ok ? await pollRes.json() : [];
    // Minden aktív szavazást betöltünk részletesen
    const pollDetails = await Promise.all(
      polls.map(async p => {
        const r = await fetch(`/api/polls/${p.id}`);
        return r.ok ? await r.json() : null;
      })
    );
    const pollSlides = pollDetails.filter(Boolean)
      .filter(d => {
        // Csak azokat jelenítjük meg ahol még nem szavazott
        const pollMeta = polls.find(p => p.id === d.poll.id);
        return !pollMeta?.voted;
      })
      .map(d => ({
        type: "poll",
        id: d.poll.id,
        title: d.poll.title,
        options: d.options,
        voted: false
      }));

    const res = await fetch("/api/featured");
    const featured = res.ok ? await res.json() : [];
    const mangaSlides = featured.map(m => ({ type: "manga", ...m }));

    slides = [...announcementSlides, ...pollSlides, ...mangaSlides];
  } catch (err) {
    console.error("Hero load error:", err);
    return;
  }

  if (!slides || !slides.length) return;

  /* ===== RENDER ===== */
  function render(index) {
    const item = slides[index];
    if (!item) return;

    heroContent.classList.remove("show");

    setTimeout(() => {
      if (item.type === "announcement") {
        renderAnnouncement(item);
      } else if (item.type === "poll") {
        renderPoll(item);
      } else {
        renderManga(item);
      }
      heroContent.classList.add("show");
      updateDots();
    }, 220);
  }

  /* ===== KIÍRÁS ===== */
  function renderAnnouncement(item) {
    const hasImage = !!item.image_url;
    heroInner.innerHTML = `
      <div class="hero-card announcement-card ${hasImage ? 'has-image' : ''}">
        ${hasImage ? `
          <div class="hero-card-image">
            <img src="${item.image_url}" alt="${escHtml(item.title)}">
          </div>
        ` : ""}
        <div class="hero-card-body">
          <div class="hero-card-tag">Kiírás</div>
          <h2>${escHtml(item.title)}</h2>
          <div class="hero-card-text">${formatBody(item.body || "")}</div>
          <button class="hero-btn" onclick="openAnnouncement(${item.id})">
            Részletek →
          </button>
        </div>
      </div>
    `;
  }

  function renderPoll(item) {
    const totalVotes = item.options.reduce((a, b) => a + parseInt(b.votes || 0), 0);

    const optionsHtml = item.options.map(opt => {
      const pct = totalVotes ? Math.round((parseInt(opt.votes || 0) / totalVotes) * 100) : 0;
      return `
        <div class="poll-option-row" data-poll="${item.id}" data-opt="${opt.id}">
          <div class="poll-opt-top">
            ${opt.image_url ? `<img src="${opt.image_url}" class="poll-opt-img" alt="">` : ""}
            <span class="poll-opt-label">${escHtml(opt.title)}</span>
            <span class="poll-opt-pct">${item.voted ? pct + "%" : ""}</span>
          </div>
          ${item.voted ? `
            <div class="poll-bar">
              <div class="poll-bar-fill" style="width:${pct}%"></div>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    heroInner.innerHTML = `
      <div class="hero-card poll-card">
        <div class="hero-card-body">
          <div class="hero-card-tag">Szavazás</div>
          <h2>${escHtml(item.title)}</h2>
          <div class="poll-options-list ${item.voted ? 'voted' : ''}" id="poll-${item.id}">
            ${optionsHtml}
          </div>
          ${item.voted
            ? `<p class="poll-voted-msg">Már szavaztál! <a href="/polls.html">Összes szavazás →</a></p>`
            : `<p class="poll-hint">Kattints egy opcióra a szavazáshoz</p>`
          }
        </div>
      </div>
    `;

    // Szavazás esemény
    if (!item.voted) {
      heroInner.querySelectorAll(".poll-option-row").forEach(row => {
        row.addEventListener("click", () => castVote(item.id, parseInt(row.dataset.opt)));
      });
    }
  }

  function renderManga(item) {
    heroInner.innerHTML = `
      <div class="hero-card manga-card">
        <div class="hero-card-image">
          <img src="${item.cover_url}" alt="${escHtml(item.title)}">
        </div>
        <div class="hero-card-body">
          <div class="hero-card-tag">Manga</div>
          <h2>${escHtml(item.title)}</h2>
          <div class="hero-card-text">${formatBody((item.description || "").slice(0, 350))}</div>
          <a href="/chapters.html?slug=${encodeURIComponent(item.slug)}" class="hero-btn">
            Megnézem →
          </a>
        </div>
      </div>
    `;
  }

  /* ===== SZAVAZÁS ===== */
  async function castVote(pollId, optionId) {
    const list = document.getElementById("poll-" + pollId);
    if (!list) return;
    list.style.pointerEvents = "none";
    list.style.opacity = "0.6";

    try {
      const res = await fetch(`/api/polls/${pollId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Hiba történt");
        list.style.pointerEvents = "";
        list.style.opacity = "";
        return;
      }
      // Szavazás után töröljük a slide-ot – ne maradjon a heroban
      const idx = slides.findIndex(s => s.type === "poll" && s.id === pollId);
      if (idx !== -1) {
        slides.splice(idx, 1);
        createDots();
        if (slides.length === 0) {
          heroInner.innerHTML = "";
          return;
        }
        current = Math.min(current, slides.length - 1);
        render(current);
      }
    } catch {
      alert("Szerver hiba");
      list.style.pointerEvents = "";
      list.style.opacity = "";
    }
  }

  /* ===== SEGÉD ===== */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Sortörések és linkek megjelenítése
  function formatBody(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\r\n|\n/g, "<br>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  /* ===== DOTS ===== */
  function createDots() {
    dotsContainer.innerHTML = "";
    slides.forEach((s, i) => {
      const dot = document.createElement("div");
      dot.className = "hero-dot";
      dot.title = s.title || "";
      dot.addEventListener("click", () => { current = i; render(current); resetAuto(); });
      dotsContainer.appendChild(dot);
    });
  }

  function updateDots() {
    [...dotsContainer.children].forEach((d, i) => {
      d.classList.toggle("active", i === current);
    });
  }

  /* ===== AUTO SLIDE ===== */
  function resetAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => {
      current = (current + 1) % slides.length;
      render(current);
    }, 7000);
  }

  /* ===== NAV ===== */
  prevBtn.addEventListener("click", () => {
    current = (current - 1 + slides.length) % slides.length;
    render(current);
    resetAuto();
  });

  nextBtn.addEventListener("click", () => {
    current = (current + 1) % slides.length;
    render(current);
    resetAuto();
  });

  /* ===== SWIPE ===== */
  heroContent.addEventListener("touchstart", e => { startX = e.touches[0].clientX; });
  heroContent.addEventListener("touchend", e => {
    const diff = e.changedTouches[0].clientX - startX;
    if (diff > 50) { prevBtn.click(); }
    if (diff < -50) { nextBtn.click(); }
  });

  /* ===== INIT ===== */
  createDots();
  render(current);
  resetAuto();

  /* ===== ANNOUNCEMENT MODAL ===== */
  window.__announcements = [];
  fetch("/api/announcements").then(r => r.json()).then(d => window.__announcements = d).catch(() => {});

  window.openAnnouncement = function(id) {
    const a = window.__announcements.find(x => x.id === id);
    if (!a) return;
    const existing = document.getElementById("ann-modal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.id = "ann-modal";
    modal.innerHTML = `
      <div id="ann-backdrop"></div>
      <div id="ann-box">
        ${a.image_url ? `<img src="${a.image_url}" id="ann-img">` : ""}
        <h2>${escHtml(a.title)}</h2>
        <div id="ann-body">${formatBody(a.body || "")}</div>
        <button id="ann-close">Bezárás</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("ann-close").onclick = () => modal.remove();
    document.getElementById("ann-backdrop").onclick = () => modal.remove();
  };

})();
