/* Manga-adatlap → 💬 Hozzászólások fül (2026-11-12).
   Lista 30-asával, új hozzászólás, saját szerkesztése/törlése, admin törlés,
   spoiler-jelölés (elmosva, kattintásra látszik). Minden szöveg escape-elve. */
(() => {
  const slug = new URLSearchParams(location.search).get("slug");
  const panel = document.getElementById("tab-comments");
  const tabBtn = document.querySelector('.chapters-tab-btn[data-tab="tab-comments"]');
  if (!slug || !panel || !tabBtn) return;

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = `/api/manga/${encodeURIComponent(slug)}/comments`;
  let comments = [], hasMore = false, total = 0, canPost = false, reason = null, loaded = false, busy = false;

  function ago(t) {
    const s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 60) return "most";
    if (s < 3600) return Math.floor(s / 60) + " perce";
    if (s < 86400) return Math.floor(s / 3600) + " órája";
    if (s < 86400 * 7) return Math.floor(s / 86400) + " napja";
    return new Date(t).toLocaleDateString("hu-HU");
  }

  function setCount() {
    tabBtn.textContent = total ? `💬 Hozzászólások (${total})` : "💬 Hozzászólások";
  }

  function commentHtml(c) {
    const name = c.user ? esc(c.user.username) : "Törölt fiók";
    const avatar = c.user?.avatar ? esc(c.user.avatar) : "/assets/logo.png";
    const badge = c.user?.role === "admin" ? '<span class="cm-badge">Admin</span>' : "";
    const body = esc(c.body).replace(/\n/g, "<br>");
    return `<div class="cm-item" data-id="${c.id}">
      <img class="cm-avatar" src="${avatar}" alt="" loading="lazy">
      <div class="cm-main">
        <div class="cm-head"><span class="cm-name">${name}</span>${badge}
          <span class="cm-time" title="${esc(new Date(c.created_at).toLocaleString("hu-HU"))}">${ago(c.created_at)}${c.edited_at ? " · szerkesztve" : ""}</span></div>
        <div class="cm-body${c.spoiler ? " cm-spoiler" : ""}" ${c.spoiler ? 'title="Spoiler – kattints a megjelenítéshez"' : ""}>${body}</div>
        <div class="cm-actions">
          ${c.mine ? '<button type="button" class="cm-act" data-act="edit">Szerkesztés</button>' : ""}
          ${c.canDelete ? '<button type="button" class="cm-act cm-del" data-act="delete">Törlés</button>' : ""}
        </div>
      </div></div>`;
  }

  function render() {
    const form = canPost
      ? `<form class="cm-form" id="cmForm">
          <textarea id="cmText" maxlength="2000" rows="3" placeholder="Mit gondolsz erről a műről?"></textarea>
          <div class="cm-form-row">
            <label class="cm-spoiler-chk"><input type="checkbox" id="cmSpoiler"> Spoilert tartalmaz</label>
            <span class="cm-chars" id="cmChars">0 / 2000</span>
            <button type="submit" class="cm-send" id="cmSend">Küldés</button>
          </div>
          <div class="cm-error" id="cmError"></div>
        </form>`
      : `<p class="cm-note">${esc(reason || "Hozzászóláshoz jelentkezz be.")}</p>`;
    panel.innerHTML = `${form}
      <div class="cm-list" id="cmList">${comments.length ? comments.map(commentHtml).join("")
        : '<p class="cm-empty">Még nincs hozzászólás. Legyél te az első! 🍆</p>'}</div>
      ${hasMore ? '<button type="button" class="cm-more" id="cmMore">Régebbi hozzászólások</button>' : ""}`;
    bind();
  }

  function bind() {
    const form = document.getElementById("cmForm");
    if (form) {
      const ta = document.getElementById("cmText");
      ta.addEventListener("input", () => { document.getElementById("cmChars").textContent = `${ta.value.length} / 2000`; });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        const err = document.getElementById("cmError");
        err.textContent = "";
        if (!text || busy) return;
        busy = true; document.getElementById("cmSend").disabled = true;
        try {
          const r = await fetch(api, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: text, spoiler: document.getElementById("cmSpoiler").checked }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || "Nem sikerült elküldeni.");
          comments.unshift(d.comment); total++; setCount(); render();
        } catch (ex) {
          err.textContent = ex.message;
          document.getElementById("cmSend").disabled = false;
        } finally { busy = false; }
      });
    }
    document.getElementById("cmMore")?.addEventListener("click", () => load(true));
  }

  panel.addEventListener("click", async (e) => {
    const sp = e.target.closest(".cm-spoiler");
    if (sp) { sp.classList.remove("cm-spoiler"); sp.removeAttribute("title"); return; }
    const btn = e.target.closest(".cm-act");
    if (!btn) return;
    const item = btn.closest(".cm-item");
    const id = Number(item.dataset.id);
    const c = comments.find(x => x.id === id);
    if (!c) return;

    if (btn.dataset.act === "delete") {
      if (!confirm(c.mine ? "Biztosan törlöd a hozzászólásodat?" : `Biztosan törlöd ${c.user?.username || "a felhasználó"} hozzászólását?`)) return;
      const r = await fetch(`/api/manga-comments/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error || "Nem sikerült törölni."); return; }
      comments = comments.filter(x => x.id !== id); total = Math.max(0, total - 1); setCount(); render();
    }

    if (btn.dataset.act === "edit") {
      const bodyEl = item.querySelector(".cm-body");
      bodyEl.classList.remove("cm-spoiler");
      bodyEl.innerHTML = `<textarea class="cm-edit-text" maxlength="2000" rows="3">${esc(c.body)}</textarea>
        <div class="cm-form-row"><label class="cm-spoiler-chk"><input type="checkbox" class="cm-edit-spoiler" ${c.spoiler ? "checked" : ""}> Spoilert tartalmaz</label>
        <button type="button" class="cm-act" data-act="cancel">Mégse</button>
        <button type="button" class="cm-send" data-act="save">Mentés</button></div>`;
      item.querySelector(".cm-actions").style.display = "none";
    }
    if (btn.dataset.act === "cancel") render();
    if (btn.dataset.act === "save") {
      const text = item.querySelector(".cm-edit-text").value.trim();
      if (!text) return;
      const r = await fetch(`/api/manga-comments/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, spoiler: item.querySelector(".cm-edit-spoiler").checked }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || "Nem sikerült menteni."); return; }
      Object.assign(c, { body: d.comment.body, spoiler: d.comment.spoiler, edited_at: d.comment.edited_at });
      render();
    }
  });

  async function load(more = false) {
    if (busy) return;
    busy = true;
    try {
      const url = more && comments.length ? `${api}?before=${comments[comments.length - 1].id}` : api;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      comments = more ? comments.concat(d.comments) : d.comments;
      hasMore = d.hasMore; total = d.total; canPost = d.canPost; reason = d.reason;
      loaded = true; setCount();
      if (panel.classList.contains("active") || more) render();
    } catch {
      if (panel.classList.contains("active")) panel.innerHTML = '<p class="cm-note">Nem sikerült betölteni a hozzászólásokat.</p>';
    } finally { busy = false; }
  }

  tabBtn.addEventListener("click", () => { if (loaded) render(); else load(); });
  load(); // a fülön a darabszám azonnal látszódjon
  if (location.hash === "#hozzaszolasok") tabBtn.click();
})();
