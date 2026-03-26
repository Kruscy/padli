(async function () {
  const heroContent = document.getElementById("heroContent");
  const heroInner = heroContent.querySelector(".hero-inner");
  const prevBtn = document.getElementById("heroPrev");
  const nextBtn = document.getElementById("heroNext");
  const dotsContainer = document.getElementById("heroDots");

  let slides = [];
  let current = 0;
  let startX = 0;

  /* ===== DATA BETÖLTÉS ===== */
  try {
    // 1️⃣ Aktív kiírások (legelőre)
    const annRes = await fetch("/api/announcements");
    const announcements = annRes.ok ? await annRes.json() : [];
    const announcementSlides = announcements.map(a => ({
      type: "announcement",
      id: a.id,
      title: a.title,
      body: a.body,
      image_url: a.image_url
    }));

    // 2️⃣ Aktív szavazások
    const pollRes = await fetch("/api/polls/active");
    const polls = pollRes.ok ? await pollRes.json() : [];
    const openPolls = polls.filter(p => !p.voted);
    const pollSlides = openPolls.map(p => ({
      type: "poll",
      id: p.id,
      title: p.title,
      description: "Aktív szavazás — kattints és szavazz!",
      slug: null
    }));

    // 3️⃣ Featured mangák
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
        heroInner.innerHTML = `
          <div class="hero-poll">
            <h2>📢 ${item.title}</h2>
            <p>${item.body?.slice(0, 200) || ""}</p>
            <button class="hero-btn poll-btn" onclick="openAnnouncement(${item.id})">
              Részletek
            </button>
          </div>
        `;
      } else if (item.type === "poll") {
        heroInner.innerHTML = `
          <div class="hero-poll">
            <h2>🗳️ ${item.title}</h2>
            <p>${item.description}</p>
            <a href="/polls.html" class="hero-btn poll-btn">Szavazok</a>
          </div>
        `;
      } else {
        heroInner.innerHTML = `
          <div class="hero-image-wrap">
            <img src="${item.cover_url}" class="heroImage">
          </div>
          <div class="hero-text">
            <h2>${item.title}</h2>
            <p>${item.description?.slice(0, 400) || ""}...</p>
            <a href="/chapters.html?slug=${encodeURIComponent(item.slug)}"
               class="hero-btn">Megnézem</a>
          </div>
        `;
      }

      heroContent.classList.add("show");
      updateDots();
    }, 200);
  }

  /* ===== DOTS ===== */
  function createDots() {
    dotsContainer.innerHTML = "";
    slides.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.className = "hero-dot";
      dot.addEventListener("click", () => {
        current = i;
        render(current);
      });
      dotsContainer.appendChild(dot);
    });
  }

  function updateDots() {
    [...dotsContainer.children].forEach((d, i) => {
      d.classList.toggle("active", i === current);
    });
  }

  /* ===== NAV ===== */
  prevBtn.addEventListener("click", () => {
    current = (current - 1 + slides.length) % slides.length;
    render(current);
  });

  nextBtn.addEventListener("click", () => {
    current = (current + 1) % slides.length;
    render(current);
  });

  /* ===== SWIPE ===== */
  heroContent.addEventListener("touchstart", e => {
    startX = e.touches[0].clientX;
  });

  heroContent.addEventListener("touchend", e => {
    const diff = e.changedTouches[0].clientX - startX;
    if (diff > 50) prevBtn.click();
    if (diff < -50) nextBtn.click();
  });

  /* ===== INIT ===== */
  createDots();
  render(current);

  /* ===== ANNOUNCEMENT MODAL ===== */
  window.__announcements = [];
  fetch("/api/announcements")
    .then(r => r.json())
    .then(d => window.__announcements = d)
    .catch(() => {});

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
        <h2>${a.title}</h2>
        <p>${a.body}</p>
        <button id="ann-close">Bezárás</button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("ann-close").onclick = () => modal.remove();
    document.getElementById("ann-backdrop").onclick = () => modal.remove();
  };

})();
