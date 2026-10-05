(async () => {
  try {
    const mangas = await (await fetch("/api/manga")).json();

    let totalManga = 0;
    let totalChapters = 0;
    let totalPages = 0;

    const recent = [];

    // Az összes olvasási állás egy kérésben (korábban mangánként egymás
    // után külön kérés — több száz kérés és lassú betöltés)
    let progressMap = {};
    const pr = await fetch("/api/progress/_all");
    if (pr.ok) progressMap = await pr.json();

    for (const m of mangas) {
      const p = progressMap[m.slug];
      if (!p) continue;

      totalManga++;
      totalChapters++;
      totalPages += (p.page || 0) + 1;

      recent.push({
        title: m.title,
        chapter: p.chapter,
        page: p.page,
        updated: p.updated_at
      });
    }

    recent.sort((a, b) =>
      new Date(b.updated) - new Date(a.updated)
    );

    document.getElementById("totalManga").textContent = totalManga;
    document.getElementById("totalChapters").textContent = totalChapters;
    document.getElementById("totalPages").textContent = totalPages;

    const list = document.getElementById("recentList");
    recent.slice(0, 5).forEach(r => {
      const li = document.createElement("li");
      li.textContent = `${r.title} – ${r.chapter}`;
      list.appendChild(li);
    });

  } catch (e) {
    console.error("Statisztika hiba:", e);
  }
})();
