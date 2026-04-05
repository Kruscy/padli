/* admin-blog.js – Blog szerkesztő az admin panelen */

(function () {
  /* ── ÁLLAPOT ──────────────────────────────────────────── */
  let posts = [];
  let editingSlug = null; // null = új bejegyzés

  /* ── ELEMEK ───────────────────────────────────────────── */
  const postList       = document.getElementById("blogPostList");
  const formWrap       = document.getElementById("blogFormWrap");
  const formHeading    = document.getElementById("blogFormHeading");
  const previewPanel   = document.getElementById("blogPreviewPanel");
  const previewContent = document.getElementById("blogPreviewContent");
  const saveMsg        = document.getElementById("blogSaveMsg");
  const galleryModal   = document.getElementById("blogGalleryModal");
  const galleryGrid    = document.getElementById("blogGalleryGrid");

  /* ── INIT: csak ha a blog fül aktív ──────────────────── */
  document.querySelector('[data-tab="tab-blog"]')?.addEventListener("click", () => {
    if (!postList.dataset.loaded) {
      loadPosts();
      postList.dataset.loaded = "1";
    }
  });

  /* ── BEJEGYZÉSEK BETÖLTÉSE ────────────────────────────── */
  async function loadPosts() {
    postList.innerHTML = '<div class="blog-list-loading">Betöltés...</div>';
    try {
      const res = await fetch("/api/blog?all=1"); // admin: minden bejegyzés
      posts = res.ok ? await res.json() : [];
    } catch { posts = []; }
    renderList();
  }

  function renderList() {
    if (!posts.length) {
      postList.innerHTML = '<div class="blog-list-loading">Még nincs bejegyzés.</div>';
      return;
    }
    postList.innerHTML = "";
    posts.forEach(p => {
      const item = document.createElement("div");
      item.className = "blog-list-item" + (editingSlug === p.slug ? " active" : "");
      item.innerHTML = `
        ${p.cover_url
          ? `<img src="${p.cover_url}" class="blog-list-thumb" loading="lazy">`
          : `<div class="blog-list-thumb-placeholder">📝</div>`}
        <div class="blog-list-info">
          <h4>${esc(p.title)}</h4>
          <div class="blog-list-meta">
            <span class="blog-list-status ${p.published ? "status-published" : "status-draft"}">
              ${p.published ? "Közzétéve" : "Vázlat"}
            </span>
            <span>${formatDate(p.created_at)}</span>
            <span>${esc(p.category || "")}</span>
          </div>
        </div>
        <div class="blog-list-actions">
          <button class="blog-list-edit-btn" data-slug="${esc(p.slug)}">✏️ Szerkesztés</button>
          <button class="blog-list-del-btn"  data-slug="${esc(p.slug)}">🗑️</button>
        </div>
      `;
      item.querySelector(".blog-list-edit-btn").addEventListener("click", e => {
        e.stopPropagation();
        openEdit(p.slug);
      });
      item.querySelector(".blog-list-del-btn").addEventListener("click", e => {
        e.stopPropagation();
        deletePost(p.slug, p.title);
      });
      postList.appendChild(item);
    });
  }

  /* ── ÚJ BEJEGYZÉS ─────────────────────────────────────── */
  document.getElementById("blogNewBtn")?.addEventListener("click", () => {
    editingSlug = null;
    formHeading.textContent = "Új bejegyzés";
    clearForm();
    showForm();
  });

  /* ── SZERKESZTÉS MEGNYITÁSA ───────────────────────────── */
  async function openEdit(slug) {
    editingSlug = slug;
    formHeading.textContent = "Szerkesztés";

    try {
      const res = await fetch(`/api/blog/${encodeURIComponent(slug)}?admin=1`);
      if (!res.ok) throw new Error();
      const post = await res.json();
      fillForm(post);
    } catch {
      showMsg("Nem sikerült betölteni!", "err");
    }

    showForm();
    renderList();
  }

  function fillForm(post) {
    document.getElementById("bTitle").value    = post.title || "";
    document.getElementById("bSlug").value     = post.slug  || "";
    document.getElementById("bCategory").value = post.category || "hir";
    document.getElementById("bAuthor").value   = post.author || "";
    document.getElementById("bTags").value     = (post.tags || []).join(", ");
    document.getElementById("bExcerpt").value  = post.excerpt || "";
    document.getElementById("bPublished").checked = !!post.published;
    document.getElementById("blogContentEditor").innerHTML = post.content || "";
    setCover(post.cover_url || "");
    updatePreview();
  }

  function clearForm() {
    document.getElementById("bTitle").value    = "";
    document.getElementById("bSlug").value     = "";
    document.getElementById("bCategory").value = "hir";
    document.getElementById("bAuthor").value   = "";
    document.getElementById("bTags").value     = "";
    document.getElementById("bExcerpt").value  = "";
    document.getElementById("bPublished").checked = false;
    document.getElementById("blogContentEditor").innerHTML = "";
    document.getElementById("bCoverUrl").value = "";
    setCover("");
    saveMsg.textContent = "";
    saveMsg.className = "blog-save-msg";
  }

  function showForm() {
    formWrap.style.display = "block";
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── FORM BEZÁRÁS ─────────────────────────────────────── */
  document.getElementById("blogFormClose")?.addEventListener("click", () => {
    formWrap.style.display = "none";
    previewPanel.style.display = "none";
    editingSlug = null;
    renderList();
  });

  /* ── AUTO SLUG GENERÁLÁS ──────────────────────────────── */
  document.getElementById("bTitle")?.addEventListener("input", e => {
    if (editingSlug) return; // szerkesztésnél nem írjuk felül
    document.getElementById("bSlug").value = slugify(e.target.value);
  });

  function slugify(str) {
    return str.toLowerCase()
      .replace(/[áä]/g, "a").replace(/[éë]/g, "e").replace(/[íï]/g, "i")
      .replace(/[óöőô]/g, "o").replace(/[úüűû]/g, "u")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
  }

  /* ── TOOLBAR ──────────────────────────────────────────── */
  document.getElementById("editorToolbar")?.addEventListener("click", e => {
    const btn = e.target.closest("button[data-cmd]");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const editor = document.getElementById("blogContentEditor");
    editor.focus();

    if (cmd === "h2" || cmd === "h3") {
      document.execCommand("formatBlock", false, "<" + cmd + ">");
    } else if (cmd === "blockquote") {
      document.execCommand("formatBlock", false, "<blockquote>");
    } else if (cmd === "link") {
      const url = prompt("Link URL:");
      if (url) document.execCommand("createLink", false, url);
    } else if (cmd === "insertImage") {
      const url = prompt("Kép URL:");
      if (url) document.execCommand("insertImage", false, url);
    } else {
      document.execCommand(cmd, false, null);
    }
    updatePreview();
  });

  /* ── ÉLŐBEN ELŐNÉZET FRISSÍTÉS ────────────────────────── */
  document.getElementById("blogContentEditor")?.addEventListener("input", updatePreview);
  document.getElementById("bTitle")?.addEventListener("input", updatePreview);
  document.getElementById("bExcerpt")?.addEventListener("input", updatePreview);
  document.getElementById("bCategory")?.addEventListener("change", updatePreview);

  function updatePreview() {
    const title    = document.getElementById("bTitle")?.value || "";
    const excerpt  = document.getElementById("bExcerpt")?.value || "";
    const content  = document.getElementById("blogContentEditor")?.innerHTML || "";
    const cat      = document.getElementById("bCategory")?.value || "";
    const coverUrl = document.getElementById("bCoverUrl")?.value || "";

    const catLabels = { hir:"Hírek", ajanlo:"Ajánló", forditas:"Fordítás", kozosseg:"Közösség" };

    previewContent.innerHTML = `
      <div class="preview-cat">${esc(catLabels[cat] || cat)}</div>
      <h1>${esc(title) || '<span style="color:#444">Cím...</span>'}</h1>
      ${excerpt ? `<p class="preview-lead">${esc(excerpt)}</p>` : ""}
      ${coverUrl ? `<img src="${esc(coverUrl)}" class="preview-cover">` : ""}
      <div class="preview-meta">${formatDate(new Date().toISOString())}</div>
      <div>${content || '<p style="color:#444">Kezdj el írni...</p>'}</div>
    `;
  }

  /* ── ELŐNÉZET PANEL TOGGLE ────────────────────────────── */
  // Előnézet gomb – a toolbar végére dinamikusan adjuk
  const toolbar = document.getElementById("editorToolbar");
  if (toolbar) {
    const sep = document.createElement("span");
    sep.className = "toolbar-sep";
    toolbar.appendChild(sep);
    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.textContent = "👁️ Előnézet";
    previewBtn.style.background = "#7c3aed";
    previewBtn.style.color = "#fff";
    previewBtn.addEventListener("click", () => {
      const visible = previewPanel.style.display !== "none";
      previewPanel.style.display = visible ? "none" : "block";
      updatePreview();
    });
    toolbar.appendChild(previewBtn);
  }

  document.getElementById("blogPreviewClose")?.addEventListener("click", () => {
    previewPanel.style.display = "none";
  });

  /* ── BORÍTÓKÉP ────────────────────────────────────────── */
  function setCover(url) {
    const img   = document.getElementById("bCoverImg");
    const empty = document.getElementById("bCoverEmpty");
    const clear = document.getElementById("bClearCover");
    document.getElementById("bCoverUrl").value = url;
    if (url) {
      img.src = url;
      img.style.display = "block";
      empty.style.display = "none";
      clear.style.display = "inline-block";
    } else {
      img.src = "";
      img.style.display = "none";
      empty.style.display = "inline";
      clear.style.display = "none";
    }
    updatePreview();
  }

  document.getElementById("bClearCover")?.addEventListener("click", () => setCover(""));

  // Feltöltés gomb
  document.getElementById("bUploadBtn")?.addEventListener("click", () => {
    document.getElementById("bCoverFile").click();
  });

  document.getElementById("bCoverFile")?.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("image", file);
    try {
      const res = await fetch("/api/admin/upload-image", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) setCover(data.url);
      else showMsg("Feltöltési hiba!", "err");
    } catch { showMsg("Feltöltési hiba!", "err"); }
  });

  // Galériából választás
  document.getElementById("bPickBtn")?.addEventListener("click", () => openGallery());

  /* ── MENTÉS ───────────────────────────────────────────── */
  document.getElementById("bSaveDraft")?.addEventListener("click", () => savePost(false));
  document.getElementById("bSavePublish")?.addEventListener("click", () => savePost(true));

  async function savePost(publish) {
    const title   = document.getElementById("bTitle").value.trim();
    const slug    = document.getElementById("bSlug").value.trim();
    const content = document.getElementById("blogContentEditor").innerHTML.trim();

    if (!title || !slug) { showMsg("A cím és a slug kötelező!", "err"); return; }
    if (!content || content === "<br>") { showMsg("A tartalom nem lehet üres!", "err"); return; }

    const tagsRaw = document.getElementById("bTags").value;
    const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

    const body = {
      title,
      slug,
      category:  document.getElementById("bCategory").value,
      author:    document.getElementById("bAuthor").value.trim(),
      excerpt:   document.getElementById("bExcerpt").value.trim(),
      cover_url: document.getElementById("bCoverUrl").value,
      content,
      tags,
      published: publish,
    };

    const isEdit = !!editingSlug;
    const url    = isEdit ? `/api/blog/${encodeURIComponent(editingSlug)}` : "/api/blog";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        showMsg(data.error || "Mentési hiba!", "err");
        return;
      }

      editingSlug = data.slug || slug;
      showMsg(publish ? "✅ Közzétéve!" : "💾 Vázlatként mentve!", "ok");
      await loadPosts();
      renderList();
    } catch { showMsg("Szerver hiba!", "err"); }
  }

  function showMsg(msg, type) {
    saveMsg.textContent = msg;
    saveMsg.className = "blog-save-msg " + type;
    setTimeout(() => { saveMsg.textContent = ""; saveMsg.className = "blog-save-msg"; }, 3500);
  }

  /* ── TÖRLÉS ───────────────────────────────────────────── */
  async function deletePost(slug, title) {
    if (!confirm(`Törlöd ezt a bejegyzést?\n\n"${title}"`)) return;
    try {
      const res = await fetch(`/api/blog/${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (res.ok) {
        if (editingSlug === slug) {
          formWrap.style.display = "none";
          editingSlug = null;
        }
        await loadPosts();
      } else {
        alert("Törlési hiba!");
      }
    } catch { alert("Szerver hiba!"); }
  }

  /* ── GALÉRIA MODAL ────────────────────────────────────── */
  let galleryTarget = "cover"; // "cover" vagy "editor"

  function openGallery(target) {
    galleryTarget = target || "cover";
    galleryModal.style.display = "flex";
    loadGallery();
  }

  document.getElementById("galleryClose")?.addEventListener("click", closeGallery);
  document.getElementById("galleryBackdrop")?.addEventListener("click", closeGallery);

  function closeGallery() {
    galleryModal.style.display = "none";
  }

  async function loadGallery() {
    galleryGrid.innerHTML = '<div class="blog-list-loading">Betöltés...</div>';
    try {
      const res = await fetch("/api/admin/images");
      const images = res.ok ? await res.json() : [];
      renderGallery(images);
    } catch {
      galleryGrid.innerHTML = '<div class="blog-list-loading">Hiba a betöltésnél.</div>';
    }
  }

  function renderGallery(images) {
    if (!images.length) {
      galleryGrid.innerHTML = '<div class="blog-list-loading">Nincs kép a mappában.</div>';
      return;
    }
    galleryGrid.innerHTML = "";
    images.forEach(img => {
      const item = document.createElement("div");
      item.className = "gallery-img-item";
      item.innerHTML = `
        <img src="${esc(img.url)}" loading="lazy" alt="">
        <div class="gallery-img-name">${esc(img.name)}</div>
      `;
      item.addEventListener("click", () => {
        if (galleryTarget === "cover") {
          setCover(img.url);
        } else {
          // Beillesztés az editorba
          const editor = document.getElementById("blogContentEditor");
          editor.focus();
          document.execCommand("insertImage", false, img.url);
          updatePreview();
        }
        closeGallery();
      });
      galleryGrid.appendChild(item);
    });
  }

  // Galériába feltöltés
  document.getElementById("galleryUploadFile")?.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("image", file);
    try {
      const res = await fetch("/api/admin/upload-image", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) loadGallery();
      else alert("Feltöltési hiba!");
    } catch { alert("Feltöltési hiba!"); }
    e.target.value = "";
  });

  // Kép beillesztés gomb a toolbarba is megnyitja a galériát
  document.getElementById("editorToolbar")?.addEventListener("click", e => {
    if (e.target.closest('[data-cmd="insertImage"]')) {
      e.stopImmediatePropagation();
      openGallery("editor");
    }
  }, true);

  /* ── SEGÉD ────────────────────────────────────────────── */
  function esc(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function formatDate(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("hu-HU", { year:"numeric", month:"long", day:"numeric" }); }
    catch { return iso; }
  }
})();
