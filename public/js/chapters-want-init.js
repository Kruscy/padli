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
        continueBtn.classList.remove("hidden");
        continueBtn.href = `/reader.html?slug=${slug}&chapter=${p.chapter}&page=${p.page}`;
        deleteProgressBtn.classList.remove("hidden");
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
