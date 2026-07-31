function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) { location.replace("/index.html"); return; }
    const user = await res.json();
    if (user.role !== "admin") { location.replace("/index.html"); return; }

    document.body.classList.remove("hidden");

    initTabs();
    loadUsers();
    loadAnnouncements();
    loadMangas();

    document.getElementById("annForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("annTitle").value.trim();
      const body = document.getElementById("annBody").value.trim();
      const image_url = document.getElementById("annImage").value.trim();
      const days = document.getElementById("annDays").value;

      const url = editingAnnId ? `/api/announcements/${editingAnnId}` : "/api/announcements";
      const method = editingAnnId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, image_url, days })
      });

      if (res.ok) {
        cancelAnnEdit();
        loadAnnouncements();
      }
    });

    document.getElementById("annCancelEdit").addEventListener("click", cancelAnnEdit);

  } catch (err) {
    console.error(err);
    location.replace("/index.html");
  }
});
/* ===== TABS ===== */
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "tab-libraries") loadUploaderRoots();
      if (btn.dataset.tab === "tab-gifts") loadGifts();
      if (btn.dataset.tab === "tab-api-usage") loadApiUsage();
      if (btn.dataset.tab === "tab-subtitle-requests") loadSubtitleRequests();
      if (btn.dataset.tab === "tab-anime-catalog") loadAnimeCatalog();
    });
  });
}

/* ===== KÖNYVTÁRAK ===== */
async function loadUploaderRoots() {
  const listEl = document.getElementById("uploaderRootsList");
  const hintEl = document.getElementById("kavitaDirsHint");
  if (!listEl) return;

  listEl.innerHTML = "<p style='color:#888'>Betöltés...</p>";

  let users, uploaderNames, dirs;
  try {
    const [rootsRes, dirsRes] = await Promise.all([
      fetch("/api/admin/uploader-roots"),
      fetch("/api/admin/kavita-dirs")
    ]);
    const rootsData = await rootsRes.json();
    dirs = await dirsRes.json();
    users = Array.isArray(rootsData) ? rootsData : rootsData.users;
    uploaderNames = Array.isArray(rootsData) ? [] : (rootsData.uploaderNames || []);
    if (!Array.isArray(dirs)) dirs = [];
  } catch (err) {
    listEl.innerHTML = `<p style='color:#ef4444'>Betöltési hiba: ${escHtml(String(err))}</p>`;
    return;
  }

  hintEl.innerHTML = dirs.length
    ? "<span style='color:#888;font-size:.8rem;margin-right:4px'>Elérhető mappák:</span>" +
      dirs.map(d => `<span class="dir-chip" onclick="fillRoot('${escHtml(d)}')" style="background:#1e293b;color:#a78bfa;padding:3px 10px;border-radius:20px;font-size:.8rem;cursor:pointer">${escHtml(d)}</span>`).join("")
    : "<span style='color:#555;font-size:.8rem'>Nincs mappa a Kavita könyvtárban.</span>";

  const sectionStyle = "margin:0 0 6px;font-size:.8rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em";
  const rowStyle = "display:flex;align-items:center;gap:12px;background:#0f172a;border-radius:12px;padding:14px 16px;margin-bottom:10px;flex-wrap:wrap";

  let html = "";

  // Szinkronizálás gomb
  html += `<div style="margin-bottom:16px">
    <button onclick="syncUploaderManga()" id="syncBtn"
      style="background:#0f172a;color:#94a3b8;border:1px solid #334155;padding:7px 18px;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:600">
      🔄 Feltöltők szinkronizálása mangákhoz
    </button>
    <span id="syncStatus" style="margin-left:10px;font-size:.82rem;color:#22c55e;display:none"></span>
  </div>`;

  // Felhasználói fiókok szekció
  html += `<p style="${sectionStyle}">Felhasználói fiókok (Admin / Uploader)</p>`;
  if (!users || !users.length) {
    html += `<p style="color:#555;font-size:.88rem;margin-bottom:16px">Nincs Admin/Uploader tier felhasználó.</p>`;
  } else {
    html += users.map(u => {
      const currentRoot = u.uploader_root || u.username;
      const tierColor = u.tier === "Admin" ? "#a78bfa" : "#86efac";
      return `
        <div class="uploader-root-row" style="${rowStyle}">
          <span style="font-weight:600;min-width:120px">${escHtml(u.username)}</span>
          <span style="background:${tierColor}22;color:${tierColor};padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:700">${escHtml(u.tier)}</span>
          <input id="root-input-${u.id}" type="text" value="${escHtml(currentRoot)}"
            placeholder="pl. felhasználonev/almappa"
            style="flex:1;min-width:180px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:7px 12px;color:#fff;font-size:.88rem">
          <button onclick="saveUploaderRoot(${u.id})"
            style="background:#7c3aed;color:#fff;border:none;padding:7px 16px;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem;white-space:nowrap">
            💾 Mentés
          </button>
          <span id="root-status-${u.id}" style="font-size:.8rem;color:#22c55e;display:none">✓ Elmentve</span>
        </div>`;
    }).join("");
  }

  // Névsor feltöltők szekció
  html += `<p style="${sectionStyle};margin-top:20px">Névsor feltöltők (uploader_names)</p>`;
  if (!uploaderNames || !uploaderNames.length) {
    html += `<p style="color:#555;font-size:.88rem">Nincs névsor bejegyzés.</p>`;
  } else {
    html += uploaderNames.map(un => {
      const safeId = encodeURIComponent(un.name);
      return `
        <div class="uploader-root-row" style="${rowStyle}">
          <span style="font-weight:600;min-width:120px">${escHtml(un.name)}</span>
          <span style="background:#1e40af22;color:#60a5fa;padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:700">Feltöltő</span>
          <input id="name-root-input-${safeId}" data-name="${escHtml(un.name)}" type="text" value="${escHtml(un.root_path || '')}"
            placeholder="pl. FeltoltoNeve/almappa"
            style="flex:1;min-width:180px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:7px 12px;color:#fff;font-size:.88rem">
          <button data-name="${escHtml(un.name)}" onclick="saveUploaderNameRoot(this)"
            style="background:#1d4ed8;color:#fff;border:none;padding:7px 16px;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem;white-space:nowrap">
            💾 Mentés
          </button>
          <span id="name-root-status-${safeId}" style="font-size:.8rem;color:#22c55e;display:none">✓ Elmentve</span>
        </div>`;
    }).join("");
  }

  listEl.innerHTML = html;
}

async function saveUploaderRoot(userId) {
  const input = document.getElementById(`root-input-${userId}`);
  const status = document.getElementById(`root-status-${userId}`);
  const root = input.value.trim();

  const res = await fetch(`/api/admin/uploader-root/${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root })
  });

  if (res.ok) {
    status.style.display = "inline";
    setTimeout(() => { status.style.display = "none"; }, 2000);
  } else {
    const err = await res.json();
    alert("Hiba: " + (err.error || "ismeretlen"));
  }
}

async function saveUploaderNameRoot(btn) {
  const name = btn.dataset.name;
  const safeId = encodeURIComponent(name);
  const input = document.getElementById(`name-root-input-${safeId}`);
  const status = document.getElementById(`name-root-status-${safeId}`);
  const root = input.value.trim();

  const res = await fetch("/api/admin/uploader-name-root", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, root })
  });

  if (res.ok) {
    status.style.display = "inline";
    setTimeout(() => { status.style.display = "none"; }, 2000);
  } else {
    const err = await res.json();
    alert("Hiba: " + (err.error || "ismeretlen"));
  }
}

async function syncUploaderManga() {
  const btn = document.getElementById("syncBtn");
  const status = document.getElementById("syncStatus");
  btn.disabled = true;
  btn.textContent = "⏳ Szinkronizálás...";
  status.style.display = "none";

  try {
    const res = await fetch("/api/admin/sync-uploader-manga", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      status.textContent = `✓ ${data.updated} manga frissítve`;
      status.style.display = "inline";
    } else {
      alert("Hiba: " + (data.error || "ismeretlen"));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Feltöltők szinkronizálása mangákhoz";
  }
}

function fillRoot(dir) {
  const focused = document.activeElement;
  if (focused && (focused.id.startsWith("root-input-") || focused.id.startsWith("name-root-input-"))) {
    focused.value = dir;
  } else {
    const first = document.querySelector("[id^='root-input-'], [id^='name-root-input-']");
    if (first) first.value = dir;
  }
}
window.saveUploaderRoot = saveUploaderRoot;
window.saveUploaderNameRoot = saveUploaderNameRoot;
window.syncUploaderManga = syncUploaderManga;
window.fillRoot = fillRoot;

/* ===== FELHASZNÁLÓK ===== */
let allUsers = [];

async function loadUsers() {
  const res = await fetch("/api/admin/users");
  allUsers = await res.json();

  const searchInput = document.getElementById("userSearchInput");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", () => renderUsersList(searchInput.value));
  }

  renderUsersList(searchInput ? searchInput.value : "");
}

function renderUsersList(query) {
  const q = (query || "").trim().toLowerCase();
  const filtered = q ? allUsers.filter(u => u.username.toLowerCase().includes(q)) : allUsers;

  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = "";

  if (!filtered.length) {
    tbody.innerHTML = "<tr><td colspan='9' style='color:#aaa;padding:1rem'>Nincs találat.</td></tr>";
    return;
  }

  filtered.forEach(u => {
    const patreonActive = u.active === true;
    const anilistActive = u.anilist_connected === true;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${escHtml(u.username)}</td>
      <td>${u.points ?? 0} pont</td>
      <td><span class="role role-${escHtml(u.role)}">${escHtml(u.role)}</span></td>
      <td><span class="patreon ${patreonActive ? 'on' : 'off'}">${patreonActive ? '✅ Aktív' : '❌ Nincs'}</span></td>
      <td>${escHtml(u.tier || '—')}</td>
      <td style="text-align:center;font-size:1rem">${u.email_verified ? '✅' : '❌'}</td>
      <td><span class="patreon ${anilistActive ? 'on' : 'off'}">${anilistActive ? '✅ Aktív' : '❌ Nincs'}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString('hu-HU')}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ===== KIÍRÁSOK ===== */
let editingAnnId = null;
let annItemsCache = [];

async function loadAnnouncements() {
  const res = await fetch("/api/announcements");
  const items = await res.json();
  annItemsCache = items;
  const list = document.getElementById("annList");
  list.innerHTML = "";

  if (!items.length) {
    list.innerHTML = "<p style='color:#aaa'>Nincs aktív kiírás.</p>";
    return;
  }

  items.forEach(a => {
    const div = document.createElement("div");
    div.className = "ann-item";
    div.innerHTML = `
      <div class="ann-item-info">
        <h3>${escHtml(a.title)}</h3>
        <p>${escHtml(a.body?.slice(0, 100))}${a.body?.length > 100 ? "…" : ""}</p>
        <p>Lejár: ${new Date(a.expires_at).toLocaleDateString("hu-HU")}</p>
      </div>
      <div class="ann-item-actions">
        <button class="ann-edit" data-id="${a.id}">✏️ Szerkesztés</button>
        <button class="ann-delete" data-id="${a.id}">Törlés</button>
      </div>
    `;
    div.querySelector(".ann-edit").addEventListener("click", () => startAnnEdit(a.id));
    div.querySelector(".ann-delete").addEventListener("click", function() { deleteAnn(a.id, this); });
    list.appendChild(div);
  });
}

function startAnnEdit(id) {
  const a = annItemsCache.find(x => x.id === id);
  if (!a) return;

  editingAnnId = id;
  document.getElementById("annTitle").value = a.title || "";
  document.getElementById("annBody").value = a.body || "";
  document.getElementById("annImage").value = a.image_url || "";
  // A napok számát nem tároljuk közvetlenül, csak a lejárati dátumot —
  // a hátralévő napok számát ajánljuk fel alapértékként.
  const remainingDays = Math.max(1, Math.ceil((new Date(a.expires_at) - Date.now()) / 86400000));
  document.getElementById("annDays").value = remainingDays;

  document.querySelector("#annForm button[type=submit]").textContent = "💾 Mentés";
  document.getElementById("annCancelEdit").style.display = "inline-block";
  document.getElementById("annForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelAnnEdit() {
  editingAnnId = null;
  document.getElementById("annForm").reset();
  document.querySelector("#annForm button[type=submit]").textContent = "➕ Kiírás hozzáadása";
  document.getElementById("annCancelEdit").style.display = "none";
}

async function deleteAnn(id, btn) {
  btn.disabled = true;
  await fetch(`/api/announcements/${id}`, { method: "DELETE" });
  loadAnnouncements();
}

/* ===== MANGÁK ===== */
let allMangas = [];

async function loadMangas() {
  const res = await fetch("/api/admin/mangas");
  allMangas = await res.json();

  const searchInput = document.getElementById("mangaSearchInput");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", () => renderMangaList(searchInput.value));
  }

  renderMangaList(searchInput ? searchInput.value : "");
}

function renderMangaList(query) {
  const q = (query || "").trim().toLowerCase();
  const filtered = q ? allMangas.filter(m => m.title.toLowerCase().includes(q)) : allMangas;

  const container = document.getElementById("mangaAdminList");
  container.innerHTML = "";

  if (!filtered.length) {
    container.innerHTML = "<p style='color:#aaa; padding:1rem;'>Nincs találat.</p>";
    return;
  }

  filtered.forEach(m => {
    const block = document.createElement("div");
    block.className = "manga-admin-block";
    block.innerHTML = `
      <div class="manga-admin-header">
        <span>📖 ${escHtml(m.title)}</span>
        <span class="manga-toggle-icon">▶</span>
      </div>
      <div class="manga-admin-chapters hidden" id="chapters-${escHtml(m.slug)}">
        <p style="color:#aaa; padding:1rem;">Betöltés...</p>
      </div>
    `;
    block.querySelector(".manga-admin-header").addEventListener("click", function() { toggleManga(m.slug, this); });
    container.appendChild(block);
  });
}

async function toggleManga(slug, headerEl) {
  const panel = document.getElementById(`chapters-${slug}`);
  const icon = headerEl.querySelector(".manga-toggle-icon");

  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    icon.textContent = "▶";
    return;
  }

  panel.classList.remove("hidden");
  icon.textContent = "▼";

  const res = await fetch(`/api/admin/manga/${slug}/chapters`);
  const chapters = await res.json();

  if (!chapters.length) {
    panel.innerHTML = "<p style='color:#aaa; padding:1rem;'>Nincs fejezet.</p>";
    return;
  }

  const now = new Date();
  panel.innerHTML = `
    <table class="users-table">
      <thead>
        <tr>
          <th>Fejezet</th>
          <th>Feltöltve</th>
          <th>Feloldás</th>
          <th>Hátra</th>
          <th>Módosítás</th>
          <th>Törlés</th>
        </tr>
      </thead>
      <tbody>
        ${chapters.map(ch => {
          const unlocks = ch.unlocks_at ? new Date(ch.unlocks_at) : null;
          const isLocked = unlocks && unlocks > now;
          const hoursLeft = unlocks
            ? Math.ceil((unlocks - now) / 3600000)
            : null;

          return `
            <tr id="row-${ch.id}">
              <td>${escHtml(ch.folder)}</td>
              <td>${new Date(ch.scanned_at).toLocaleString("hu-HU")}</td>
              <td>${unlocks ? unlocks.toLocaleString("hu-HU") : "—"}</td>
              <td style="color:${isLocked ? '#f59e0b' : '#22c55e'}">
                ${isLocked ? `⏳ ${hoursLeft} óra` : '✅ Szabad'}
              </td>
              <td>
                <div style="display:flex; gap:6px; align-items:center;">
                  <button data-id="${ch.id}" data-h="-1"  data-slug="${escHtml(slug)}" class="ann-delete adj-btn" style="background:#1f2937;">−1h</button>
                  <button data-id="${ch.id}" data-h="1"   data-slug="${escHtml(slug)}" class="ann-delete adj-btn" style="background:#1f2937;">+1h</button>
                  <button data-id="${ch.id}" data-h="-24" data-slug="${escHtml(slug)}" class="ann-delete adj-btn" style="background:#1f2937;">−24h</button>
                  <button data-id="${ch.id}" data-h="24"  data-slug="${escHtml(slug)}" class="ann-delete adj-btn" style="background:#1f2937;">+24h</button>
                </div>
              </td>
              <td>
                <button data-id="${ch.id}" data-slug="${escHtml(slug)}" class="ann-delete del-ch-btn">🗑️ Törlés</button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  panel.querySelectorAll(".adj-btn").forEach(btn => {
    btn.addEventListener("click", () =>
      adjustUnlock(btn.dataset.id, parseInt(btn.dataset.h), btn.dataset.slug)
    );
  });
  panel.querySelectorAll(".del-ch-btn").forEach(btn => {
    btn.addEventListener("click", () =>
      deleteChapter(btn.dataset.id, btn.dataset.slug)
    );
  });
}

async function adjustUnlock(chapterId, hours, slug) {
  await fetch(`/api/admin/chapter/${chapterId}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hours })
  });
  const header = document.querySelector(`#chapters-${slug}`).previousElementSibling;
  await toggleManga(slug, header);
  await toggleManga(slug, header);
}

async function deleteChapter(chapterId, slug) {
  if (!confirm("Biztosan törlöd ezt a fejezetet? Ez a DB-ből és R2-ről (ha fel van töltve) is véglegesen törli a képeket.")) return;
  await fetch(`/api/admin/chapter/${chapterId}`, { method: "DELETE" });
  const header = document.querySelector(`#chapters-${slug}`).previousElementSibling;
  await toggleManga(slug, header);
  await toggleManga(slug, header);
}

/* ===== API KULCSOK ===== */
async function loadApiUsage() {
  const listEl = document.getElementById("apiUsageList");
  if (!listEl) return;
  listEl.innerHTML = "<p style='color:#888'>Betöltés...</p>";

  const [usageRes, keysRes] = await Promise.all([
    fetch("/api/admin/api-usage"),
    fetch("/api/admin/gemini-keys"),
  ]);
  if (!usageRes.ok || !keysRes.ok) { listEl.innerHTML = "<p style='color:#ef4444'>Betöltési hiba</p>"; return; }
  const data = await usageRes.json();
  const keys = await keysRes.json();

  const cardStyle = "background:#0f172a;border-radius:10px;padding:14px 18px;margin-bottom:10px;max-width:560px";

  const GEMINI_DAILY_LIMIT = 500; // napi ingyenes limit kulcsonként (gemini-3.1-flash-lite) — NEM havi

  const geminiCards = keys.map(k => {
    const usage = data.gemini.find(g => g.label === k.label);
    const exhausted = usage?.exhausted;
    const today = usage?.today ?? 0;
    const todayPct = Math.min(100, Math.round((today / GEMINI_DAILY_LIMIT) * 100));
    const barColor = todayPct >= 90 ? "#ef4444" : todayPct >= 70 ? "#f59e0b" : "#22c55e";
    const badge = exhausted
      ? `<span style="background:#7f1d1d33;color:#f87171;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700">⚠️ Kimerült ma</span>`
      : `<span style="background:#14532d33;color:#86efac;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700">✅ OK</span>`;
    return `<div style="${cardStyle}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="color:#e2e8f0">${escHtml(k.label)}</strong>
        <div style="display:flex;align-items:center;gap:8px">
          ${badge}
          <button onclick="deleteGeminiKey(${k.id}, '${escHtml(k.label).replace(/'/g, "\\'")}')" title="Kulcs törlése"
            style="background:#1e293b;color:#f87171;border:1px solid #334155;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:.75rem">🗑</button>
        </div>
      </div>
      <div style="color:#64748b;font-size:.78rem;font-family:monospace;margin-bottom:6px">${escHtml(k.keyMasked)}</div>
      <div style="background:#1e293b;border-radius:6px;height:6px;overflow:hidden;margin-bottom:6px">
        <div style="background:${barColor};height:100%;width:${todayPct}%"></div>
      </div>
      <div style="color:#94a3b8;font-size:.85rem">
        Ma: <strong style="color:#e2e8f0">${today}</strong> / ${GEMINI_DAILY_LIMIT} kérés <span style="color:#64748b">(napi limit)</span> &nbsp;•&nbsp;
        E hónapban összesen: <strong style="color:#e2e8f0">${usage?.thisMonth ?? 0}</strong> kérés
        ${usage?.thisMonthFailures > 0 ? ` (<span style="color:#f87171">${usage.thisMonthFailures} hiba</span>)` : ""}
      </div>
    </div>`;
  }).join("") || `<p style="color:#64748b;font-size:.85rem">Nincs beállítva Gemini kulcs.</p>`;

  const addKeyForm = `<div style="${cardStyle};border:1px dashed #334155">
    <strong style="color:#e2e8f0;display:block;margin-bottom:8px">➕ Új Gemini kulcs hozzáadása</strong>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="newGeminiKeyLabel" placeholder="Címke (opcionális)" style="flex:1;min-width:120px;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 10px;color:#e2e8f0;font-size:.85rem">
      <input id="newGeminiKeyValue" placeholder="API kulcs" style="flex:2;min-width:200px;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 10px;color:#e2e8f0;font-size:.85rem">
      <button onclick="addGeminiKey()" style="background:#7c3aed;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.85rem;font-weight:700">Hozzáadás</button>
    </div>
    <div id="newGeminiKeyStatus" style="font-size:.8rem;margin-top:6px"></div>
  </div>`;

  const d = data.deepl;
  const hasUsage = d.characterCount != null && d.characterLimit != null;
  const pct = hasUsage ? Math.round((d.characterCount / d.characterLimit) * 100) : null;
  const barColor = pct == null ? "#334155" : pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#22c55e";
  const deeplCard = `<div style="${cardStyle}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong style="color:#e2e8f0">DeepL</strong>
      ${pct != null && pct >= 90
        ? `<span style="background:#7f1d1d33;color:#f87171;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700">⚠️ Majdnem elfogyott</span>`
        : `<span style="background:#14532d33;color:#86efac;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700">✅ OK</span>`}
    </div>
    ${hasUsage ? `
      <div style="background:#1e293b;border-radius:6px;height:8px;overflow:hidden;margin-bottom:6px">
        <div style="background:${barColor};height:100%;width:${pct}%"></div>
      </div>
      <div style="color:#94a3b8;font-size:.85rem">
        ${d.characterCount.toLocaleString("hu-HU")} / ${d.characterLimit.toLocaleString("hu-HU")} karakter ebben a hónapban (${pct}%)
      </div>
    ` : `<div style="color:#64748b;font-size:.85rem">A karakter-kvóta lekérdezése nem sikerült.</div>`}
    <div style="color:#94a3b8;font-size:.85rem;margin-top:4px">
      E hónapban: <strong style="color:#e2e8f0">${d.thisMonthRequests}</strong> kérés
      ${d.thisMonthFailures > 0 ? ` (<span style="color:#f87171">${d.thisMonthFailures} hiba</span>)` : ""}
    </div>
  </div>`;

  listEl.innerHTML = `
    <h3 style="color:#a78bfa;font-size:.95rem;margin:0 0 10px">Gemini (automatikus rotáció a kulcsok között)</h3>
    ${geminiCards}
    ${addKeyForm}
    <h3 style="color:#a78bfa;font-size:.95rem;margin:20px 0 10px">DeepL (leírás-fordítás elsődleges motorja)</h3>
    ${deeplCard}
  `;
}

async function addGeminiKey() {
  const labelEl = document.getElementById("newGeminiKeyLabel");
  const valueEl = document.getElementById("newGeminiKeyValue");
  const statusEl = document.getElementById("newGeminiKeyStatus");
  const apiKey = valueEl.value.trim();
  if (!apiKey) { statusEl.innerHTML = `<span style="color:#f87171">Add meg az API kulcsot</span>`; return; }

  statusEl.innerHTML = `<span style="color:#94a3b8">Ellenőrzés...</span>`;
  const res = await fetch("/api/admin/gemini-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: labelEl.value.trim(), apiKey }),
  });
  const data = await res.json();
  if (!res.ok) { statusEl.innerHTML = `<span style="color:#f87171">${escHtml(data.error || "Hiba")}</span>`; return; }

  labelEl.value = "";
  valueEl.value = "";
  loadApiUsage();
}

async function deleteGeminiKey(id, label) {
  if (!confirm(`Biztosan törlöd a(z) "${label}" kulcsot?`)) return;
  const res = await fetch(`/api/admin/gemini-keys/${id}`, { method: "DELETE" });
  if (!res.ok) { alert("Törlés sikertelen"); return; }
  loadApiUsage();
}

/* ===== FELIRAT-KÉRÉSEK ===== */
async function loadSubtitleRequests() {
  const listEl = document.getElementById("subtitleRequestsList");
  if (!listEl) return;
  listEl.innerHTML = "<p style='color:#888'>Betöltés...</p>";

  const res = await fetch("/api/admin/subtitle-requests");
  if (!res.ok) { listEl.innerHTML = "<p style='color:#ef4444'>Betöltési hiba</p>"; return; }
  const rows = await res.json();

  if (!rows.length) {
    listEl.innerHTML = `<p style="color:#64748b;font-size:.85rem">Nincs függőben lévő kérés.</p>`;
    return;
  }

  const cardStyle = "background:#0f172a;border-radius:10px;padding:14px 18px;margin-bottom:10px;max-width:640px;display:flex;gap:14px;align-items:center";

  listEl.innerHTML = rows.map(r => {
    const what = r.episode_number
      ? `${r.season_number}. évad ${r.episode_number}. rész`
      : `${r.season_number}. évad (teljes)`;
    return `<div style="${cardStyle}">
      <img src="${escHtml(r.cover_url || '/assets/no-cover.png')}" style="width:46px;height:66px;object-fit:cover;border-radius:6px;background:#1a1a2e;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <strong style="color:#e2e8f0">${escHtml(r.anime_title)}</strong>
        <div style="color:#94a3b8;font-size:.85rem;margin-top:2px">${escHtml(what)}</div>
        <div style="color:#64748b;font-size:.78rem;margin-top:4px">
          Kérte: <strong style="color:#a78bfa">${escHtml(r.username || "ismeretlen")}</strong> &nbsp;•&nbsp;
          ${new Date(r.created_at).toLocaleDateString("hu-HU")}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="updateSubtitleRequestStatus(${r.id}, 'done')" title="Kész"
          style="background:#14532d33;color:#86efac;border:1px solid #22c55e55;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:700">✅ Kész</button>
        <button onclick="updateSubtitleRequestStatus(${r.id}, 'rejected')" title="Elutasítás"
          style="background:#7f1d1d33;color:#f87171;border:1px solid #ef444455;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:700">✖ Elutasítás</button>
      </div>
    </div>`;
  }).join("");
}

async function updateSubtitleRequestStatus(id, status) {
  const res = await fetch(`/api/admin/subtitle-requests/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) { alert("Frissítés sikertelen"); return; }
  loadSubtitleRequests();
}

/* ===== ANIME KATALÓGUS ===== */
const loadedAnimeAdmin = new Set();

async function loadAnimeCatalog() {
  const listEl = document.getElementById("animeCatalogList");
  if (!listEl) return;
  listEl.innerHTML = "<p style='color:#888'>Betöltés...</p>";

  const res = await fetch("/api/anime");
  if (!res.ok) { listEl.innerHTML = "<p style='color:#ef4444'>Betöltési hiba</p>"; return; }
  const rows = await res.json();

  if (!rows.length) {
    listEl.innerHTML = `<p style="color:#64748b;font-size:.85rem">Nincs anime a katalógusban.</p>`;
    return;
  }

  loadedAnimeAdmin.clear();
  listEl.innerHTML = rows.map(a => `
    <div style="background:#0f172a;border-radius:10px;margin-bottom:10px;max-width:700px;overflow:hidden" id="animeCard-${a.id}">
      <div style="display:flex;gap:14px;align-items:center;padding:14px 18px;cursor:pointer" onclick="toggleAnimeCatalog(${a.id}, '${escHtml(a.slug)}')">
        <img src="${escHtml(a.cover_url || '/assets/no-cover.png')}" style="width:46px;height:66px;object-fit:cover;border-radius:6px;background:#1a1a2e;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <strong style="color:#e2e8f0">${escHtml(a.title)}</strong>
          <div style="color:#64748b;font-size:.78rem;margin-top:2px">${a.episode_count} feltöltött rész &nbsp;•&nbsp; slug: ${escHtml(a.slug)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0" onclick="event.stopPropagation()">
          <button onclick="startEditAnime(${a.id}, ${escHtml(JSON.stringify(a.title))}, ${escHtml(JSON.stringify(a.cover_url || ""))})"
            style="background:#1e293b;color:#93c5fd;border:1px solid #334155;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:.78rem">✏️ Szerkesztés</button>
          <button onclick="deleteAnimeCatalog(${a.id}, ${escHtml(JSON.stringify(a.title))})"
            style="background:#1e293b;color:#f87171;border:1px solid #334155;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:.78rem">🗑 Törlés</button>
        </div>
      </div>
      <div id="animeEdit-${a.id}" style="display:none;padding:0 18px 14px"></div>
      <div id="animeBody-${a.id}" style="display:none;padding:0 18px 14px;border-top:1px solid #1e293b"></div>
    </div>
  `).join("");
}

async function toggleAnimeCatalog(id, slug) {
  const body = document.getElementById(`animeBody-${id}`);
  if (body.style.display === "block") { body.style.display = "none"; return; }
  body.style.display = "block";
  if (loadedAnimeAdmin.has(id)) return;
  loadedAnimeAdmin.add(id);

  body.innerHTML = "<p style='color:#888;font-size:.85rem'>Betöltés...</p>";
  const res = await fetch(`/api/anime/${encodeURIComponent(slug)}`);
  if (!res.ok) { body.innerHTML = "<p style='color:#ef4444;font-size:.85rem'>Betöltési hiba</p>"; return; }
  const anime = await res.json();

  if (!anime.seasons?.length) {
    body.innerHTML = "<p style='color:#64748b;font-size:.85rem;padding-top:10px'>Nincs feltöltött évad.</p>";
    return;
  }

  body.innerHTML = anime.seasons.map(s => `
    <div style="padding-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong style="color:#c4b5fd;font-size:.85rem">${s.season_number}. évad</strong>
        <button onclick="deleteAnimeSeason(${s.id}, ${id}, '${escHtml(slug)}')"
          style="background:#1e293b;color:#f87171;border:1px solid #334155;padding:3px 9px;border-radius:6px;cursor:pointer;font-size:.72rem">🗑 Évad törlése</button>
      </div>
      ${s.episodes.length ? s.episodes.map(ep => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;background:#1a1a2e;border-radius:6px;margin-bottom:4px;font-size:.82rem;color:#ddd">
          <span>${ep.episode_number}. rész</span>
          <button onclick="deleteAnimeEpisode(${ep.id}, ${id}, '${escHtml(slug)}')"
            style="background:none;color:#f87171;border:none;cursor:pointer;font-size:.75rem">🗑</button>
        </div>
      `).join("") : "<p style='color:#64748b;font-size:.8rem'>Nincs feltöltött rész.</p>"}
    </div>
  `).join("");
}

function startEditAnime(id, title, coverUrl) {
  const editEl = document.getElementById(`animeEdit-${id}`);
  editEl.style.display = "block";
  editEl.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:10px">
      <input id="animeEditTitle-${id}" value="${escHtml(title)}" placeholder="Cím"
        style="flex:2;min-width:180px;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 10px;color:#e2e8f0;font-size:.85rem">
      <input id="animeEditCover-${id}" value="${escHtml(coverUrl)}" placeholder="Borítókép URL"
        style="flex:3;min-width:220px;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 10px;color:#e2e8f0;font-size:.85rem">
      <button onclick="saveAnimeEdit(${id})" style="background:#7c3aed;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.85rem;font-weight:700">Mentés</button>
      <button onclick="document.getElementById('animeEdit-${id}').style.display='none'" style="background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.85rem">Mégse</button>
    </div>
    <div id="animeEditStatus-${id}" style="font-size:.8rem;margin-top:6px"></div>
  `;
}

async function saveAnimeEdit(id) {
  const title = document.getElementById(`animeEditTitle-${id}`).value.trim();
  const cover_url = document.getElementById(`animeEditCover-${id}`).value.trim();
  const statusEl = document.getElementById(`animeEditStatus-${id}`);
  if (!title) { statusEl.innerHTML = `<span style="color:#f87171">A cím kötelező</span>`; return; }

  const res = await fetch(`/api/admin/anime/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, cover_url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    statusEl.innerHTML = `<span style="color:#f87171">${escHtml(data.error || "Hiba")}</span>`;
    return;
  }
  loadAnimeCatalog();
}

async function deleteAnimeCatalog(id, title) {
  if (!confirm(`Biztosan törlöd a(z) "${title}" animét, minden évadával és részével együtt? Ez a felirat-fájlokat is törli a tárhelyről.`)) return;
  const res = await fetch(`/api/admin/anime/${id}`, { method: "DELETE" });
  if (!res.ok) { alert("Törlés sikertelen"); return; }
  loadAnimeCatalog();
}

async function deleteAnimeSeason(seasonId, animeId, slug) {
  if (!confirm("Biztosan törlöd ezt az évadot minden feltöltött résszel együtt?")) return;
  const res = await fetch(`/api/admin/anime/season/${seasonId}`, { method: "DELETE" });
  if (!res.ok) { alert("Törlés sikertelen"); return; }
  loadedAnimeAdmin.delete(animeId);
  loadAnimeCatalog();
}

async function deleteAnimeEpisode(episodeId, animeId, slug) {
  if (!confirm("Biztosan törlöd ezt a részt?")) return;
  const res = await fetch(`/api/admin/anime/episode/${episodeId}`, { method: "DELETE" });
  if (!res.ok) { alert("Törlés sikertelen"); return; }
  loadedAnimeAdmin.delete(animeId);
  loadAnimeCatalog();
}

/* ===== PATREON GIFT ===== */
async function loadGifts() {
  const statsEl = document.getElementById("giftsStats");
  const listEl  = document.getElementById("giftsList");
  if (!listEl) return;
  listEl.innerHTML = "<p style='color:#888'>Betöltés...</p>";

  const res = await fetch("/api/admin/patreon-gifts");
  if (!res.ok) { listEl.innerHTML = "<p style='color:#ef4444'>Betöltési hiba</p>"; return; }
  const gifts = await res.json();

  const available  = gifts.filter(g => g.status === "available");
  const purchased  = gifts.filter(g => g.status === "purchased");

  statsEl.innerHTML = `
    <div style="background:#14532d33;border:1px solid #16a34a44;border-radius:10px;padding:10px 18px;color:#86efac;font-weight:700">
      ✅ ${available.length} elérhető
    </div>
    <div style="background:#1e3a5f33;border:1px solid #3b82f644;border-radius:10px;padding:10px 18px;color:#93c5fd;font-weight:700">
      🛒 ${purchased.length} megvásárolt
    </div>
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px 18px;color:#64748b;font-weight:700">
      📦 Összesen: ${gifts.length}
    </div>`;

  if (!gifts.length) { listEl.innerHTML = "<p style='color:#555'>Nincs kód feltöltve.</p>"; return; }

  const rowStyle = "display:flex;align-items:center;gap:10px;background:#0f172a;border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap";
  listEl.innerHTML = gifts.map(g => {
    const isPurchased = g.status === "purchased";
    const statusBadge = isPurchased
      ? `<span style="background:#1e3a5f;color:#93c5fd;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700;white-space:nowrap">🛒 Megvásárolt</span>`
      : `<span style="background:#14532d33;color:#86efac;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700;white-space:nowrap">✅ Elérhető</span>`;

    const linkDisplay = isPurchased
      ? `<span style="color:#475569;font-size:.8rem;font-family:monospace">${escHtml(g.display_link)}</span>`
      : `<span id="gift-link-${g.id}" style="color:#475569;font-size:.8rem;font-family:monospace;filter:blur(4px);user-select:none">${escHtml(g.display_link)}</span>
         <button onclick="revealGift(${g.id})" title="Mutasd a linket"
           style="background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:.75rem;white-space:nowrap">👁</button>`;

    const purchaseInfo = isPurchased
      ? `<span style="color:#475569;font-size:.78rem">${escHtml(g.purchased_by_name || '?')} — ${new Date(g.purchased_at).toLocaleDateString("hu-HU")}</span>`
      : "";

    const deleteBtn = isPurchased ? "" :
      `<button onclick="deleteGift(${g.id})" title="Törlés"
        style="background:#7f1d1d33;color:#f87171;border:1px solid #7f1d1d55;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:.78rem;margin-left:auto;white-space:nowrap">🗑</button>`;

    return `<div style="${rowStyle}">
      ${statusBadge}
      <span style="color:#94a3b8;font-size:.8rem;white-space:nowrap">${g.duration_months} hó</span>
      <span style="color:#a78bfa;font-size:.8rem;white-space:nowrap">${g.cost_points} pont</span>
      ${linkDisplay}
      ${purchaseInfo}
      ${deleteBtn}
    </div>`;
  }).join("");
}

function revealGift(id) {
  const el = document.getElementById(`gift-link-${id}`);
  if (!el) return;
  el.style.filter = "none";
  el.style.userSelect = "text";
  // 10 másodperc után visszamaszkol
  setTimeout(() => { el.style.filter = "blur(4px)"; el.style.userSelect = "none"; }, 10000);
}

async function addGifts() {
  const textarea = document.getElementById("giftsLinks");
  const statusEl = document.getElementById("giftsAddStatus");
  const links = textarea.value.split("\n").map(l => l.trim()).filter(Boolean);
  if (!links.length) return;

  const duration_months = parseInt(document.getElementById("giftsDuration").value) || 1;
  const cost_points     = parseInt(document.getElementById("giftsCost").value) ?? 100;

  const res = await fetch("/api/admin/patreon-gifts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ links, duration_months, cost_points })
  });
  const data = await res.json();
  if (res.ok) {
    textarea.value = "";
    statusEl.textContent = `✓ ${data.added} kód hozzáadva`;
    statusEl.style.display = "inline";
    setTimeout(() => { statusEl.style.display = "none"; }, 3000);
    loadGifts();
  } else {
    alert("Hiba: " + (data.error || "ismeretlen"));
  }
}

async function deleteGift(id) {
  if (!confirm("Biztosan törlöd ezt a kódot?")) return;
  const res = await fetch(`/api/admin/patreon-gifts/${id}`, { method: "DELETE" });
  if (res.ok) loadGifts();
  else { const d = await res.json(); alert("Hiba: " + (d.error || "ismeretlen")); }
}

window.addGifts    = addGifts;
window.deleteGift  = deleteGift;
window.revealGift  = revealGift;

async function sendVerificationEmails() {
  const btn = document.getElementById("sendVerifyEmailsBtn");
  const statusEl = document.getElementById("sendVerifyStatus");
  if (!btn || !statusEl) return;
  if (!confirm("Biztosan elküldjük a verifikációs emaileket az összes nem megerősített tagnak? Ez akár 200 emailt küldhet egyszerre.")) return;
  btn.disabled = true;
  statusEl.textContent = "Küldés...";
  try {
    const res = await fetch("/api/admin/send-verification-emails", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      statusEl.textContent = `✅ ${data.sent} email elküldve (${data.failed} hiba, ${data.total} összesen)`;
    } else {
      statusEl.textContent = "❌ Hiba: " + (data.error || "ismeretlen");
      btn.disabled = false;
    }
  } catch (err) {
    statusEl.textContent = "❌ Szerver hiba";
    btn.disabled = false;
  }
}

window.sendVerificationEmails = sendVerificationEmails;
