/* padlicrome/merge.js – Összefűzés (előfizető funkció) */

import { api, state, showStatus } from "./app.js?v=20260810";
import { loadProject } from "./gallery.js?v=20260810";

/* ── MERGE INDÍTÁSA ──────────────────────────────────────── */
export async function openMergeModal() {
  if (!state.subscriber) {
    showStatus("Az összefűzés csak előfizetőknek érhető el.", "warn");
    return;
  }

  const active = (state.project?.images || []).filter(i => i.active !== false && !i.merged);
  if (active.length < 2) {
    showStatus("Legalább 2 aktív képre van szükség az összefűzéshez.", "warn");
    return;
  }

  const modal = document.getElementById("pcMergeModal");
  if (!modal) return;

  // Képek listájának megjelenítése a modalban
  const list = document.getElementById("pcMergeList");
  if (list) {
    list.innerHTML = "";
    active.forEach((img, idx) => {
      const item = document.createElement("label");
      item.className = "pc-merge-item";
      item.innerHTML = `
        <input type="checkbox" value="${img.id}" checked>
        <img src="/api/padlicrome/image/originals/${img.filename}" alt="">
        <span>${idx + 1}. ${img.name}</span>
      `;
      list.appendChild(item);
    });
  }

  modal.style.display = "flex";

  document.getElementById("pcMergeConfirm")?.addEventListener("click", async () => {
    const checked = [...list.querySelectorAll("input:checked")].map(i => i.value);
    if (checked.length < 2) {
      showStatus("Legalább 2 képet válassz ki.", "warn");
      return;
    }
    modal.style.display = "none";
    await doMerge(checked);
  }, { once: true });

  document.getElementById("pcMergeCancel")?.addEventListener("click", () => {
    modal.style.display = "none";
  }, { once: true });
}

async function doMerge(imageIds) {
  showStatus("⏳ Összefűzés folyamatban...", "info");
  const btn = document.getElementById("pcMergeBtn");
  if (btn) btn.disabled = true;

  try {
    const result = await api("POST", "/merge", { imageIds });
    const n = result.images?.length ?? 0;
    let msg, kind;
    if (n === 0) {
      msg = `⚠️ Egyik kiválasztott kép sem fér bele párban sem a mérethatárba (túl magasak egyenként is) — nem sikerült összefűzni semmit, a képek változatlanok maradtak.`;
      kind = "warn";
    } else if (n > 1) {
      msg = `✅ Összefűzés kész! (${imageIds.length} képből ${n} lett — a mérethatár miatt automatikusan szétosztva)`;
      kind = "success";
    } else {
      const mergedCount = result.images[0]?.mergedFrom?.length || imageIds.length;
      msg = `✅ Összefűzés kész! (${mergedCount} képből 1 lett)`;
      kind = "success";
    }
    if (result.skipped?.length && n > 0) {
      msg += ` (${result.skipped.length} kép önmagában túl magas volt egy társhoz, változatlan maradt)`;
    }
    showStatus(msg, kind);
    await loadProject();
  } catch (err) {
    showStatus(`❌ Összefűzési hiba: ${err.message}`, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
