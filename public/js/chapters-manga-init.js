let currentManga = null;

(async () => {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) return;

  const mRes = await fetch(`/api/manga/${slug}`);
  currentManga = await mRes.json();

  document.getElementById("mangaTitle").textContent = currentManga.title;
  document.getElementById("coverImg").src = currentManga.cover_url || "/assets/no-cover.png";
  document.getElementById("description").innerHTML = DOMPurify.sanitize(
    currentManga.description || "",
    { ALLOWED_TAGS: ["br","b","i","em","strong","p","a"], ALLOWED_ATTR: ["href"] }
  );

  const infoBar = document.getElementById("mangaInfoBar");
  if (currentManga.status) {
    const s = STATUS_HU[currentManga.status] || { label: currentManga.status, cls: "" };
    const badge = document.createElement("span");
    badge.className = `manga-badge badge-status ${s.cls}`;
    badge.textContent = s.label;
    infoBar.appendChild(badge);
  }
  if (currentManga.average_score) {
    const badge = document.createElement("span");
    badge.className = "manga-badge badge-score";
    badge.textContent = `⭐ ${(currentManga.average_score/10).toFixed(1)}/10`;
    infoBar.appendChild(badge);
  }
  if (currentManga.total_chapters) {
    const badge = document.createElement("span");
    badge.className = "manga-badge badge-chapters";
    badge.textContent = `📚 ${currentManga.total_chapters} fejezet`;
    infoBar.appendChild(badge);
  }

  const genresEl = document.getElementById("genres");
  genresEl.innerHTML = "";
  (currentManga.genres || []).forEach(g => {
    const s = document.createElement("span");
    s.className = "genre-tag";
    s.textContent = g;
    genresEl.appendChild(s);
  });

  const tagsEl = document.getElementById("tags");
  tagsEl.innerHTML = "";
  (currentManga.tags || []).forEach(t => {
    const s = document.createElement("span");
    s.className = "tag-item";
    s.textContent = t;
    tagsEl.appendChild(s);
  });
 // FORDÍTÓ
  if (currentManga.uploaders?.length) {
    const uploaderBar = document.createElement("div");
    uploaderBar.style.cssText = "margin-bottom:0.5rem; font-size:0.85rem; color:#aaa; display:flex; align-items:center; gap:6px;";
    uploaderBar.innerHTML = `
      🎌 Fordító:
      ${currentManga.uploaders.map(u =>
        `<span style="background:#1a2e1a; color:#86efac; font-weight:600; padding:2px 10px; border-radius:999px; font-size:0.78rem;">${u}</span>`
      ).join("")}
    `;
    const infoBar = document.getElementById("mangaInfoBar");
    infoBar.parentNode.insertBefore(uploaderBar, infoBar);
  }


   try {
    const recRes = await fetch(`/api/manga/${slug}/recommendations`);
    const recs = await recRes.json();
    const recGrid = document.getElementById("recGrid");
    recGrid.innerHTML = "";
    if (!recs.length) {
      recGrid.innerHTML = "<p class='rec-empty'>Nincs ajánlott mű.</p>";
    } else {
      recs.forEach(r => {
        const card = document.createElement("a");
        card.className = "rec-card";
        card.href = r.local_slug ? `/chapters.html?slug=${encodeURIComponent(r.local_slug)}` : "#";
        if (!r.local_slug) { card.classList.add("rec-card-no-link"); card.title = "Nincs meg nálunk"; }
        const img = document.createElement("img");
        img.src = r.cover_url || "/assets/no-cover.png";
        img.loading = "lazy";
        const title = document.createElement("div");
        title.className = "rec-card-title";
        title.textContent = r.title || "—";
        card.append(img, title);
        recGrid.appendChild(card);
      });
    }
  } catch {}
})();
