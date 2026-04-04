/* ===== MANGA EDIT MODAL ===== */

let editSlug = null;
let editGenres = [];
let editTags = [];
let editUploaders = [];
let allUploaders = [];
let allGenres = [];
let allTags = [];
let originalAnilistId = null;
let anilistDebounce = null;

async function initMangaEdit(slug, manga) {
  editSlug = slug;
  editGenres = [...(manga.genres || [])];
  editTags = [...(manga.tags || [])];
  editUploaders = [...(manga.uploaders || [])];
  originalAnilistId = manga.anilist_id || null;

  // Feltöltők listája
  try {
    const r = await fetch("/api/admin/uploaders");
    if (r.ok) allUploaders = await r.json();
  } catch {}

  // Összes genre és tag a datalist-hez
  try {
    const r = await fetch("/api/manga-list");
    if (r.ok) {
      const data = await r.json();
      const genreSet = new Set();
      const tagSet = new Set();
      Object.values(data).forEach(m => {
        (m.genres || []).forEach(g => genreSet.add(g));
        (m.tags || []).forEach(t => tagSet.add(t));
      });
      allGenres = [...genreSet].sort();
      allTags = [...tagSet].sort();
    }
  } catch {}

  renderEditModal(manga);
  document.getElementById("mangaEditModal").classList.remove("hidden");
}

function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeHtmlEdit(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderEditModal(manga) {
  const existing = document.getElementById("mangaEditModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "mangaEditModal";
  modal.className = "manga-edit-modal";

  modal.innerHTML = `
    <div class="manga-edit-backdrop" id="mangaEditBackdrop"></div>
    <div class="manga-edit-box">
      <div class="manga-edit-title">
        ✏️ Manga szerkesztése
        <button class="manga-edit-close" id="mangaEditClose">✕</button>
      </div>

      <div class="manga-edit-section">
        <div class="manga-edit-section-title">Cím</div>
        <label class="manga-edit-label">Megjelenített cím</label>
        <input class="manga-edit-input" id="editTitle" value="${escapeAttr(manga.title || "")}">
      </div>

      <div class="manga-edit-section">
        <div class="manga-edit-section-title">Borítókép</div>
        <div class="manga-edit-cover-row">
          <img id="editCoverPreview" class="manga-edit-cover-preview"
            src="${escapeAttr(manga.cover_url || '/assets/no-cover.png')}">
          <div class="manga-edit-cover-inputs">
            <label class="manga-edit-label">Külső URL</label>
            <input class="manga-edit-input" id="editCoverUrl"
              placeholder="https://..." value="${escapeAttr(manga.cover_url || "")}">
            <label class="manga-edit-label" style="margin-top:8px;">Vagy feltöltés</label>
            <label class="manga-edit-upload-btn">
              📁 Fájl kiválasztása
              <input type="file" id="editCoverFile" accept="image/*" style="display:none">
            </label>
            <div id="editCoverFileName" style="font-size:0.75rem; color:#aaa;"></div>
          </div>
        </div>
      </div>

      <div class="manga-edit-section">
        <div class="manga-edit-section-title">Leírás</div>
        <textarea class="manga-edit-textarea" id="editDescription" rows="6">${escapeHtmlEdit(manga.description || "")}</textarea>
      </div>

      <div class="manga-edit-section">
        <div class="manga-edit-section-title">Műfajok (Genre)</div>
        <div class="manga-edit-chips" id="editGenreChips"></div>
        <div class="manga-edit-add-row">
          <input class="manga-edit-input" id="editGenreInput"
            placeholder="Új műfaj..." list="genreSuggestions">
          <datalist id="genreSuggestions"></datalist>
          <button class="manga-edit-add-btn" id="addGenreBtn">+ Hozzáad</button>
        </div>
      </div>

      <div class="manga-edit-section">
        <div class="manga-edit-section-title">Tagek</div>
        <div class="manga-edit-chips" id="editTagChips"></div>
        <div class="manga-edit-add-row">
          <input class="manga-edit-input" id="editTagInput"
            placeholder="Új tag..." list="tagSuggestions">
          <datalist id="tagSuggestions"></datalist>
          <button class="manga-edit-add-btn" id="addTagBtn">+ Hozzáad</button>
        </div>
      </div>

      <div class="manga-edit-section">
        <div class="manga-edit-section-title">Feltöltők</div>
        <div class="manga-edit-chips" id="editUploaderChips"></div>
        <div class="manga-edit-add-row">
          <input class="manga-edit-input" id="editUploaderInput"
            placeholder="Feltöltő neve..." list="uploaderSuggestions">
          <datalist id="uploaderSuggestions"></datalist>
          <button class="manga-edit-add-btn" id="addUploaderBtn">+ Hozzáad</button>
        </div>
      </div>

      <div class="manga-edit-section">
        <div class="manga-edit-section-title">AniList összekötés</div>
        ${manga.anilist_id ? `
          <div class="manga-edit-anilist-connected">
            ✅ Összekötve – AniList ID: ${manga.anilist_id}
          </div>
        ` : `
          <div style="font-size:0.8rem; color:#f59e0b; margin-bottom:8px;">
            ⚠️ Nincs AniList összekötés
          </div>
        `}
        <label class="manga-edit-label">Új összekötés keresése</label>
        <input class="manga-edit-input" id="editAnilistSearch" placeholder="Cím keresése...">
        <div id="editAnilistResults" class="manga-edit-anilist-results" style="display:none;"></div>
        <input type="hidden" id="editAnilistId" value="${manga.anilist_id || ""}">
        <div id="editAnilistSelected" style="margin-top:8px; font-size:0.8rem; color:#86efac;"></div>
      </div>

      <div class="manga-edit-actions">
        <button class="manga-edit-cancel" id="mangaEditCancel">❌ Mégse</button>
        <button class="manga-edit-save" id="mangaEditSave">💾 Mentés</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  document.getElementById("mangaEditClose").addEventListener("click", closeMangaEdit);
  document.getElementById("mangaEditCancel").addEventListener("click", closeMangaEdit);
  document.getElementById("mangaEditBackdrop").addEventListener("click", closeMangaEdit);
  document.getElementById("mangaEditSave").addEventListener("click", saveMangaEdit);

  document.getElementById("editCoverUrl").addEventListener("input", (e) => {
    document.getElementById("editCoverPreview").src = e.target.value || "/assets/no-cover.png";
  });

  document.getElementById("editCoverFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById("editCoverFileName").textContent = file.name;
    document.getElementById("editCoverPreview").src = URL.createObjectURL(file);
    document.getElementById("editCoverUrl").value = "";
  });

  document.getElementById("addGenreBtn").addEventListener("click", addEditGenre);
  document.getElementById("editGenreInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEditGenre();
  });

  document.getElementById("addTagBtn").addEventListener("click", addEditTag);
  document.getElementById("editTagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEditTag();
  });

  document.getElementById("addUploaderBtn").addEventListener("click", addEditUploader);
  document.getElementById("editUploaderInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEditUploader();
  });

  document.getElementById("editAnilistSearch").addEventListener("input", (e) => {
    clearTimeout(anilistDebounce);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById("editAnilistResults").style.display = "none";
      return;
    }
    anilistDebounce = setTimeout(() => searchAnilistEdit(q), 400);
  });

  // Datalist feltöltése
  const genreDatalist = document.getElementById("genreSuggestions");
  allGenres.forEach(g => {
    if (!editGenres.includes(g)) {
      const opt = document.createElement("option");
      opt.value = g;
      genreDatalist.appendChild(opt);
    }
  });

  const tagDatalist = document.getElementById("tagSuggestions");
  allTags.forEach(t => {
    if (!editTags.includes(t)) {
      const opt = document.createElement("option");
      opt.value = t;
      tagDatalist.appendChild(opt);
    }
  });

  const uploaderDatalist = document.getElementById("uploaderSuggestions");
  allUploaders.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    uploaderDatalist.appendChild(opt);
  });

  renderEditChips();
}

function renderEditChips() {
  const genreEl = document.getElementById("editGenreChips");
  if (genreEl) {
    genreEl.innerHTML = editGenres.map(g => `
      <span class="manga-edit-chip genre">
        ${escapeHtmlEdit(g)}
        <button class="manga-edit-chip-remove" data-genre="${escapeAttr(g)}">✕</button>
      </span>
    `).join("");
    genreEl.querySelectorAll("[data-genre]").forEach(btn => {
      btn.addEventListener("click", () => {
        editGenres = editGenres.filter(x => x !== btn.dataset.genre);
        renderEditChips();
      });
    });
  }

  const tagEl = document.getElementById("editTagChips");
  if (tagEl) {
    tagEl.innerHTML = editTags.map(t => `
      <span class="manga-edit-chip tag">
        ${escapeHtmlEdit(t)}
        <button class="manga-edit-chip-remove" data-tag="${escapeAttr(t)}">✕</button>
      </span>
    `).join("");
    tagEl.querySelectorAll("[data-tag]").forEach(btn => {
      btn.addEventListener("click", () => {
        editTags = editTags.filter(x => x !== btn.dataset.tag);
        renderEditChips();
      });
    });
  }

  const uplEl = document.getElementById("editUploaderChips");
  if (uplEl) {
    uplEl.innerHTML = editUploaders.map(u => `
      <span class="manga-edit-chip uploader">
        ${escapeHtmlEdit(u)}
        <button class="manga-edit-chip-remove" data-uploader="${escapeAttr(u)}">✕</button>
      </span>
    `).join("");
    uplEl.querySelectorAll("[data-uploader]").forEach(btn => {
      btn.addEventListener("click", () => {
        editUploaders = editUploaders.filter(x => x !== btn.dataset.uploader);
        renderEditChips();
      });
    });
  }
}

function addEditGenre() {
  const input = document.getElementById("editGenreInput");
  const val = input.value.trim();
  if (!val || editGenres.includes(val)) return;
  editGenres.push(val);
  input.value = "";
  renderEditChips();
}

function addEditTag() {
  const input = document.getElementById("editTagInput");
  const val = input.value.trim();
  if (!val || editTags.includes(val)) return;
  editTags.push(val);
  input.value = "";
  renderEditChips();
}

function addEditUploader() {
  const input = document.getElementById("editUploaderInput");
  const val = input.value.trim();
  if (!val || editUploaders.includes(val)) return;
  editUploaders.push(val);
  input.value = "";
  renderEditChips();

  if (!allUploaders.includes(val)) {
    fetch("/api/admin/uploaders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: val })
    });
  }
}

async function searchAnilistEdit(q) {
  const resultsEl = document.getElementById("editAnilistResults");
  resultsEl.style.display = "block";
  resultsEl.innerHTML = "<div style='padding:8px 12px; color:#aaa; font-size:0.8rem;'>Keresés...</div>";

  try {
    const res = await fetch(`/api/anilist/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!data.length) {
      resultsEl.innerHTML = "<div style='padding:8px 12px; color:#aaa; font-size:0.8rem;'>Nincs találat</div>";
      return;
    }

    resultsEl.innerHTML = "";
    data.forEach(m => {
      const item = document.createElement("div");
      item.className = "manga-edit-anilist-item";
      item.innerHTML = `
        <img src="${m.coverImage?.medium || ''}">
        <div class="manga-edit-anilist-item-info">
          <div class="manga-edit-anilist-item-title">${escapeHtmlEdit(m.title?.english || m.title?.romaji || "—")}</div>
          <div class="manga-edit-anilist-item-sub">${m.chapters || "?"} fejezet • ${m.status || ""}</div>
        </div>
      `;
      item.addEventListener("click", () => selectAnilistEdit(
        m.id,
        m.title?.english || m.title?.romaji || "",
        m.coverImage?.large || ""
      ));
      resultsEl.appendChild(item);
    });
  } catch {
    resultsEl.innerHTML = "<div style='padding:8px 12px; color:#fca5a5; font-size:0.8rem;'>Hiba a keresésben</div>";
  }
}

function selectAnilistEdit(id, title, coverUrl) {
  document.getElementById("editAnilistId").value = id;
  document.getElementById("editAnilistResults").style.display = "none";
  document.getElementById("editAnilistSearch").value = "";
  document.getElementById("editAnilistSelected").textContent = `✅ Kiválasztva: ${title} (ID: ${id})`;

  const currentCover = document.getElementById("editCoverUrl").value;
  if (!currentCover && coverUrl) {
    document.getElementById("editCoverUrl").value = coverUrl;
    document.getElementById("editCoverPreview").src = coverUrl;
  }
}

function closeMangaEdit() {
  const modal = document.getElementById("mangaEditModal");
  if (modal) modal.classList.add("hidden");
}

async function saveMangaEdit() {
  const saveBtn = document.getElementById("mangaEditSave");
  saveBtn.disabled = true;
  saveBtn.textContent = "⏳ Mentés...";

  try {
    const slug = editSlug;
    const title = document.getElementById("editTitle").value.trim();
    const description = document.getElementById("editDescription").value.trim();
    const anilistIdVal = document.getElementById("editAnilistId").value;
    const newAnilistId = anilistIdVal ? parseInt(anilistIdVal) : null;
    console.log("anilistIdVal:", anilistIdVal, "newAnilistId:", newAnilistId);

    // Csak akkor kérdezünk rá ha új AniList összekötés van
    const isNewAnilist = newAnilistId && newAnilistId !== originalAnilistId;
    if (isNewAnilist) {
      const confirmed = window.confirm(
        `Biztosan összeköted ezt a mangát az AniList ID ${newAnilistId} tartalmával?\nEz frissíti a borítót, leírást, státuszt és pontszámot.`
      );
      if (!confirmed) {
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Mentés";
        return;
      }
    }

    let coverUrl = document.getElementById("editCoverUrl").value.trim() || null;
    const fileInput = document.getElementById("editCoverFile");

    if (fileInput.files.length > 0) {
      const formData = new FormData();
      formData.append("cover", fileInput.files[0]);
      const uploadRes = await fetch(`/api/admin/manga/${slug}/cover`, {
        method: "POST",
        body: formData
      });
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        coverUrl = uploadData.cover_url;
        document.getElementById("editCoverPreview").src = coverUrl;
      }
    }

    const res = await fetch(`/api/admin/manga/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title || null,
        cover_url: coverUrl,
        description: description || null,
        genres: editGenres,
        tags: editTags,
        uploaders: editUploaders,
        anilist_id: newAnilistId,
        refresh_metadata: isNewAnilist
      })
    });

    if (!res.ok) {
      alert("❌ Mentés sikertelen");
      return;
    }

    // Ha új AniList összekötés → metadata frissítés
    if (isNewAnilist) {
      saveBtn.textContent = "⏳ Metadatok frissítése...";
      try {
        await fetch(`/api/admin/manga/${slug}/refresh-metadata`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anilist_id: newAnilistId })
        });
      } catch {}
    }

    // Oldal frissítése
    if (title) document.getElementById("mangaTitle").textContent = title;
    if (coverUrl) document.getElementById("coverImg").src = coverUrl;
    if (description) document.getElementById("description").innerHTML = description;

    const genresEl = document.getElementById("genres");
    if (genresEl) {
      genresEl.innerHTML = editGenres.map(g =>
        `<span class="genre-tag">${escapeHtmlEdit(g)}</span>`
      ).join("");
    }

    const tagsEl = document.getElementById("tags");
    if (tagsEl) {
      tagsEl.innerHTML = editTags.map(t =>
        `<span class="tag-item">${escapeHtmlEdit(t)}</span>`
      ).join("");
    }

    closeMangaEdit();

    if (isNewAnilist) {
      alert("✅ Metadatok frissítve! Az oldal újratöltésével látod a változásokat.");
      location.reload();
    }

  } catch (err) {
    console.error("EDIT ERROR:", err);
    alert("❌ Hiba történt");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 Mentés";
  }
}
