/* padlicrome/gallery.js - Galéria kezelés */

import { api, state, showStatus, updatePointsDisplay } from "./app.js";

const API = "/api/padlicrome";

/* ── PROJEKT BETÖLTÉS ────────────────────────────────────── */
export async function loadProject() {
  try {
    const project = await api("GET", "/project");
    state.project = project;
    renderGallery();
    updateTranslateBar();
    updateDownloadPanel();
  } catch (err) {
    console.error("Projekt betöltési hiba:", err);
  }
}

/* ── GALÉRIA RENDER ──────────────────────────────────────── */
export function renderGallery() {
  const gallery = document.getElementById("pcGallery");
  const countEl = document.getElementById("pcImageCount");
  const activeEl = document.getElementById("pcActiveCount");
  if (!gallery) return;

  const images = state.project?.images || [];

  if (countEl) countEl.textContent = images.length;
  if (activeEl) activeEl.textContent = images.filter(i => i.active).length;

  if (!images.length) {
    gallery.innerHTML = `
      <div class="pc-empty" style="grid-column:1/-1">
        <div class="pc-empty-icon">🖼️</div>
        <p>Még nincs kép. Tölts fel képeket vagy adj meg URL-eket!</p>
      </div>`;
    return;
  }

  gallery.innerHTML = "";
  images.forEach((img, idx) => {
    const card = document.createElement("div");
    const isActive = img.active !== false;
    const isTranslated = img.translated;
    const isTranslating = img.translating;
    const isMerged = img.merged;

    let statusBadge = "";
    if (isTranslating) statusBadge = `<div class="pc-img-status translating">⏳</div>`;
    else if (isTranslated) statusBadge = `<div class="pc-img-status translated">✅</div>`;
    else if (isMerged) statusBadge = `<div class="pc-img-status merged">🔗</div>`;

    card.className = `pc-img-card ${isActive ? "active" : "inactive"} ${isTranslated ? "translated" : ""} ${isTranslating ? "translating" : ""}`;
    card.dataset.id = img.id;

    const bugLabel = img.bugFix
      ? `<div style="position:absolute;top:4px;left:4px;background:rgba(79,70,229,.85);color:#fff;font-size:.65rem;padding:2px 6px;border-radius:4px;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${img.bugFix.mangaTitle || img.bugFix.mangaSlug} · ${img.bugFix.chapter}</div>`
      : "";

    card.innerHTML = `
      <img src="${API}/image/originals/${img.filename}" loading="lazy" alt="${img.name}">
      ${statusBadge}
      ${bugLabel}
      <div class="pc-img-num">${idx + 1}</div>
      <div class="pc-img-overlay">
        <button class="pc-img-btn" data-action="toggle">
          ${isActive ? "🚫 Inaktiváld" : "✅ Aktiváld"}
        </button>
        <button class="pc-img-btn" data-action="view-orig">🔍 Nagyítás</button>
        ${isTranslated ? `<button class="pc-img-btn" data-action="view-translated">✨ Fordított</button>` : ""}
        <button class="pc-img-btn danger" data-action="delete">🗑️ Törlés</button>
      </div>
    `;

    // Touch/kattintás: overlay megnyitás vagy gomb
    card.addEventListener("click", e => {
      const btn = e.target.closest("[data-action]");
      if (btn) {
        const action = btn.dataset.action;
        if (action === "toggle") toggleImage(img.id, !isActive);
        else if (action === "delete") deleteImage(img.id);
        else if (action === "view-translated") viewTranslated(img);
        else if (action === "view-orig") viewOrig(img);
        return;
      }
      // Kép vagy kártya kattintás → overlay toggle mobilon
      card.classList.toggle("overlay-open");
    });

    gallery.appendChild(card);
  });
}

/* ── AKTÍV/INAKTÍV ───────────────────────────────────────── */
export async function toggleImage(id, active) {
  try {
    await api("PATCH", `/image/${id}`, { active });
    const img = state.project.images.find(i => i.id === id);
    if (img) img.active = active;
    renderGallery();
    updateTranslateBar();
  } catch (err) {
    showStatus("Hiba: " + err.message, "error");
  }
}

export function toggleAll(active) {
  if (!state.project?.images?.length) return;
  state.project.images.forEach(img => {
    if (img.active !== active) toggleImage(img.id, active);
  });
}

/* ── TÖRLÉS ──────────────────────────────────────────────── */
export async function deleteImage(id) {
  try {
    await api("DELETE", `/image/${id}`);
    state.project.images = state.project.images.filter(i => i.id !== id);
    renderGallery();
    updateTranslateBar();
    updateDownloadPanel();
  } catch (err) {
    showStatus("Törlési hiba: " + err.message, "error");
  }
}

/* ── EREDETI KÉP MEGTEKINTÉS ─────────────────────────────── */
export function viewOrig(img) {
  const modal = document.getElementById("pcViewModal");
  const imgEl = document.getElementById("pcViewImg");
  const titleEl = document.getElementById("pcViewTitle");
  if (!modal || !imgEl) return;
  imgEl.src = `${API}/image/originals/${img.filename}`;
  if (titleEl) titleEl.textContent = "Eredeti kép";
  modal.style.display = "flex";
}

/* ── FORDÍTOTT KÉP MEGTEKINTÉS ───────────────────────────── */
export function viewTranslated(img) {
  const modal = document.getElementById("pcViewModal");
  const imgEl = document.getElementById("pcViewImg");
  const titleEl = document.getElementById("pcViewTitle");
  if (!modal || !imgEl) return;
  imgEl.src = `${API}/image/translated/${img.filename}`;
  if (titleEl) titleEl.textContent = "Fordított kép";
  modal.style.display = "flex";
}

/* ── TRANSLATE BAR FRISSÍTÉS ─────────────────────────────── */
export function updateTranslateBar() {
  const images = state.project?.images || [];
  const active = images.filter(i => i.active !== false);
  const translated = active.filter(i => i.translated);
  const remaining = active.length - translated.length;

  const infoEl = document.getElementById("pcTranslateInfo");
  if (infoEl) {
    infoEl.innerHTML = `<strong>${remaining}</strong> kép fordítandó · ${state.points} pont elérhető`;
  }

  const btn = document.getElementById("pcTranslateBtn");
  if (btn) {
    btn.disabled = remaining === 0 || state.translating;
    btn.textContent = state.translating ? "⏳ Fordítás..." : "▶ Fordítás indítása";
  }

  // Progress bar
  if (active.length > 0) {
    const pct = Math.round(translated.length / active.length * 100);
    const fill = document.getElementById("pcProgressFill");
    const label = document.getElementById("pcProgressLabel");
    if (fill) fill.style.width = pct + "%";
    if (label) label.textContent = `${translated.length} / ${active.length}`;
    document.getElementById("pcProgressWrap")?.style.setProperty("display", "block");
  } else {
    document.getElementById("pcProgressWrap")?.style.setProperty("display", "none");
  }
}

/* ── DOWNLOAD PANEL ──────────────────────────────────────── */
export function updateDownloadPanel() {
  const list = document.getElementById("pcDownloadList");
  if (!list) return;

  const translated = (state.project?.images || []).filter(i => i.translated);
  if (!translated.length) {
    list.innerHTML = '<div class="pc-empty" style="padding:20px"><p>Még nincs lefordított kép</p></div>';
    return;
  }

  list.innerHTML = "";
  translated.forEach(img => {
    const item = document.createElement("div");
    item.className = "pc-download-item";
    item.innerHTML = `
      <img src="${API}/image/translated/${img.filename}" alt="">
      <span class="pc-download-item-name">${img.name}</span>
      <a href="${API}/download/translated/${img.filename}" download class="pc-btn pc-btn-sm pc-btn-secondary">⬇️</a>
    `;
    list.appendChild(item);
  });
}
