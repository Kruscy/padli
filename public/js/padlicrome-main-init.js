import { init, state, showStatus, startProjectFromUrl } from "/js/padlicrome/app.js";
import { initDropzone } from "/js/padlicrome/upload.js";
import { loadProject, renderGallery, toggleAll, updateTranslateBar } from "/js/padlicrome/gallery.js";
import { startTranslation, requestStop, requestForceStop } from "/js/padlicrome/translate.js";
import { openMergeModal } from "/js/padlicrome/merge.js";
import { downloadAllZip } from "/js/padlicrome/download.js";

window.startTranslation = startTranslation;
window.requestStop = requestStop;
window.requestForceStop = requestForceStop;
window.toggleAll = toggleAll;
window.openMergeModal = openMergeModal;
window.downloadAllZip = downloadAllZip;

window.newProject = () => {
  document.getElementById("pcNewProjectModal").style.display = "flex";
};

document.getElementById("pcNewProjectConfirm")?.addEventListener("click", async () => {
  document.getElementById("pcNewProjectModal").style.display = "none";
  try {
    await fetch("/api/padlicrome/project", { method: "DELETE", credentials: "include" });
    state.project = null;
    renderGallery();
    updateTranslateBar();
    document.getElementById("pcChapterUrl").value = "";
    showStatus("✅ Projekt törölve.", "success");
  } catch (err) {
    showStatus("❌ Törlési hiba: " + err.message, "error");
  }
});

document.getElementById("pcStartBtn")?.addEventListener("click", async () => {
  const url = document.getElementById("pcChapterUrl")?.value?.trim();
  if (!url) { showStatus("Add meg a chapter URL-t!", "warn"); return; }

  const btn = document.getElementById("pcStartBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Feldolgozás...";

  try {
    const result = await startProjectFromUrl(url);
    if (result) {
      document.getElementById("pcDownloadProgress").style.display = "block";
      await pollDownloadProgress();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Projekt indítása";
  }
});

async function pollDownloadProgress() {
  const fillEl = document.getElementById("pcDlProgressFill");
  const labelEl = document.getElementById("pcDlProgressLabel");
  while (true) {
    await new Promise(r => setTimeout(r, 1500));
    const project = await fetch("/api/padlicrome/project", { credentials: "include" }).then(r => r.json());
    if (!project) break;
    const total = project.totalFound || 1;
    const done = (project.images || []).length;
    const pct = Math.min(Math.round(done / Math.min(total, 30) * 100), 100);
    if (fillEl) fillEl.style.width = pct + "%";
    if (labelEl) labelEl.textContent = `${done} / ${Math.min(total, 30)} letöltve`;
    state.project = project;
    renderGallery();
    updateTranslateBar();
    if (project.status === "ready") {
      document.getElementById("pcDownloadProgress").style.display = "none";
      showStatus(`✅ ${done} kép kész a fordításra!`, "success");
      break;
    }
  }
}

await init();
initDropzone();
await loadProject();
checkAlreadyFixedImages();

if (state.subscriber) {
  document.getElementById("pcMergeBtn")?.removeAttribute("disabled");
  document.getElementById("pcMergeBadge")?.style.setProperty("display", "inline-flex");
} else {
  document.getElementById("pcMergeSubMsg")?.style.setProperty("display", "block");
}

async function checkAlreadyFixedImages() {
  try {
    const res = await fetch("/api/padlicrome/fix-status", { credentials: "include" });
    if (!res.ok) return;
    const { alreadyFixed } = await res.json();
    if (!alreadyFixed.length) return;

    const labels = alreadyFixed.map(f => `• ${f.label}`).join("\n");
    const remove = confirm(
      `⚠️ ${alreadyFixed.length} kép már javítva/lezárva:\n\n${labels}\n\nEltávolítod ezeket a sorból?`
    );
    if (!remove) return;

    for (const { imageId } of alreadyFixed) {
      await fetch(`/api/padlicrome/image/${imageId}`, { method: "DELETE", credentials: "include" });
      if (state.project?.images) {
        state.project.images = state.project.images.filter(i => i.id !== imageId);
      }
    }
    renderGallery();
    updateTranslateBar();
    renderBugFixPanel();
  } catch (_) {}
}

function renderBugFixPanel() {
  const isAdmin = state.role === "admin";
  const images  = (state.project?.images || []).filter(i => i.bugFix);
  const panel   = document.getElementById("pcBugFixPanel");
  const list    = document.getElementById("pcBugFixList");
  if (!panel || !list) return;

  if (!state.user) { panel.style.display = "none"; return; }
  if (!isAdmin && !images.length) { panel.style.display = "none"; return; }
  panel.style.display = "block";

  list.innerHTML = "";
  if (!images.length) {
    list.innerHTML = `<div style="font-size:.78rem;color:#555;padding:4px 0">Még nincs bug kép. A hibajegyeknél a 🔮 gombbal adj hozzá képeket.</div>`;
    document.getElementById("pcSubmitAllBtn").style.display = "none";
    return;
  }
  document.getElementById("pcSubmitAllBtn").style.display = "";

  images.forEach(img => {
    const bf = img.bugFix;
    const row = document.createElement("div");
    row.id = `bfrow_${img.id}`;
    row.style.cssText = "background:#120d20;border:1px solid #3b2f6e;border-radius:8px;padding:8px 10px;font-size:.8rem";

    const statusTxt = img.submittedAsFix
      ? `<span style="color:#86efac">✅ Elmentve</span>`
      : img.translated
        ? `<span style="color:#a78bfa">✨ Lefordítva</span>`
        : `<span style="color:#888">⏳ Fordítás szükséges</span>`;

    const reportLink = bf.reportId
      ? `<a href="/bug-reports.html?id=${bf.reportId}" target="_blank" style="color:#7c3aed;font-size:.75rem">↗ jegy</a>`
      : "";

    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div>
          <span style="color:#c4b5fd;font-weight:600">${img.bugFix.mangaTitle || bf.mangaSlug}</span>
          <span style="color:#666;margin:0 4px">·</span>
          <span style="color:#aaa">${bf.chapter}</span>
          <span style="color:#666;margin:0 4px">·</span>
          <span style="color:#888">#${bf.imageIndex ?? bf.imageFile ?? "?"}</span>
          ${reportLink}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${statusTxt}
          ${!img.submittedAsFix ? `<button data-imgid="${img.id}" class="bf-save-btn" style="background:#7c3aed;color:#fff;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:.78rem" id="bfbtn_${img.id}">💾 Mentés</button>` : ""}
        </div>
      </div>
      <div id="bfst_${img.id}" style="margin-top:4px;font-size:.75rem;color:#888"></div>`;
    list.appendChild(row);
  });

  list.querySelectorAll(".bf-save-btn").forEach(btn => {
    btn.addEventListener("click", () => submitOneBugFix(btn.dataset.imgid));
  });
}

window.submitOneBugFix = async function(imageId) {
  const btn = document.getElementById(`bfbtn_${imageId}`);
  const st  = document.getElementById(`bfst_${imageId}`);
  if (btn) { btn.disabled = true; btn.textContent = "⏳..."; }
  try {
    const res = await fetch("/api/padlicrome/submit-bug-fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ imageId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Hiba");
    const img = state.project?.images?.find(i => i.id === imageId);
    if (img) img.submittedAsFix = true;
    renderBugFixPanel();
  } catch (err) {
    if (st) st.textContent = "❌ " + err.message;
    if (btn) { btn.disabled = false; btn.textContent = "💾 Mentés"; }
  }
};

window.submitAllBugFixes = async function() {
  const pending = (state.project?.images || []).filter(i => i.bugFix && !i.submittedAsFix);
  const gst = document.getElementById("pcBugFixGlobalStatus");
  if (!pending.length) { if (gst) gst.textContent = "Nincs mentendő kép."; return; }
  if (gst) gst.textContent = `⏳ ${pending.length} kép mentése...`;
  let ok = 0, fail = 0;
  for (const img of pending) {
    try {
      const res = await fetch("/api/padlicrome/submit-bug-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ imageId: img.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      img.submittedAsFix = true;
      ok++;
    } catch { fail++; }
    renderBugFixPanel();
  }
  if (gst) gst.textContent = `✅ ${ok} elmentve${fail ? `, ❌ ${fail} hiba` : ""}`;
};

renderBugFixPanel();
window._refreshBugFixPanel = renderBugFixPanel;
