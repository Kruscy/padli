(async () => {
  const grid = document.getElementById("grid");
  if (!grid) return;

  /* ===== WANT TO READ LISTA ===== */
  let mangas = [];
  try {
    const res = await fetch("/api/want");
    if (!res.ok) return;
    mangas = await res.json();
  } catch (e) {
    console.error("Want list load error", e);
    return;
  }

  grid.innerHTML = "";

  /* ===== PROGRESS MAP ===== */
  const progressMap = {};

  await Promise.all(
    mangas.map(async (m) => {
      try {
        const r = await fetch(`/api/progress/${m.slug}`);
        if (!r.ok) return;
        const p = await r.json();
        if (p && p.chapter) {
          progressMap[m.slug] = p;
        }
      } catch {}
    })
  );

  /* ===== RENDER ===== */
  mangas.forEach(m => {
    const card = document.createElement("div");
    card.className = "card";

    /* --- COVER --- */
    const cover = document.createElement("div");
    cover.className = "cover";

    const img = document.createElement("img");
    img.src = m.cover_url || "/assets/no-cover.png";
    img.loading = "lazy";

    cover.appendChild(img);

    // kattintás a képre
    cover.addEventListener("click", () => {
      const p = progressMap[m.slug];
      if (p) {
        location.href =
          `/reader.html?slug=${encodeURIComponent(m.slug)}` +
          `&chapter=${encodeURIComponent(p.chapter)}` +
          `&page=${p.page}`;
      } else {
        location.href = `/chapters.html?slug=${encodeURIComponent(m.slug)}`;
      }
    });

    // badge, ha van progress
    if (progressMap[m.slug]) {
      const badge = document.createElement("div");
      badge.className = "continue-badge";
      badge.textContent = "▶ Folytatás";
      cover.appendChild(badge);
    }

    /* --- TITLE --- */
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = m.title;

    title.addEventListener("click", () => {
      location.href = `/chapters.html?slug=${encodeURIComponent(m.slug)}`;
    });

    card.appendChild(cover);
    card.appendChild(title);
    grid.appendChild(card);
  });
})();
