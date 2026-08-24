/* padlicrome/download.js – Letöltés és ZIP */

import { state } from "./app.js?v=20260810";

const API = "/api/padlicrome";

/* ── ZIP LETÖLTÉS ────────────────────────────────────────── */
export async function downloadAllZip() {
  const translated = (state.project?.images || []).filter(i => i.translated);
  if (!translated.length) {
    alert("Nincs lefordított kép a letöltéshez.");
    return;
  }

  const btn = document.getElementById("pcZipBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ ZIP készítés..."; }

  try {
    // Dinamikusan betöltjük a JSZip-et ha kell (saját szerverről — a külső
    // CDN-t a CSP script-src blokkolta volna, "ZIP hiba: undefined"-et okozva)
    if (!window.JSZip) {
      await loadScript("/js/vendor/jszip.min.js?v=20260824");
    }

    const zip = new JSZip();

    for (let i = 0; i < translated.length; i++) {
      const img = translated[i];
      if (btn) btn.textContent = `⏳ ${i + 1}/${translated.length}...`;

      const resp = await fetch(`${API}/image/translated/${img.filename}`, { credentials: "include" });
      if (!resp.ok) continue;
      const blob = await resp.blob();
      // Természetes sorrend szerinti fájlnév
      const num = String(i + 1).padStart(3, "0");
      zip.file(`forditas_${num}.jpg`, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = "forditas.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert("ZIP hiba: " + (err?.message || "nem sikerült betölteni a ZIP-készítő könyvtárat, próbáld frissíteni az oldalt"));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📦 ZIP letöltés"; }
  }
}

/* ── SCRIPT BETÖLTÉS ─────────────────────────────────────── */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
