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
    });
  });
}

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
      <td>${u.username}</td>
      <td>${u.email}</td>
      <td><span class="role role-${u.role}">${u.role}</span></td>
      <td><span class="patreon ${patreonActive ? 'on' : 'off'}">${patreonActive ? '✅ Aktív' : '❌ Nincs'}</span></td>
      <td>${u.tier || '—'}</td>
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
        <h3>${a.title}</h3>
        <p>${a.body?.slice(0, 100)}${a.body?.length > 100 ? "…" : ""}</p>
        <p>Lejár: ${new Date(a.expires_at).toLocaleDateString("hu-HU")}</p>
      </div>
      <button class="ann-delete" onclick="deleteAnn(${a.id}, this)">Törlés</button>
    `;
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
      <div class="manga-admin-header" onclick="toggleManga('${m.slug}', this)">
        <span>📖 ${m.title}</span>
        <span class="manga-toggle-icon">▶</span>
      </div>
      <div class="manga-admin-chapters hidden" id="chapters-${m.slug}">
        <p style="color:#aaa; padding:1rem;">Betöltés...</p>
      </div>
    `;
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
              <td>${ch.folder}</td>
              <td>${new Date(ch.scanned_at).toLocaleString("hu-HU")}</td>
              <td>${unlocks ? unlocks.toLocaleString("hu-HU") : "—"}</td>
              <td style="color:${isLocked ? '#f59e0b' : '#22c55e'}">
                ${isLocked ? `⏳ ${hoursLeft} óra` : '✅ Szabad'}
              </td>
              <td>
                <div style="display:flex; gap:6px; align-items:center;">
                  <button onclick="adjustUnlock(${ch.id}, -1, '${slug}')" class="ann-delete" style="background:#1f2937;">−1h</button>
                  <button onclick="adjustUnlock(${ch.id}, 1, '${slug}')" class="ann-delete" style="background:#1f2937;">+1h</button>
                  <button onclick="adjustUnlock(${ch.id}, -24, '${slug}')" class="ann-delete" style="background:#1f2937;">−24h</button>
                  <button onclick="adjustUnlock(${ch.id}, 24, '${slug}')" class="ann-delete" style="background:#1f2937;">+24h</button>
                </div>
              </td>
              <td>
                <button onclick="deleteChapter(${ch.id}, '${slug}')" class="ann-delete">🗑️ Törlés</button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
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
