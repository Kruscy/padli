document.addEventListener("DOMContentLoaded", async () => {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) return;
  const wantBtn = document.getElementById("wantBtn");
  const continueBtn = document.getElementById("continueBtn");
  const deleteProgressBtn = document.getElementById("deleteProgressBtn");

  try {
    const r = await fetch(`/api/want/${slug}`);
    if (r.ok) {
      const d = await r.json();
      wantBtn.textContent = d.wanted ? "⭐ Fent van a polcon" : "☆ Fel a polcra";
    }
  } catch {}

  wantBtn.addEventListener("click", async () => {
    const r = await fetch(`/api/want/${slug}`, { method: "POST" });
    if (!r.ok) return;
    const d = await r.json();
    wantBtn.textContent = d.wanted ? "⭐ Fent van a polcon" : "☆ Fel a polcra";
  });

  try {
    const r = await fetch(`/api/progress/${slug}`);
    if (r.ok) {
      const p = await r.json();
      if (p) {
        // A gyorsnavigáció a legmagasabb olvasott fejezet alapján ajánlja a
        // folytatást, nem az utoljára megnyitottén — ha a user visszalapozott
        // egy korábbi fejezethez, ne oda vigye vissza "folytatásként".
        const target = p.highest_chapter || p.chapter;
        const targetPage = target === p.chapter ? p.page : 1;
        continueBtn.classList.remove("hidden");
        continueBtn.href = `/reader.html?slug=${encodeURIComponent(slug)}&chapter=${encodeURIComponent(target)}&page=${encodeURIComponent(targetPage)}`;
        deleteProgressBtn.classList.remove("hidden");

        if (p.highest_chapter) {
          const badge = document.createElement("span");
          badge.className = "manga-badge badge-progress";
          badge.textContent = `📖 Eddig olvasva: ${p.highest_chapter}`;
          document.getElementById("mangaInfoBar")?.appendChild(badge);
        }
      }
    }
  } catch {}

  deleteProgressBtn.addEventListener("click", async () => {
    if (!confirm("Biztosan törlöd a könyvjelzőt?")) return;
    const r = await fetch(`/api/progress/${slug}`, { method: "DELETE" });
    if (r.ok) {
      continueBtn.classList.add("hidden");
      deleteProgressBtn.classList.add("hidden");
    }
  });
});
