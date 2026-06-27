let _envGrouped = {};
let _serverPass = "";
let _pendingChanges = {}; // { key: newValue }

/* ── BELÉPÉS ─────────────────────────────────────────────── */
async function loadEnvVars() {
  const pass = document.getElementById("serverAdminPass").value;
  const errEl = document.getElementById("serverPassError");
  errEl.style.display = "none";

  try {
    const res = await fetch("/api/admin/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password: pass }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || "Hibás jelszó";
      errEl.style.display = "block";
      return;
    }
    _serverPass = pass;
    _envGrouped = data.grouped;
    _pendingChanges = {};
    renderEnvPanel();
    document.getElementById("serverLockScreen").style.display = "none";
    document.getElementById("serverEnvPanel").style.display = "block";
    document.getElementById("serverAdminPass").value = "";
  } catch (err) {
    errEl.textContent = "Hálózati hiba";
    errEl.style.display = "block";
  }
}

/* ── RENDERELÉS ──────────────────────────────────────────── */
function renderEnvPanel() {
  const container = document.getElementById("envGroupsContainer");
  container.innerHTML = "";

  for (const [group, entries] of Object.entries(_envGrouped)) {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom:24px;background:#0f172a;border:1px solid #1e293b;border-radius:12px;overflow:hidden";

    section.innerHTML = `
      <div style="padding:12px 18px;background:#1e293b;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none"
           onclick="toggleGroup(this)">
        <span style="font-size:1rem;font-weight:700;color:#e2e8f0">${group}</span>
        <span style="color:#64748b;font-size:.8rem">(${entries.length})</span>
        <span style="margin-left:auto;color:#64748b" class="chevron">▼</span>
      </div>
      <div class="group-body">
        <table style="width:100%;border-collapse:collapse">
          <colgroup><col style="width:36%"><col style="width:64%"></colgroup>
          <tbody>
            ${entries.map(e => renderRow(e)).join("")}
          </tbody>
        </table>
      </div>
    `;
    container.appendChild(section);
  }
}

function renderRow(e) {
  const isPending = e.key in _pendingChanges;
  const displayVal = isPending ? _pendingChanges[e.key] : e.value;
  const masked = e.sensitive && displayVal ? "●".repeat(Math.min(displayVal.length, 24)) : (displayVal || "");
  const rowBg = isPending ? "background:#1a2e1a" : "";
  const keyColor = e.sensitive ? "#f59e0b" : "#7dd3fc";

  return `
    <tr id="row-${e.key}" style="border-bottom:1px solid #1e293b;${rowBg}">
      <td style="padding:10px 16px;vertical-align:middle">
        <span style="font-family:monospace;font-size:.82rem;font-weight:600;color:${keyColor}">${e.key}</span>
        ${e.sensitive ? '<span title="Érzékeny" style="color:#f59e0b;margin-left:4px;font-size:.7rem">🔒</span>' : ""}
        ${isPending ? '<span style="color:#22c55e;font-size:.7rem;margin-left:4px">● módosítva</span>' : ""}
      </td>
      <td style="padding:6px 12px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:8px">
          <span id="val-${e.key}" style="font-family:monospace;font-size:.8rem;color:${e.sensitive ? "#6b7280" : "#cbd5e1"};word-break:break-all;flex:1"
                title="${e.sensitive ? "" : (displayVal || "")}">${masked || '<span style="color:#374151;font-style:italic">üres</span>'}</span>
          <div style="display:flex;gap:4px;flex-shrink:0">
            ${e.sensitive ? `<button onclick="toggleReveal('${e.key}')" title="Megjelenítés"
              style="background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:.75rem">👁</button>` : ""}
            <button onclick="startEdit('${e.key}')" title="Szerkesztés"
              style="background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:.75rem">✏️</button>
          </div>
        </div>
      </td>
    </tr>
    <tr id="edit-${e.key}" style="display:none;background:#0a192f">
      <td colspan="2" style="padding:10px 16px">
        <div style="display:flex;gap:8px;align-items:center">
          <input id="input-${e.key}" type="text" value="${(displayVal || "").replace(/"/g, "&quot;")}"
            style="flex:1;padding:7px 10px;background:#1e293b;border:1px solid #7c3aed;border-radius:8px;color:#fff;font-family:monospace;font-size:.82rem"
            onkeydown="if(event.key==='Enter') saveEdit('${e.key}'); if(event.key==='Escape') cancelEdit('${e.key}')">
          <button onclick="saveEdit('${e.key}')"
            style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:.82rem;font-weight:600;white-space:nowrap">💾 Mentés</button>
          <button onclick="cancelEdit('${e.key}')"
            style="background:#374151;color:#9ca3af;border:none;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:.82rem">✕</button>
        </div>
      </td>
    </tr>
  `;
}

/* ── CSOPORT ÖSSZECSUKÁS ─────────────────────────────────── */
function toggleGroup(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector(".chevron");
  const open = body.style.display !== "none";
  body.style.display = open ? "none" : "";
  chevron.textContent = open ? "▶" : "▼";
}

/* ── REVEAL ──────────────────────────────────────────────── */
const _revealed = new Set();
function toggleReveal(key) {
  const valEl = document.getElementById("val-" + key);
  if (_revealed.has(key)) {
    _revealed.delete(key);
    const v = (key in _pendingChanges ? _pendingChanges[key] : findEnvVal(key)) || "";
    valEl.innerHTML = v ? "●".repeat(Math.min(v.length, 24)) : '<span style="color:#374151;font-style:italic">üres</span>';
  } else {
    _revealed.add(key);
    const v = (key in _pendingChanges ? _pendingChanges[key] : findEnvVal(key)) || "";
    valEl.innerHTML = v ? `<span style="color:#e2e8f0">${escHtml(v)}</span>` : '<span style="color:#374151;font-style:italic">üres</span>';
  }
}

function findEnvVal(key) {
  for (const entries of Object.values(_envGrouped)) {
    const e = entries.find(x => x.key === key);
    if (e) return e.value;
  }
  return "";
}

/* ── SZERKESZTÉS ─────────────────────────────────────────── */
function startEdit(key) {
  document.getElementById("edit-" + key).style.display = "";
  const inp = document.getElementById("input-" + key);
  inp.value = (key in _pendingChanges ? _pendingChanges[key] : findEnvVal(key)) || "";
  inp.focus();
  inp.select();
}

function cancelEdit(key) {
  document.getElementById("edit-" + key).style.display = "none";
}

function saveEdit(key) {
  const val = document.getElementById("input-" + key).value;
  _pendingChanges[key] = val;
  cancelEdit(key);
  // Frissítjük az adott sor megjelenítését
  updateRowDisplay(key, val);
  updateSaveBar();
}

function updateRowDisplay(key, val) {
  const row = document.getElementById("row-" + key);
  if (!row) return;
  const isSensitive = row.querySelector("[title='Érzékeny']") !== null;
  const valEl = document.getElementById("val-" + key);
  const isPending = key in _pendingChanges;

  // Sor háttér
  row.style.background = isPending ? "#1a2e1a" : "";

  // Pending badge
  const keyTd = row.querySelector("td:first-child");
  let badge = keyTd.querySelector(".pending-badge");
  if (isPending && !badge) {
    badge = document.createElement("span");
    badge.className = "pending-badge";
    badge.style.cssText = "color:#22c55e;font-size:.7rem;margin-left:4px";
    badge.textContent = "● módosítva";
    keyTd.appendChild(badge);
  } else if (!isPending && badge) {
    badge.remove();
  }

  // Érték megjelenítés
  if (valEl) {
    const displayed = _revealed.has(key)
      ? `<span style="color:#e2e8f0">${escHtml(val)}</span>`
      : (isSensitive ? ("●".repeat(Math.min(val.length, 24)) || '<span style="color:#374151;font-style:italic">üres</span>')
                     : (escHtml(val) || '<span style="color:#374151;font-style:italic">üres</span>'));
    valEl.innerHTML = displayed;
  }
}

/* ── MENTÉS SÁV ──────────────────────────────────────────── */
function updateSaveBar() {
  const bar = document.getElementById("envSaveBar");
  const count = Object.keys(_pendingChanges).length;
  if (count > 0) {
    bar.style.display = "flex";
    document.getElementById("envPendingCount").textContent = count;
  } else {
    bar.style.display = "none";
  }
}

async function saveAllChanges() {
  const btn = document.getElementById("envSaveBtn");
  const statusEl = document.getElementById("envSaveStatus");
  btn.disabled = true;
  btn.textContent = "⏳ Mentés...";
  statusEl.textContent = "";

  let ok = 0, fail = 0;
  for (const [key, value] of Object.entries(_pendingChanges)) {
    try {
      const res = await fetch("/api/admin/env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: _serverPass, key, value }),
      });
      if (res.ok) {
        // Frissítjük a lokális cache-t
        for (const entries of Object.values(_envGrouped)) {
          const e = entries.find(x => x.key === key);
          if (e) e.value = value;
        }
        ok++;
      } else fail++;
    } catch { fail++; }
  }

  _pendingChanges = {};
  btn.disabled = false;
  btn.textContent = "💾 Mentés";
  statusEl.textContent = fail > 0 ? `⚠️ ${ok} mentve, ${fail} hiba` : `✅ ${ok} változó elmentve`;
  updateSaveBar();

  // Sorok visszaállítása (zöld kiemelés eltávolítása)
  document.querySelectorAll("[id^='row-']").forEach(row => {
    row.style.background = "";
    row.querySelector(".pending-badge")?.remove();
  });
}

function discardChanges() {
  _pendingChanges = {};
  updateSaveBar();
  document.querySelectorAll("[id^='row-']").forEach(row => {
    row.style.background = "";
    row.querySelector(".pending-badge")?.remove();
  });
  // Visszatöltjük az eredeti értékeket
  renderEnvPanel();
}

/* ── ÚJRAINDÍTÁS ─────────────────────────────────────────── */
async function restartServer() {
  if (!confirm("Biztosan újraindítod a szervert? Néhány másodpercre elérhetetlenné válik az oldal.")) return;
  const statusEl = document.getElementById("envSaveStatus");
  statusEl.textContent = "⏳ Újraindítás...";
  try {
    await fetch("/api/admin/env/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password: _serverPass }),
    });
    statusEl.textContent = "🔄 Újraindítás folyamatban... (5mp múlva visszatölt)";
    setTimeout(() => location.reload(), 5000);
  } catch {
    statusEl.textContent = "❌ Hiba az újraindításnál";
  }
}

/* ── ZÁROLÁS ─────────────────────────────────────────────── */
function lockEnvPanel() {
  _envGrouped = {};
  _pendingChanges = {};
  _serverPass = "";
  _revealed.clear();
  document.getElementById("serverEnvPanel").style.display = "none";
  document.getElementById("serverLockScreen").style.display = "block";
  document.getElementById("envGroupsContainer").innerHTML = "";
  document.getElementById("envSaveBar").style.display = "none";
}

/* ── KERESÉS ─────────────────────────────────────────────── */
function filterEnvSearch() {
  const q = document.getElementById("envSearch").value.toLowerCase().trim();
  document.querySelectorAll("#envGroupsContainer > div").forEach(section => {
    const rows = section.querySelectorAll("tbody tr[id^='row-']");
    let anyVisible = false;
    rows.forEach(row => {
      const key = row.id.replace("row-", "").toLowerCase();
      const valEl = document.getElementById("val-" + row.id.replace("row-", ""));
      const val = (valEl?.textContent || "").toLowerCase();
      const match = !q || key.includes(q) || val.includes(q);
      row.style.display = match ? "" : "none";
      const editRow = document.getElementById("edit-" + row.id.replace("row-", ""));
      if (editRow) editRow.style.display = "none";
      if (match) anyVisible = true;
    });
    section.style.display = anyVisible || !q ? "" : "none";
    // Ha keresés aktív, nyissa ki a csoportot
    if (q && anyVisible) {
      const body = section.querySelector(".group-body");
      const chevron = section.querySelector(".chevron");
      if (body) body.style.display = "";
      if (chevron) chevron.textContent = "▼";
    }
  });
}

/* ── SEGÉD ───────────────────────────────────────────────── */
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
