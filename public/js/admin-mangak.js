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

      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, image_url, days })
      });

      if (res.ok) {
        e.target.reset();
        loadAnnouncements();
      }
    });

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
async function loadUsers() {
  const res = await fetch("/api/admin/users");
  const users = await res.json();
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = "";
  users.forEach(u => {
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
async function loadAnnouncements() {
  const res = await fetch("/api/announcements");
  const items = await res.json();
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
      <button class="ann-delete" data-id="${a.id}">Törlés</button>
    `;
    div.querySelector(".ann-delete").addEventListener("click", function() { deleteAnn(a.id, this); });
    list.appendChild(div);
  });
}

async function deleteAnn(id, btn) {
  btn.disabled = true;
  await fetch(`/api/announcements/${id}`, { method: "DELETE" });
  loadAnnouncements();
}

/* ===== MANGÁK ===== */
async function loadMangas() {
  const res = await fetch("/api/admin/mangas");
  const mangas = await res.json();
  const container = document.getElementById("mangaAdminList");
  container.innerHTML = "";

  mangas.forEach(m => {
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
  if (!confirm("Biztosan törlöd ezt a fejezetet a DB-ből?")) return;
  await fetch(`/api/admin/chapter/${chapterId}`, { method: "DELETE" });
  const header = document.querySelector(`#chapters-${slug}`).previousElementSibling;
  await toggleManga(slug, header);
  await toggleManga(slug, header);
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
