/* padlicrome/translate.js – Fordítás queue */

import { api, state, showStatus, updatePointsDisplay } from "./app.js";
import { renderGallery, updateTranslateBar, updateDownloadPanel } from "./gallery.js";

/* ── FORDÍTÁS INDÍTÁSA ───────────────────────────────────── */
export async function startTranslation() {
  if (state.translating) return;

  const images = state.project?.images || [];
  const toTranslate = images.filter(i => i.active !== false && !i.translated);

  if (!toTranslate.length) {
    showStatus("Nincs fordítandó kép.", "info");
    return;
  }

  // Pont ellenőrzés
  if (state.points < 1) {
    showStatus("Nincs elég pontod a fordításhoz!", "error");
    return;
  }

  if (state.points < toTranslate.length) {
    // Figyelmeztetés: kevesebb pont mint kép
    showInsufficientPointsModal(toTranslate.length);
    return;
  }

  await runTranslation(toTranslate);
}

export async function startTranslationUntilEmpty() {
  const images = state.project?.images || [];
  const toTranslate = images.filter(i => i.active !== false && !i.translated);
  await runTranslation(toTranslate);
}

async function runTranslation(toTranslate) {
  state.translating = true;
  state.stopRequested = false;
  state.forceStop = false;

  showTranslateControls(true);
  updateTranslateBar();

  let translated = 0;
  let errors = 0;

  for (const img of toTranslate) {
    if (state.forceStop) {
      showStatus(`🛑 Force stop. ${translated} kép lefordítva.`, "warn");
      break;
    }

    if (state.stopRequested) {
      // Megvárjuk az aktuális képet (már elkezdtük), de utána megállunk
      showStatus(`⏹️ Megállítás folyamatban... (aktuális kép befejezése után)`, "warn");
    }

    // UI frissítés
    img.translating = true;
    renderGallery();

    try {
      const result = await api("POST", `/translate/${img.id}`);

      img.translating = false;
      img.translated = true;
      img.translatedAt = new Date().toISOString();
      state.points = result.pointsRemaining;
      updatePointsDisplay();

      translated++;
      renderGallery();
      updateTranslateBar();
      updateDownloadPanel();
      if (window._refreshBugFixPanel) window._refreshBugFixPanel();

      showStatus(`✅ ${translated}/${toTranslate.length} kép lefordítva (${state.points} pont maradt)`, "success");

    } catch (err) {
      img.translating = false;
      renderGallery();

      if (err.message.includes("Nincs elég pont")) {
        showStatus(`💸 Elfogytak a pontok! ${translated} kép lett lefordítva.`, "warn");
        break;
      }

      errors++;
      showStatus(`❌ Hiba (${img.name}): ${err.message}`, "error");
    }

    // Stop after current image
    if (state.stopRequested && !state.forceStop) {
      showStatus(`⏹️ Megállítva. ${translated} kép lefordítva.`, "info");
      break;
    }
  }

  if (!state.stopRequested && !state.forceStop && errors === 0) {
    showStatus(`✅ Kész! ${translated} kép lefordítva.`, "success");
  }

  state.translating = false;
  state.stopRequested = false;
  state.forceStop = false;

  showTranslateControls(false);
  updateTranslateBar();
}

/* ── STOP / FORCE STOP ───────────────────────────────────── */
export function requestStop() {
  if (!state.translating) return;
  state.stopRequested = true;
  document.getElementById("pcStopBtn")?.setAttribute("disabled", "true");
  document.getElementById("pcForceStopBtn")?.removeAttribute("disabled");
  showStatus("⏹️ Megállítás kérve... (aktuális kép befejezése után áll meg)", "warn");
}

export function requestForceStop() {
  if (!state.translating) return;
  state.forceStop = true;
  state.stopRequested = true;
  showStatus("🛑 Force stop – azonnal megáll!", "warn");
}

/* ── UI VEZÉRLŐK ─────────────────────────────────────────── */
function showTranslateControls(translating) {
  const startBtn = document.getElementById("pcTranslateBtn");
  const stopBtn  = document.getElementById("pcStopBtn");
  const forceBtn = document.getElementById("pcForceStopBtn");

  if (startBtn) startBtn.style.display = translating ? "none" : "inline-flex";
  if (stopBtn) {
    stopBtn.style.display = translating ? "inline-flex" : "none";
    stopBtn.removeAttribute("disabled");
  }
  if (forceBtn) {
    forceBtn.style.display = translating ? "inline-flex" : "none";
    forceBtn.setAttribute("disabled", "true");
  }
}

/* ── PONT FIGYELMEZTETÉS MODAL ───────────────────────────── */
function showInsufficientPointsModal(needed) {
  const modal = document.getElementById("pcPointsModal");
  if (!modal) return;

  const info = document.getElementById("pcPointsModalInfo");
  if (info) {
    info.innerHTML = `
      Összesen <strong>${needed}</strong> képet szeretnél lefordítani, de csak <strong>${state.points}</strong> pontod van.
      Ez azt jelenti, hogy csak az első <strong>${state.points}</strong> kép lesz lefordítva, aztán megáll.
    `;
  }

  modal.style.display = "flex";

  document.getElementById("pcPointsModalOk")?.addEventListener("click", async () => {
    modal.style.display = "none";
    const images = state.project?.images || [];
    const toTranslate = images.filter(i => i.active !== false && !i.translated);
    await runTranslation(toTranslate);
  }, { once: true });

  document.getElementById("pcPointsModalCancel")?.addEventListener("click", () => {
    modal.style.display = "none";
  }, { once: true });
}
