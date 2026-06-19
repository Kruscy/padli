const STATUS_HU = {
  RELEASING:        { label: "Folyamatban", cls: "releasing" },
  FINISHED:         { label: "Befejezett",  cls: "finished"  },
  HIATUS:           { label: "Szünetel",    cls: "hiatus"    },
  CANCELLED:        { label: "Megszakadt",  cls: "cancelled" },
  NOT_YET_RELEASED: { label: "Hamarosan",  cls: "hiatus"    },
};

document.querySelectorAll(".chapters-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chapters-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".chapters-tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

function parseChapterNumber(str) {
  const m = str.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : Infinity;
}

(async () => {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) return;

  let progress = null;
  try {
    const r = await fetch(`/api/progress/${slug}`);
    if (r.ok) progress = await r.json();
  } catch {}

  try {
    const res = await fetch(`/api/chapters/${slug}`);
    const data = await res.json();
    let chapters = data.chapters;
    chapters.sort((a, b) => parseChapterNumber(a.folder) - parseChapterNumber(b.folder));
    const list = document.getElementById("chapters");
    list.innerHTML = "";
    chapters.forEach(ch => {
      const row = document.createElement("a");
      row.className = "chapter-row";
      if (ch.locked) {
        ch._availableIn = ch.unlocks_at ? Math.ceil((new Date(ch.unlocks_at) - new Date()) / 3600000) : 0;
        row.href = "#";
        row.classList.add("locked");
        row.addEventListener("click", (e) => { e.preventDefault(); showLockedModal(); });
      } else {
        row.href = `/reader.html?slug=${slug}&chapter=${encodeURIComponent(ch.folder)}`;
      }
      const read = progress && progress.chapter === ch.folder;
      const status = document.createElement("span");
      status.className = `read ${read ? "yes" : "no"}`;
      status.textContent = ch.locked ? "🔒" : (read ? "✅" : "⬜");
      const title = document.createElement("span");
      title.className = "chapter-title";
      title.textContent = ch.folder;
      const date = document.createElement("span");
      date.className = "scan-date";
      if (ch.locked && ch.unlocks_at) {
        date.textContent = ch._availableIn > 0 ? `⏳ ${ch._availableIn} óra múlva` : "Hamarosan";
        date.style.color = "#f59e0b";
      } else if (ch.scanned_at) {
        date.textContent = new Date(ch.scanned_at).toISOString().slice(0, 10);
      } else {
        date.textContent = "—";
      }
      row.append(status, title, date);
      list.appendChild(row);
    });
  } catch (e) {
    console.error("Chapter load error", e);
  }
})();
