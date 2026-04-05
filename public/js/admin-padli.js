/* admin-padli.js – Padli AI bot konfigurátor */

(function () {
  const API = "/api/admin/padli";

  /* ── SZEKCIÓ NAVIGÁCIÓ ────────────────────────────────── */
  document.querySelectorAll(".padli-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".padli-nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".padli-section").forEach(s => s.classList.remove("active"));
      btn.classList.add("active");
      const sec = document.getElementById(btn.dataset.section);
      if (sec) {
        sec.classList.add("active");
        // Lazy load
        if (!sec.dataset.loaded) {
          sec.dataset.loaded = "1";
          if (btn.dataset.section === "sec-config")     loadConfig();
          if (btn.dataset.section === "sec-replies")    loadReplies();
          if (btn.dataset.section === "sec-tags")       loadTags();
          if (btn.dataset.section === "sec-genres")     loadGenres();
          if (btn.dataset.section === "sec-characters") loadCharacters();
        }
      }
    });
  });

  // Tab aktiváláskor töltjük be az elsőt
  document.querySelector('[data-tab="tab-padli"]')?.addEventListener("click", () => {
    const sec = document.getElementById("sec-config");
    if (sec && !sec.dataset.loaded) {
      sec.dataset.loaded = "1";
      loadConfig();
    }
  });

  // Config reload gomb
  document.getElementById("padliReloadBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("padliReloadBtn");
    btn.textContent = "⏳ Újratöltés...";
    try {
      await fetch(API + "/reload", { method: "POST" });
      btn.textContent = "✅ Kész!";
      setTimeout(() => { btn.textContent = "🔄 Config újratöltés"; }, 2000);
    } catch { btn.textContent = "❌ Hiba"; }
  });

  /* ── CONFIG ───────────────────────────────────────────── */
  async function loadConfig() {
    const el = document.getElementById("padliConfigList");
    try {
      const res = await fetch(API + "/config");
      const items = await res.json();

      const byCategory = {};
      items.forEach(item => {
        (byCategory[item.category] = byCategory[item.category] || []).push(item);
      });

      const catLabels = {
        general: "🛠️ Általános",
        spam:    "🚫 Spam védelem",
        behavior:"🤖 Viselkedés",
        cache:   "⚡ Cache",
        search:  "🔍 Keresés",
        features:"✨ Funkciók",
        debug:   "🐛 Debug"
      };

      el.innerHTML = "";

      for (const [cat, catItems] of Object.entries(byCategory)) {
        const catEl = document.createElement("div");
        catEl.className = "padli-config-category";
        catEl.textContent = catLabels[cat] || cat;
        el.appendChild(catEl);

        catItems.forEach(item => el.appendChild(makeConfigItem(item)));
      }
    } catch { el.innerHTML = '<div class="padli-loading">Hiba a betöltésnél.</div>'; }
  }

  function makeConfigItem(item) {
    const div = document.createElement("div");
    div.className = "padli-config-item";

    const rawVal = typeof item.value === "string" ? item.value : JSON.stringify(item.value);
    const isBool = rawVal === "true" || rawVal === "false";
    const isNum  = !isBool && !isNaN(parseFloat(rawVal)) && rawVal.trim() !== "";

    let inputHtml = "";
    if (isBool) {
      const checked = rawVal === "true" ? "checked" : "";
      inputHtml = `<label class="padli-config-bool">
        <input type="checkbox" data-key="${item.key}" ${checked} />
        <span>${rawVal === "true" ? "Be" : "Ki"}</span>
      </label>`;
    } else {
      inputHtml = `<input type="${isNum ? "number" : "text"}" step="any"
        class="padli-input padli-config-input" data-key="${item.key}"
        value="${esc(rawVal.replace(/^"|"$/g,""))}" />`;
    }

    div.innerHTML = `
      <div class="padli-config-info">
        <div class="padli-config-label">${esc(item.label || item.key)}</div>
        <div class="padli-config-desc">${esc(item.description || "")}</div>
      </div>
      ${inputHtml}
      <button class="padli-config-save" data-key="${item.key}">Mentés</button>
    `;

    // Bool toggle szöveg frissítés
    div.querySelector("input[type=checkbox]")?.addEventListener("change", e => {
      e.target.nextElementSibling.textContent = e.target.checked ? "Be" : "Ki";
    });

    // Mentés
    div.querySelector(".padli-config-save").addEventListener("click", async btn => {
      const key = btn.target.dataset.key;
      const inp = div.querySelector(`[data-key="${key}"]`);
      let val;
      if (inp.type === "checkbox") val = inp.checked;
      else if (inp.type === "number") val = parseFloat(inp.value);
      else val = inp.value;

      try {
        await fetch(`${API}/config/${key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: val })
        });
        btn.target.textContent = "✓";
        btn.target.classList.add("saved");
        setTimeout(() => { btn.target.textContent = "Mentés"; btn.target.classList.remove("saved"); }, 2000);
      } catch { btn.target.textContent = "❌"; }
    });

    return div;
  }

  /* ── VÁLASZ VARIÁCIÓK ─────────────────────────────────── */
  async function loadReplies() {
    const el = document.getElementById("padliRepliesList");
    try {
      const res = await fetch(API + "/replies");
      const replies = await res.json();
      renderReplies(replies, el);
    } catch { el.innerHTML = '<div class="padli-loading">Hiba.</div>'; }
  }

  const TYPE_LABELS = {
    noData:   "❓ Nincs adat (nem tud választ adni)",
    notFound: "🔍 Nem található nálunk",
    found:    "✅ Megtalálva nálunk",
    offTopic: "🚫 Off-topic (nem manga/anime téma)",
    fallback: "⏳ Ollama lassú / nem elérhető"
  };

  function renderReplies(replies, el) {
    el.innerHTML = "";
    const byType = {};
    replies.forEach(r => (byType[r.type] = byType[r.type] || []).push(r));

    for (const [type, items] of Object.entries(byType)) {
      const group = document.createElement("div");
      group.className = "padli-reply-type-group";
      group.innerHTML = `<div class="padli-reply-type-label">${TYPE_LABELS[type] || type}</div>`;

      items.forEach(r => {
        const row = document.createElement("div");
        row.className = "padli-reply-item" + (r.active ? "" : " inactive");
        row.dataset.id = r.id;
        row.innerHTML = `
          <div class="padli-reply-text">
            <input type="text" value="${esc(r.text)}" data-id="${r.id}" />
          </div>
          <button class="padli-btn-edit" data-id="${r.id}" title="${r.active ? "Kikapcsol" : "Bekapcsol"}">
            ${r.active ? "😶 Ki" : "✅ Be"}
          </button>
          <button class="padli-btn-del" data-id="${r.id}">🗑️</button>
        `;

        // Szöveg mentés
        const inp = row.querySelector("input");
        let saveTimer;
        inp.addEventListener("input", () => {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => saveReply(r.id, { text: inp.value }), 800);
        });

        // Toggle
        row.querySelector(".padli-btn-edit").addEventListener("click", async btn => {
          const newActive = !r.active;
          await saveReply(r.id, { active: newActive });
          r.active = newActive;
          row.classList.toggle("inactive", !newActive);
          btn.target.textContent = newActive ? "😶 Ki" : "✅ Be";
        });

        // Törlés
        row.querySelector(".padli-btn-del").addEventListener("click", async () => {
          if (!confirm("Törlöd ezt a variációt?")) return;
          await fetch(`${API}/replies/${r.id}`, { method: "DELETE" });
          row.remove();
        });

        group.appendChild(row);
      });

      el.appendChild(group);
    }
  }

  async function saveReply(id, data) {
    await fetch(`${API}/replies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  }

  // Új válasz hozzáadása
  document.getElementById("replyAddBtn")?.addEventListener("click", async () => {
    const type = document.getElementById("replyTypeSelect").value;
    const text = document.getElementById("replyTextInput").value.trim();
    if (!text) return;

    try {
      await fetch(API + "/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, text })
      });
      document.getElementById("replyTextInput").value = "";
      // Újratölt
      const el = document.getElementById("padliRepliesList");
      el.innerHTML = '<div class="padli-loading">Betöltés...</div>';
      await loadReplies();
    } catch { alert("Hiba!"); }
  });

  /* ── TAG SZAVAK ───────────────────────────────────────── */
  let allTags = [];

  async function loadTags() {
    const el = document.getElementById("padliTagsList");
    try {
      const res = await fetch(API + "/tag-words");
      allTags = await res.json();
      renderTags(allTags, el);
    } catch { el.innerHTML = '<div class="padli-loading">Hiba.</div>'; }
  }

  function renderTags(tags, el) {
    el.innerHTML = "";
    tags.forEach(tag => el.appendChild(makeTagItem(tag)));
  }

  function makeTagItem(tag) {
    const div = document.createElement("div");
    div.className = "padli-tag-item";
    div.innerHTML = `
      <div class="padli-tag-header">
        <span class="padli-tag-name">${esc(tag.tag_name)}</span>
        <span class="padli-tag-count">${tag.words.length} szó</span>
        <span class="padli-tag-toggle">▼</span>
      </div>
      <div class="padli-tag-body">
        <div class="padli-tag-words-wrap" id="words-${esc(tag.tag_name)}"></div>
        <div class="padli-tag-add-row">
          <input type="text" class="padli-input padli-tag-word-input"
            placeholder='Pl. "vampir", "vakvampir", "verivago"' />
          <button class="padli-tag-save-btn" data-tag="${esc(tag.tag_name)}">💾 Mentés</button>
        </div>
      </div>
    `;

    // Szavak megjelenítése
    const wordsWrap = div.querySelector(`#words-${CSS.escape(tag.tag_name)}`);
    let currentWords = [...tag.words];

    function renderWords() {
      wordsWrap.innerHTML = "";
      currentWords.forEach((w, i) => {
        const chip = document.createElement("div");
        chip.className = "padli-word-chip";
        chip.innerHTML = `<span>${esc(w)}</span><button data-i="${i}">✕</button>`;
        chip.querySelector("button").addEventListener("click", () => {
          currentWords.splice(i, 1);
          renderWords();
        });
        wordsWrap.appendChild(chip);
      });
    }

    renderWords();

    // Mentés
    div.querySelector(".padli-tag-save-btn").addEventListener("click", async btn => {
      const input = div.querySelector(".padli-tag-word-input");
      const newWords = input.value.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
      const merged = [...new Set([...currentWords, ...newWords])];
      currentWords = merged;
      renderWords();
      input.value = "";

      try {
        await fetch(`${API}/tag-words/${encodeURIComponent(tag.tag_name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words: currentWords })
        });
        btn.target.textContent = "✅ Mentve!";
        btn.target.classList.add("saved");
        const countEl = div.querySelector(".padli-tag-count");
        if (countEl) countEl.textContent = currentWords.length + " szó";
        setTimeout(() => { btn.target.textContent = "💾 Mentés"; btn.target.classList.remove("saved"); }, 2000);
      } catch { btn.target.textContent = "❌ Hiba"; }
    });

    // Nyitás/zárás
    div.querySelector(".padli-tag-header").addEventListener("click", () => {
      div.querySelector(".padli-tag-body").classList.toggle("open");
      div.querySelector(".padli-tag-toggle").textContent =
        div.querySelector(".padli-tag-body").classList.contains("open") ? "▲" : "▼";
    });

    return div;
  }

  // Tag keresés
  document.getElementById("tagSearchInput")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase().trim();
    const el = document.getElementById("padliTagsList");
    const filtered = q ? allTags.filter(t => t.tag_name.toLowerCase().includes(q)) : allTags;
    renderTags(filtered, el);
  });

  /* ── GENRE SZAVAK ─────────────────────────────────────── */
  let allGenres = [];

  async function loadGenres() {
    const el = document.getElementById("padliGenresList");
    try {
      const res = await fetch(API + "/genre-words");
      allGenres = res.ok ? await res.json() : [];
      renderGenres(allGenres, el);
    } catch { el.innerHTML = '<div class="padli-loading">Hiba.</div>'; }
  }

  function renderGenres(genres, el) {
    el.innerHTML = "";
    genres.forEach(g => el.appendChild(makeGenreItem(g)));
  }

  function makeGenreItem(genre) {
    const div = document.createElement("div");
    div.className = "padli-tag-item";
    div.innerHTML = `
      <div class="padli-tag-header">
        <span class="padli-tag-name">${esc(genre.genre_name)}</span>
        <span class="padli-tag-count">${genre.words.length} szó ${genre.words.length === 0 ? "(statikus config)" : ""}</span>
        <span class="padli-tag-toggle">▼</span>
      </div>
      <div class="padli-tag-body">
        <div class="padli-tag-words-wrap" id="gwords-${esc(genre.genre_name)}"></div>
        <div class="padli-tag-add-row">
          <input type="text" class="padli-input padli-tag-word-input"
            placeholder="Pl. romantikus, szerelmes, csajozos" />
          <button class="padli-tag-save-btn" data-genre="${esc(genre.genre_name)}">💾 Mentés</button>
        </div>
      </div>
    `;

    const wordsWrap = div.querySelector(`#gwords-${CSS.escape(genre.genre_name)}`);
    let currentWords = [...genre.words];

    function renderWords() {
      wordsWrap.innerHTML = "";
      currentWords.forEach((w, i) => {
        const chip = document.createElement("div");
        chip.className = "padli-word-chip";
        chip.innerHTML = `<span>${esc(w)}</span><button data-i="${i}">✕</button>`;
        chip.querySelector("button").addEventListener("click", () => {
          currentWords.splice(i, 1);
          renderWords();
        });
        wordsWrap.appendChild(chip);
      });
    }

    renderWords();

    div.querySelector(".padli-tag-save-btn").addEventListener("click", async btn => {
      const input = div.querySelector(".padli-tag-word-input");
      const newWords = input.value.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
      currentWords = [...new Set([...currentWords, ...newWords])];
      renderWords();
      input.value = "";

      try {
        await fetch(`${API}/genre-words/${encodeURIComponent(genre.genre_name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words: currentWords })
        });
        btn.target.textContent = "✅ Mentve!";
        btn.target.classList.add("saved");
        const countEl = div.querySelector(".padli-tag-count");
        if (countEl) countEl.textContent = currentWords.length + " szó";
        setTimeout(() => { btn.target.textContent = "💾 Mentés"; btn.target.classList.remove("saved"); }, 2000);
      } catch { btn.target.textContent = "❌ Hiba"; }
    });

    div.querySelector(".padli-tag-header").addEventListener("click", () => {
      div.querySelector(".padli-tag-body").classList.toggle("open");
      div.querySelector(".padli-tag-toggle").textContent =
        div.querySelector(".padli-tag-body").classList.contains("open") ? "▲" : "▼";
    });

    return div;
  }

  document.getElementById("genreSearchInput")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase().trim();
    const el = document.getElementById("padliGenresList");
    const filtered = q ? allGenres.filter(g => g.genre_name.toLowerCase().includes(q)) : allGenres;
    renderGenres(filtered, el);
  });

  /* ── KARAKTEREK ───────────────────────────────────────── */
  async function loadCharacters() {
    const el = document.getElementById("padliCharList");
    try {
      const res = await fetch(API + "/characters");
      const chars = await res.json();
      renderCharacters(chars, el);
    } catch { el.innerHTML = '<div class="padli-loading">Hiba.</div>'; }
  }

  function renderCharacters(chars, el) {
    el.innerHTML = "";

    // Hozzáadás form
    const addForm = document.createElement("div");
    addForm.className = "padli-char-add-form";
    addForm.id = "charAddForm";
    addForm.innerHTML = `
      <strong style="color:#e0e0f0;font-size:.9rem">➕ Új karakter</strong>
      <input type="text" id="newCharName" placeholder="Karakter neve *" class="padli-input" />
      <textarea id="newCharDesc" rows="2" placeholder="Ki ez a karakter? (leírás)"></textarea>
      <textarea id="newCharPers" rows="2" placeholder="Személyiség, hangnem, jellemzők..."></textarea>
      <div class="padli-char-add-row">
        <button class="padli-btn-add" id="charSaveNewBtn">💾 Mentés</button>
        <button class="padli-btn-del" id="charCancelBtn">Mégse</button>
      </div>
    `;
    el.appendChild(addForm);

    document.getElementById("charAddBtn")?.addEventListener("click", () => {
      addForm.classList.toggle("open");
    });

    document.getElementById("charCancelBtn")?.addEventListener("click", () => {
      addForm.classList.remove("open");
    });

    document.getElementById("charSaveNewBtn")?.addEventListener("click", async () => {
      const name = document.getElementById("newCharName")?.value.trim();
      const description = document.getElementById("newCharDesc")?.value.trim();
      const personality = document.getElementById("newCharPers")?.value.trim();
      if (!name) return alert("A név kötelező!");

      try {
        await fetch(API + "/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, personality })
        });
        addForm.classList.remove("open");
        el.innerHTML = '<div class="padli-loading">Betöltés...</div>';
        await loadCharacters();
      } catch { alert("Hiba!"); }
    });

    // Karakterek renderelése
    chars.forEach(char => el.appendChild(makeCharCard(char)));
  }

  function makeCharCard(char) {
    const div = document.createElement("div");
    div.className = "padli-char-card" + (char.active ? "" : " padli-char-inactive");

    div.innerHTML = `
      <div class="padli-char-header">
        <span class="padli-char-name">👤 ${esc(char.name)}</span>
        <button class="padli-btn-edit" data-id="${char.id}">${char.active ? "😶 Kikapcsol" : "✅ Bekapcsol"}</button>
        <button class="padli-btn-del" data-id="${char.id}">🗑️ Törlés</button>
      </div>
      <div class="padli-char-body">
        <div class="padli-char-field">
          <label>Leírás</label>
          <textarea rows="2" id="charDesc-${char.id}">${esc(char.description || "")}</textarea>
        </div>
        <div class="padli-char-field">
          <label>Személyiség / hangnem</label>
          <textarea rows="2" id="charPers-${char.id}">${esc(char.personality || "")}</textarea>
        </div>
        <button class="padli-char-save-btn" data-id="${char.id}">💾 Karakter mentése</button>
      </div>
      <div class="padli-stories-section">
        <div class="padli-stories-label">
          <span>📖 Történetek (${char.stories?.length || 0})</span>
          <button class="padli-btn-add story-add-toggle" data-id="${char.id}" style="font-size:.75rem;padding:4px 10px">➕ Új</button>
        </div>
        <div id="storiesOf-${char.id}"></div>
        <div class="padli-story-add" id="storyAdd-${char.id}" style="display:none">
          <input type="text" placeholder="Történet címe *" id="storyTitle-${char.id}" />
          <textarea placeholder="A történet szövege..." rows="4" id="storyContent-${char.id}"></textarea>
          <div style="display:flex;gap:8px">
            <button class="padli-btn-add story-save-btn" data-id="${char.id}">💾 Mentés</button>
            <button class="padli-btn-del story-cancel-btn" data-id="${char.id}">Mégse</button>
          </div>
        </div>
      </div>
    `;

    // Történetek megjelenítése
    const storiesEl = div.querySelector(`#storiesOf-${char.id}`);
    (char.stories || []).forEach(story => {
      storiesEl.appendChild(makeStoryItem(story));
    });

    // Karakter mentés
    div.querySelector(".padli-char-save-btn").addEventListener("click", async () => {
      const desc = div.querySelector(`#charDesc-${char.id}`)?.value.trim();
      const pers = div.querySelector(`#charPers-${char.id}`)?.value.trim();
      await fetch(`${API}/characters/${char.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, personality: pers })
      });
      const btn = div.querySelector(".padli-char-save-btn");
      btn.textContent = "✅ Mentve!";
      setTimeout(() => { btn.textContent = "💾 Karakter mentése"; }, 2000);
    });

    // Toggle aktív
    div.querySelector(".padli-btn-edit").addEventListener("click", async btn => {
      const newActive = !char.active;
      await fetch(`${API}/characters/${char.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: newActive })
      });
      char.active = newActive;
      div.classList.toggle("padli-char-inactive", !newActive);
      btn.target.textContent = newActive ? "😶 Kikapcsol" : "✅ Bekapcsol";
    });

    // Törlés
    div.querySelector(".padli-btn-del").addEventListener("click", async () => {
      if (!confirm(`Törlöd "${char.name}" karaktert az összes történetével?`)) return;
      await fetch(`${API}/characters/${char.id}`, { method: "DELETE" });
      div.remove();
    });

    // Új történet toggle
    div.querySelector(".story-add-toggle").addEventListener("click", () => {
      const form = div.querySelector(`#storyAdd-${char.id}`);
      form.style.display = form.style.display === "none" ? "flex" : "none";
      form.style.flexDirection = "column";
    });

    div.querySelector(".story-cancel-btn").addEventListener("click", () => {
      div.querySelector(`#storyAdd-${char.id}`).style.display = "none";
    });

    // Történet mentés
    div.querySelector(".story-save-btn").addEventListener("click", async () => {
      const title   = div.querySelector(`#storyTitle-${char.id}`)?.value.trim();
      const content = div.querySelector(`#storyContent-${char.id}`)?.value.trim();
      if (!title || !content) return alert("Cím és tartalom kötelező!");

      try {
        const res = await fetch(`${API}/characters/${char.id}/stories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content })
        });
        const story = await res.json();
        storiesEl.appendChild(makeStoryItem(story));
        div.querySelector(`#storyTitle-${char.id}`).value = "";
        div.querySelector(`#storyContent-${char.id}`).value = "";
        div.querySelector(`#storyAdd-${char.id}`).style.display = "none";

        // Számláló frissítés
        const countEl = div.querySelector(".padli-stories-label span");
        const current = parseInt(countEl.textContent.match(/\d+/)?.[0] || "0");
        countEl.textContent = `📖 Történetek (${current + 1})`;
      } catch { alert("Hiba!"); }
    });

    return div;
  }

  function makeStoryItem(story) {
    const div = document.createElement("div");
    div.className = "padli-story-item";
    div.innerHTML = `
      <div class="padli-story-title">
        <span>${esc(story.title)}</span>
        <div style="display:flex;gap:6px">
          <button class="padli-btn-edit story-toggle-btn">${story.active ? "😶 Ki" : "✅ Be"}</button>
          <button class="padli-btn-del story-del-btn">🗑️</button>
        </div>
      </div>
      <div class="padli-story-content">${esc(story.content)}</div>
    `;

    div.querySelector(".story-toggle-btn").addEventListener("click", async btn => {
      const newActive = !story.active;
      await fetch(`${API}/stories/${story.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: newActive })
      });
      story.active = newActive;
      btn.target.textContent = newActive ? "😶 Ki" : "✅ Be";
      div.style.opacity = newActive ? "1" : "0.45";
    });

    div.querySelector(".story-del-btn").addEventListener("click", async () => {
      if (!confirm("Törlöd ezt a történetet?")) return;
      await fetch(`${API}/stories/${story.id}`, { method: "DELETE" });
      div.remove();
    });

    return div;
  }

  /* ── SEGÉD ────────────────────────────────────────────── */
  function esc(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

})();
