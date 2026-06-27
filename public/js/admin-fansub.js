/* FansubÉlet admin – karakter kezelés + rész generálás */

let fansubChars = [];
let fansubPageCount = 0;

async function loadFansubData() {
  await Promise.all([loadFansubSetting(), loadFansubChars()]);
}

async function loadFansubSetting() {
  const res = await fetch("/api/admin/fansub/setting");
  if (!res.ok) return;
  const { description } = await res.json();
  const el = document.getElementById("fansubSetting");
  if (el) el.value = description;
}

async function saveFansubSetting() {
  const description = document.getElementById("fansubSetting").value.trim();
  if (!description) return;
  const res = await fetch("/api/admin/fansub/setting", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  const statusEl = document.getElementById("fansubSettingStatus");
  if (res.ok) {
    statusEl.textContent = "✅ Mentve";
    statusEl.style.display = "inline";
    setTimeout(() => (statusEl.style.display = "none"), 2000);
  } else {
    const err = await res.json();
    statusEl.textContent = "❌ " + (err.error || "Hiba");
    statusEl.style.color = "#f87171";
    statusEl.style.display = "inline";
  }
}

async function loadFansubChars() {
  const res = await fetch("/api/admin/fansub/characters");
  if (!res.ok) return;
  fansubChars = await res.json();
  renderFansubChars();
}

function renderFansubChars() {
  const el = document.getElementById("fansubCharList");
  if (!el) return;
  if (!fansubChars.length) {
    el.innerHTML = '<p style="color:#64748b;font-size:.85rem">Még nincs szereplő.</p>';
    return;
  }
  el.innerHTML = fansubChars.map(c => `
    <div id="fansubCharRow_${c.id}" style="padding:8px;background:#1e293b;border-radius:8px;margin-bottom:6px;${!c.active ? 'opacity:.55' : ''}">
      <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:start">
        <div>
          <strong style="color:#e2e8f0;font-size:.9rem">${escHtml(c.name)}</strong>
          ${!c.active ? '<span style="color:#64748b;font-size:.75rem;margin-left:6px">(inaktív)</span>' : ''}
        </div>
        <div style="color:#94a3b8;font-size:.82rem;line-height:1.5">${escHtml(c.visual_description)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button onclick="startEditFansubChar(${c.id})"
            style="background:#1d4ed8;color:#fff;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.78rem">
            ✏️
          </button>
          <button onclick="toggleFansubChar(${c.id}, ${!c.active})"
            style="background:${c.active ? '#334155' : '#22c55e'};color:#fff;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.78rem">
            ${c.active ? 'Ki' : 'Be'}
          </button>
          <button onclick="deleteFansubChar(${c.id})"
            style="background:#7f1d1d;color:#fca5a5;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.78rem">
            🗑
          </button>
        </div>
      </div>
      <div id="fansubCharEdit_${c.id}" style="display:none;margin-top:10px;display:none">
        <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:start">
          <input id="fansubEditName_${c.id}" type="text" value="${escHtml(c.name)}"
            style="background:#0f172a;border:1px solid #7c3aed;border-radius:6px;padding:6px 8px;color:#fff;font-size:.85rem">
          <textarea id="fansubEditDesc_${c.id}" rows="3"
            style="background:#0f172a;border:1px solid #7c3aed;border-radius:6px;padding:6px 8px;color:#fff;font-size:.85rem;resize:vertical">${escHtml(c.visual_description)}</textarea>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button onclick="saveFansubChar(${c.id})"
              style="background:#22c55e;color:#fff;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:.82rem;font-weight:600">
              💾 Ment
            </button>
            <button onclick="cancelEditFansubChar(${c.id})"
              style="background:#334155;color:#e2e8f0;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:.82rem">
              Mégse
            </button>
          </div>
        </div>
      </div>
    </div>
  `).join("");
}

async function addFansubChar() {
  const name = document.getElementById("fansubCharName").value.trim();
  const visual_description = document.getElementById("fansubCharDesc").value.trim();
  if (!name || !visual_description) {
    alert("Adj meg nevet és vizuális leírást!");
    return;
  }
  const res = await fetch("/api/admin/fansub/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, visual_description }),
  });
  if (res.ok) {
    document.getElementById("fansubCharName").value = "";
    document.getElementById("fansubCharDesc").value = "";
    await loadFansubChars();
  } else {
    const err = await res.json();
    alert("Hiba: " + (err.error || "ismeretlen"));
  }
}

function startEditFansubChar(id) {
  document.getElementById(`fansubCharEdit_${id}`).style.display = "block";
}

function cancelEditFansubChar(id) {
  document.getElementById(`fansubCharEdit_${id}`).style.display = "none";
}

async function saveFansubChar(id) {
  const name = document.getElementById(`fansubEditName_${id}`).value.trim();
  const visual_description = document.getElementById(`fansubEditDesc_${id}`).value.trim();
  if (!name || !visual_description) { alert("Név és leírás nem lehet üres!"); return; }
  const res = await fetch(`/api/admin/fansub/characters/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, visual_description }),
  });
  if (res.ok) {
    await loadFansubChars();
  } else {
    const err = await res.json();
    alert("Hiba: " + (err.error || "ismeretlen"));
  }
}

async function toggleFansubChar(id, active) {
  await fetch(`/api/admin/fansub/characters/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  await loadFansubChars();
}

async function deleteFansubChar(id) {
  if (!confirm("Biztosan törlöd ezt a szereplőt?")) return;
  await fetch(`/api/admin/fansub/characters/${id}`, { method: "DELETE" });
  await loadFansubChars();
}

function addFansubPage() {
  fansubPageCount++;
  const n = fansubPageCount;
  const container = document.getElementById("fansubPageList");
  const row = document.createElement("div");
  row.id = `fansubPage_${n}`;
  row.style.cssText = "display:flex;gap:8px;align-items:start";
  row.innerHTML = `
    <span style="color:#64748b;font-size:.82rem;white-space:nowrap;padding-top:9px">${n}. oldal</span>
    <textarea data-page="${n}" placeholder="Mit ábrázoljon ez az oldal? (pl. Padli lelkesen mutat egy új manhwa fejezetre)"
      style="flex:1;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#fff;font-size:.85rem;resize:vertical;min-height:54px"></textarea>
    <button onclick="removeFansubPage(${n})"
      style="background:#7f1d1d;color:#fca5a5;border:none;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:.85rem">✕</button>
  `;
  container.appendChild(row);
}

function removeFansubPage(n) {
  const el = document.getElementById(`fansubPage_${n}`);
  if (el) el.remove();
}

async function generateFansubChapter() {
  const chapterName = document.getElementById("fansubChapterName").value.trim();
  if (!chapterName) { alert("Add meg a rész nevét!"); return; }

  const textareas = document.querySelectorAll("#fansubPageList textarea[data-page]");
  const pages = [];
  textareas.forEach(ta => {
    const prompt = ta.value.trim();
    if (prompt) pages.push({ prompt });
  });
  if (!pages.length) { alert("Adj hozzá legalább 1 oldalt!"); return; }

  const btn = document.getElementById("fansubGenerateBtn");
  const statusEl = document.getElementById("fansubGenStatus");
  const resultEl = document.getElementById("fansubGenResult");

  btn.disabled = true;
  btn.textContent = "⏳ Generálás...";
  statusEl.innerHTML = `<p style="color:#94a3b8;font-size:.85rem">🎨 ${pages.length} oldal generálása folyamatban... (kb. ${pages.length * 15}–${pages.length * 20} mp)</p>`;
  resultEl.innerHTML = "";

  try {
    const res = await fetch("/api/admin/fansub/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter_name: chapterName, pages }),
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.innerHTML = `<p style="color:#f87171">❌ Hiba: ${data.error || "ismeretlen"}</p>`;
      return;
    }

    statusEl.innerHTML = `<p style="color:#22c55e">✅ ${data.generated}/${pages.length} oldal elkészült — "${chapterName}"</p>` +
      (data.errors.length ? `<p style="color:#f87171;font-size:.82rem">Hibák: ${data.errors.map(e => `${e.page}. oldal: ${e.error}`).join(", ")}</p>` : "");

    const r2Base = data.r2PublicUrl || "";
    data.pages.forEach(p => {
      const imgSrc = r2Base ? `${r2Base}/${p.r2Key}` : "";
      const div = document.createElement("div");
      div.style.cssText = "background:#1e293b;border-radius:8px;padding:8px;text-align:center;width:220px";
      div.innerHTML = `
        <p style="color:#94a3b8;font-size:.78rem;margin:0 0 6px">${p.page}. oldal</p>
        ${imgSrc ? `<img src="${escHtml(imgSrc)}" alt="${p.page}. oldal"
          style="max-width:200px;border-radius:6px;display:block;margin:0 auto"
          onerror="this.style.display='none'">` : ""}
        <p style="color:#64748b;font-size:.7rem;margin:4px 0 0;word-break:break-all">${escHtml(p.filename)}</p>
      `;
      resultEl.appendChild(div);
    });

  } catch (err) {
    statusEl.innerHTML = `<p style="color:#f87171">❌ Hálózati hiba: ${err.message}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "🎨 Generálás indítása";
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Tab aktiváláskor töltse be az adatokat
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('.tab-btn[data-tab="tab-fansub"]').forEach(btn => {
    btn.addEventListener("click", () => loadFansubData());
  });
  // Ha már aktív tab
  if (document.getElementById("tab-fansub")?.classList.contains("active")) {
    loadFansubData();
  }
});
