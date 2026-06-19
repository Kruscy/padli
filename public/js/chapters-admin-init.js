document.addEventListener("DOMContentLoaded", async () => {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) return;
  const me = await fetch("/api/auth/me").then(r => r.ok ? r.json() : null);
  if (!me || me.role !== "admin") return;
  const editWrapper = document.getElementById("editWrapper");
  const editBtn = document.getElementById("editBtn");
  if (!editWrapper || !editBtn) return;
  editWrapper.classList.remove("hidden");
  editBtn.addEventListener("click", async () => {
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (currentManga) { clearInterval(check); resolve(); }
      }, 50);
    });
    initMangaEdit(slug, currentManga);
  });
});
