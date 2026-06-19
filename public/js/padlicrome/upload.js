/* padlicrome/upload.js – Feltöltés kezelés */

import { api, showStatus, state } from "./app.js";
import { loadProject } from "./gallery.js";

const MAX_IMAGES = 30;

/* ── TAB VÁLTÁS ──────────────────────────────────────────── */
export function initUploadTabs() {
  document.querySelectorAll(".pc-upload-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".pc-upload-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById("pcUploadFile").style.display = target === "file" ? "block" : "none";
      document.getElementById("pcUploadUrl").style.display = target === "url" ? "block" : "none";
    });
  });
}

/* ── FÁJL FELTÖLTÉS ──────────────────────────────────────── */
export function initDropzone() {
  const dz = document.getElementById("pcDropzone");
  const input = document.getElementById("pcFileInput");
  if (!dz || !input) return;

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/"));
    if (files.length) uploadFiles(files);
  });

  input.addEventListener("change", () => {
    if (input.files.length) uploadFiles([...input.files]);
    input.value = "";
  });
}

export async function uploadFiles(files) {
  const project = state.project;
  const current = project?.images?.length || 0;
  const available = MAX_IMAGES - current;

  if (available <= 0) {
    showStatus(`Maximum ${MAX_IMAGES} kép engedélyezett. Töröl néhányat először.`, "warn");
    return;
  }

  const toUpload = files.slice(0, available);
  if (files.length > available) {
    showStatus(`Csak ${available} képet töltöttünk fel (maximum ${MAX_IMAGES}).`, "warn");
  }

  const form = new FormData();
  toUpload.forEach(f => form.append("images", f));

  showStatus(`⏳ Feltöltés... (${toUpload.length} kép)`, "info");

  try {
    const data = await api("POST", "/upload", form, true);
    showStatus(`✅ ${data.added.length} kép feltöltve!`, "success");
    await loadProject();
  } catch (err) {
    showStatus(`❌ Feltöltési hiba: ${err.message}`, "error");
  }
}

/* ── URL FELTÖLTÉS ───────────────────────────────────────── */
export function initUrlUpload() {
  const btn = document.getElementById("pcUrlUploadBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const textarea = document.getElementById("pcUrlInput");
    const raw = textarea?.value?.trim() || "";
    if (!raw) return;

    const urls = raw.split("\n").map(u => u.trim()).filter(u => u.startsWith("http"));
    if (!urls.length) { showStatus("Nem található érvényes URL", "warn"); return; }

    const project = state.project;
    const current = project?.images?.length || 0;
    const available = MAX_IMAGES - current;

    if (available <= 0) {
      showStatus(`Maximum ${MAX_IMAGES} kép engedélyezett.`, "warn");
      return;
    }

    if (urls.length > available) {
      // Felajánlás: le lehessen tölteni, vagy az exe
      showTooManyModal(urls, available);
      return;
    }

    btn.disabled = true;
    showStatus(`⏳ Letöltés... (${urls.length} URL)`, "info");

    try {
      const data = await api("POST", "/upload-url", { urls });
      let msg = `✅ ${data.added.length} kép letöltve!`;
      if (data.errors.length) msg += ` (${data.errors.length} hiba)`;
      showStatus(msg, data.errors.length ? "warn" : "success");
      if (textarea) textarea.value = "";
      await loadProject();
    } catch (err) {
      showStatus(`❌ Letöltési hiba: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

/* ── TÚL SOK KÉP MODAL ───────────────────────────────────── */
function showTooManyModal(urls, available) {
  const modal = document.getElementById("pcTooManyModal");
  if (!modal) return;

  const info = document.getElementById("pcTooManyInfo");
  if (info) {
    info.innerHTML = `
      <p>Összesen <strong>${urls.length}</strong> URL-t adtál meg, de csak <strong>${available}</strong> fér még a projektbe (maximum 30).</p>
      <p>Lehetőségeid:</p>
    `;
  }

  // Ha előfizető: összefűzés ajánlat
  const subOffer = document.getElementById("pcTooManySubOffer");
  if (subOffer) {
    subOffer.style.display = state.subscriber ? "block" : "none";
  }

  modal.style.display = "flex";

  // Letöltés gomb
  document.getElementById("pcTooManyDownload")?.addEventListener("click", () => {
    const blob = new Blob([urls.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kepek-urljai.txt";
    a.click();
    modal.style.display = "none";
  }, { once: true });

  // Exe letöltés
  document.getElementById("pcTooManyExe")?.addEventListener("click", () => {
    window.open("https://padlizsanfansub.hu/downloads/Padli-Keposszefu.exe", "_blank");
    modal.style.display = "none";
  }, { once: true });

  // Csak az első available-t töltjük
  document.getElementById("pcTooManyFirst")?.addEventListener("click", async () => {
    modal.style.display = "none";
    const toUpload = urls.slice(0, available);
    const btn = document.getElementById("pcUrlUploadBtn");
    if (btn) btn.disabled = true;
    showStatus(`⏳ Letöltés... (${toUpload.length} URL)`, "info");
    try {
      const data = await api("POST", "/upload-url", { urls: toUpload });
      showStatus(`✅ ${data.added.length} kép letöltve!`, "success");
      const textarea = document.getElementById("pcUrlInput");
      if (textarea) textarea.value = "";
      await loadProject();
    } catch (err) {
      showStatus(`❌ Letöltési hiba: ${err.message}`, "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }, { once: true });

  document.getElementById("pcTooManyClose")?.addEventListener("click", () => {
    modal.style.display = "none";
  }, { once: true });
}
