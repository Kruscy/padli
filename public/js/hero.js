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
  // 1️⃣ Aktív szavazások
  const pollRes = await fetch("/api/polls/active");
  const polls = pollRes.ok ? await pollRes.json() : [];

  // csak amire még nem szavazott
  const openPolls = polls.filter(p => !p.voted);

  // poll slide objektumok
  const pollSlides = openPolls.map(p => ({
    type: "poll",
    id: p.id,
    title: p.title,
    description: "Aktív szavazás — kattints és szavazz!",
    slug: null
  }));

  // 2️⃣ Featured mangák
  const res = await fetch("/api/featured");
  const featured = res.ok ? await res.json() : [];

  const mangaSlides = featured.map(m => ({
    type: "manga",
    ...m
  }));

  slides = [...pollSlides, ...mangaSlides];

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

    if (item.type === "poll") {

      heroInner.innerHTML = `
        <div class="hero-poll">
          <h2>🗳️ ${item.title}</h2>
          <p>${item.description}</p>
          <a href="/polls.html" class="hero-btn poll-btn">
            Szavazok
          </a>
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

})();
