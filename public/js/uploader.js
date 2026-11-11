/* ══════════════════════════════════════════════════════════
   UPLOADER — Kavita fájlfeltöltő
   ══════════════════════════════════════════════════════════ */

const CONCURRENT = 4; // párhuzamos feltöltések száma
const STALL_MS = 45000;        // ennyi ideig semmi mozgás egy kérésen → megszakítás + újrapróbálás
const MAX_REQUEST_MS = 300000; // egy fájl feltöltésének felső határa

let currentPath = "";
let uploadQueue = []; // { file, relativePath, status, progress }
let currentItems = []; // az aktuálisan betöltött fájlok/mappák
let browserFilter = ""; // szűrési szöveg
let bugfixPromptShown = false; // egy feltöltési kör alatt csak egyszer kérdezzünk

/* ── DOM referenciák ── */
const dropZone     = document.getElementById("dropZone");
const fileInput    = document.getElementById("fileInput");
const folderInput  = document.getElementById("folderInput");
const uploadBtn    = document.getElementById("uploadBtn");
const clearBtn     = document.getElementById("clearBtn");
const queueSection = document.getElementById("queueSection");
const queueList    = document.getElementById("queueList");
const queueCount   = document.getElementById("queueCount");
const browserList    = document.getElementById("browserList");
const breadcrumb     = document.getElementById("breadcrumb");
const browserSearch  = document.getElementById("browserSearch");
const statTotal    = document.getElementById("statTotal");
const statDone     = document.getElementById("statDone");
const statError    = document.getElementById("statError");
const speedtestBtn    = document.getElementById("speedtestBtn");
const speedtestResult = document.getElementById("speedtestResult");

/* ══════════════════════════════════════════════════════════
   DRAG & DROP
   ══════════════════════════════════════════════════════════ */
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));

dropZone.addEventListener("drop", async e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const items = [...e.dataTransfer.items];
  const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  for (const entry of entries) {
    await collectEntry(entry, "");
  }
  renderQueue();
});

/* ── File input (sima fájlok) ── */
fileInput.addEventListener("change", () => {
  for (const f of fileInput.files) {
    addToQueue(f, f.name);
  }
  fileInput.value = "";
  renderQueue();
});

/* ── Folder input (mappa feltöltés) ── */
folderInput.addEventListener("change", () => {
  for (const f of folderInput.files) {
    addToQueue(f, f.webkitRelativePath || f.name);
  }
  folderInput.value = "";
  renderQueue();
});

/* ── FileSystemEntry bejárás (drag & drop mappák) ── */
async function collectEntry(entry, basePath) {
  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file(f => {
        const rel = basePath ? `${basePath}/${f.name}` : f.name;
        addToQueue(f, rel);
        resolve();
      });
    });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let allEntries = [];
    await new Promise(resolve => {
      function readBatch() {
        reader.readEntries(async batch => {
          if (!batch.length) { resolve(); return; }
          allEntries = allEntries.concat([...batch]);
          readBatch();
        });
      }
      readBatch();
    });
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    for (const child of allEntries) {
      await collectEntry(child, dirPath);
    }
  }
}

// A szerver csak képet fogad el (pl. Thumbs.db, ComicInfo.xml kimarad)
const UPLOAD_IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

function addToQueue(file, relativePath) {
  if (!UPLOAD_IMAGE_RE.test(file.name)) return;
  // Ne adjuk hozzá kétszer ugyanazt
  const key = relativePath;
  if (uploadQueue.find(i => i.relativePath === key && i.status !== "error")) return;
  uploadQueue.push({ file, relativePath, status: "pending", progress: 0 });
}

/* ══════════════════════════════════════════════════════════
   QUEUE RENDER
   ══════════════════════════════════════════════════════════ */
function escAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A hibás fájlok okai összevonva, darabszámmal, a feltöltési lista fölött
function renderUploadErrors() {
  const box = document.getElementById("uploadErrorBox");
  if (!box) return;
  const groups = new Map();
  for (const i of uploadQueue) {
    if (i.status !== "error") continue;
    const msg = i.errorMsg || "Ismeretlen hiba.";
    groups.set(msg, (groups.get(msg) || 0) + 1);
  }
  if (!groups.size) { box.classList.add("hidden"); box.textContent = ""; return; }
  box.classList.remove("hidden");
  box.textContent = "";
  const sorted = [...groups].sort((a, b) => b[1] - a[1]);
  for (const [msg, n] of sorted.slice(0, 4)) {
    const row = document.createElement("div");
    row.className = "upload-error-row";
    const cnt = document.createElement("strong");
    cnt.textContent = `❌ ${n} fájl nem ment fel: `;
    row.append(cnt, document.createTextNode(msg));
    box.appendChild(row);
  }
  if (sorted.length > 4) {
    const more = document.createElement("div");
    more.className = "upload-error-row";
    more.textContent = `…és még ${sorted.length - 4} másféle hiba (vidd az egeret egy hibás fájlra a részletekért).`;
    box.appendChild(more);
  }
}

function renderQueue() {
  renderUploadErrors();
  if (!uploadQueue.length) {
    // Ha épp a feltöltés utáni scan csíkja látszik, a szakasz maradjon látható
    const scanBox = document.getElementById("scanStatusMsg");
    if (scanBox && !scanBox.classList.contains("hidden")) {
      queueList.innerHTML = "";
      queueCount.textContent = "0";
      document.getElementById("overallProgressWrap")?.classList.add("hidden");
      return;
    }
    queueSection.classList.add("hidden");
    return;
  }
  queueSection.classList.remove("hidden");
  queueCount.textContent = uploadQueue.length;

  queueList.innerHTML = uploadQueue.map((item, i) => `
    <div class="queue-item" id="qi-${i}">
      ${item.exists && item.status === "pending" ? '<span title="Már létezik a szerveren" style="flex-shrink:0">⚠️</span>' : ""}
      <span class="queue-item-name" title="${item.relativePath}">${item.relativePath}</span>
      <span class="queue-item-size">${formatSize(item.file.size)}</span>
      <span class="queue-item-status ${item.status}"${item.status === "error" && item.errorMsg ? ` title="${escAttr(item.errorMsg)}"` : ""}>${statusLabel(item.status)}</span>
    </div>
    ${item.status === "uploading" || item.status === "retrying" ? `
      <div class="queue-progress">
        <div class="queue-progress-bar" style="width:${item.progress}%"></div>
      </div>` : ""}
  `).join("");

  const done    = uploadQueue.filter(i => i.status === "done").length;
  const skipped = uploadQueue.filter(i => i.status === "skipped").length;
  const error   = uploadQueue.filter(i => i.status === "error").length;
  const active  = uploadQueue.filter(i => i.status === "uploading" || i.status === "retrying" || i.status === "pending" || i.status === "login" || i.status === "network").length;

  statTotal.textContent = uploadQueue.length;
  statDone.textContent  = done;
  statError.textContent = error;

  // Összesített progress csík
  const progressWrap  = document.getElementById("overallProgressWrap");
  const progressFill  = document.getElementById("overallProgressFill");
  const progressLabel = document.getElementById("overallProgressLabel");
  const doneMsg       = document.getElementById("uploadDoneMsg");

  const total    = uploadQueue.length;
  const finished = done + skipped + error;
  const isActive = uploadQueue.some(i => i.status === "uploading" || i.status === "pending" || i.status === "login");

  if (isActive || finished > 0) {
    progressWrap.classList.remove("hidden");
    doneMsg.classList.add("hidden");

    // Részleges progress: befejezett fájlok + az éppen töltők jelenlegi %-a
    const partialDone = uploadQueue
      .filter(i => i.status === "uploading")
      .reduce((sum, i) => sum + (i.progress / 100), 0);
    const pct = total > 0 ? Math.round(((finished + partialDone) / total) * 100) : 0;

    progressFill.style.width  = pct + "%";
    progressLabel.textContent = pct + "%";

    if (finished === total && total > 0 && !isActive) {
      progressFill.style.width  = "100%";
      progressLabel.textContent = "100%";
      if (error === 0) {
        doneMsg.classList.remove("hidden");
      }
      if (!bugfixPromptShown && done > 0 && !uploadQueue.some(i => i.fixToken && !i.fixDone)) {
        bugfixPromptShown = true;
        checkBugfixAfterUpload();
      }
    }
  } else {
    progressWrap.classList.add("hidden");
  }
}

function statusLabel(s) {
  return { pending: "⏳ Vár", uploading: "⬆️ Tölt...", retrying: "🔁 Újrapróbálás...", network: "📶 Kapcsolatra vár", login: "🔑 Belépésre vár", done: "✅ Kész", error: "❌ Hiba", skipped: "⏭️ Kihagyva" }[s] || s;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/* ══════════════════════════════════════════════════════════
   FELTÖLTÉS
   ══════════════════════════════════════════════════════════ */
uploadBtn.addEventListener("click", startUpload);

function showNewFolderModal(missingFolders) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
      display:flex;align-items:center;justify-content:center;padding:16px;`;
    const listHtml = missingFolders.map(f => `<li style="color:#c4b5fd;font-weight:600">${f}</li>`).join("");
    overlay.innerHTML = `
      <div style="background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:16px;
                  padding:28px 24px;max-width:460px;width:100%;font-family:Poppins,sans-serif;color:#e8e8f5;">
        <div style="font-size:2rem;margin-bottom:12px">📁</div>
        <h3 style="margin-bottom:8px;font-size:1.1rem">Új mappa${missingFolders.length > 1 ? "k" : ""} létrehozása</h3>
        <p style="color:#9ca3af;font-size:.9rem;margin-bottom:12px;line-height:1.6">
          A következő mappa${missingFolders.length > 1 ? "k" : ""} még nem létezik a szerveren:
        </p>
        <ul style="margin:0 0 20px 20px;padding:0;font-size:.9rem;line-height:1.8">${listHtml}</ul>
        <p style="color:#9ca3af;font-size:.85rem;margin-bottom:20px">Létre akarod hozni?</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button id="nf-yes" style="background:#7c3aed;color:#fff;border:none;padding:11px 16px;
                  border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem">
            📁 Igen, létrehozom és feltöltöm
          </button>
          <button id="nf-cancel" style="background:none;color:#6b7280;border:none;
                  padding:8px;cursor:pointer;font-size:.85rem">
            Mégse
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#nf-yes").onclick    = () => { document.body.removeChild(overlay); resolve(true); };
    overlay.querySelector("#nf-cancel").onclick = () => { document.body.removeChild(overlay); resolve(false); };
  });
}

/* ── Már fent lévő mű más néven ─────────────────────────────
   blocked: a szerver /check-series válasza (mappánként). Visszaad:
   null = mégse; különben { [mappa]: "own" | "force" | "skip" }
   - own:   a feltöltő saját, más nevű mappájába kerül
   - force: „ez egy teljesen másik mű” — újként tölti fel
   - skip:  kimarad (más feltöltő sorozata) */
function showSeriesExistsModal(blocked) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
      display:flex;align-items:center;justify-content:center;padding:16px;`;
    const differentLabel = i => `<label style="display:flex;gap:8px;align-items:flex-start;margin-top:8px;cursor:pointer;color:#e8e8f5">
        <input type="checkbox" data-force="${i}" style="margin-top:4px">
        <span>Ez egy <b>teljesen másik mű</b>, csak hasonló a neve — feltöltöm újként</span>
      </label>`;
    const renameHint = `<div style="color:#fbbf24;margin-top:6px;font-size:.84rem">
        Ha ez egy másik mű: nevezd át a mappát (pl. írd mögé az eredeti címet vagy az évszámot),
        mert ezzel a névvel a meglévő műhöz kerülne.</div>`;
    const rows = blocked.map((b, i) => {
      let action;
      if (b.creditedFolder) {
        action = `<div style="color:#86efac;margin-top:6px">→ Fordítóként meg vagy jelölve, ezért a „<b>${escAttr(b.creditedFolder)}</b>” néven kerül fel, a meglévő műhöz.</div>`;
      } else if (b.series.own && b.series.ownFolder) {
        action = `<div style="color:#86efac;margin-top:6px">→ A saját „<b>${escAttr(b.series.ownFolder)}</b>” mappádba kerül.</div>`
          + (b.canOverride ? differentLabel(i) : "");
      } else {
        action = `<div style="color:#fca5a5;margin-top:6px">→ Ez a mappa kimarad a feltöltésből.</div>`
          + (b.canOverride ? differentLabel(i) : renameHint);
      }
      return `<li style="margin-bottom:14px;line-height:1.5">${escAttr(b.error)}${action}</li>`;
    }).join("");
    overlay.innerHTML = `
      <div style="background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:16px;
                  padding:28px 24px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto;
                  font-family:Poppins,sans-serif;color:#e8e8f5;">
        <div style="font-size:2rem;margin-bottom:12px">📚</div>
        <h3 style="margin-bottom:12px;font-size:1.1rem">Ez a mű már fent lehet az oldalon</h3>
        <ul style="margin:0 0 16px 18px;padding:0;font-size:.88rem;color:#d1d5db">${rows}</ul>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button id="se-ok" style="background:#7c3aed;color:#fff;border:none;padding:11px 16px;
                  border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem">Rendben, folytatom</button>
          <button id="se-cancel" style="background:none;color:#6b7280;border:none;
                  padding:8px;cursor:pointer;font-size:.85rem">Mégse (semmit nem töltök fel)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#se-ok").onclick = () => {
      const decisions = {};
      blocked.forEach((b, i) => {
        if (b.creditedFolder) decisions[b.folder] = "credited";
        else if (b.canOverride && overlay.querySelector(`[data-force="${i}"]`)?.checked) decisions[b.folder] = "force";
        else if (b.series.own && b.series.ownFolder) decisions[b.folder] = "own";
        else decisions[b.folder] = "skip";
      });
      document.body.removeChild(overlay);
      resolve(decisions);
    };
    overlay.querySelector("#se-cancel").onclick = () => { document.body.removeChild(overlay); resolve(null); };
  });
}

/* ══════════════════════════════════════════════════════════
   HIBAJEGYEK — feltöltés után rákérdezés, javítva lett-e
   ══════════════════════════════════════════════════════════ */
async function checkBugfixAfterUpload() {
  const items = uploadQueue
    .filter(i => i.status === "done")
    .map(i => {
      const full = currentPath ? `${currentPath}/${i.relativePath}` : i.relativePath;
      const parts = full.split("/");
      if (parts.length < 3) return null; // nincs manga/fejezet/kép szintű mélység
      return { mangaFolder: parts[0], chapterFolder: parts[1], imageFile: parts[parts.length - 1] };
    })
    .filter(Boolean);
  if (!items.length) return;

  let groups;
  try {
    const r = await fetch("/api/uploader/bugfix-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    groups = r.ok ? await r.json() : [];
  } catch { return; }
  if (!groups?.length) return;

  const typeLabel = { other: "Egyéb", english_remained: "Angol maradt", wrong_chapter: "Rossz fejezet/kép" };

  const rowsHtml = groups.map(g => {
    const reportRows = g.reports.map(r => `
      <label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer;color:#e8e8f5">
        <input type="checkbox" data-bugid="${r.id}" checked style="margin-top:4px">
        <span>
          ${r.image_index == null ? "<b>Egész rész</b>" : `<b>${escAttr(r.image_file || "")}</b> (${r.image_index}. kép)`}
          — ${escAttr(typeLabel[r.type] || r.type || "")}
          ${r.description ? `<br><span style="color:#9ca3af;font-size:.82rem">${escAttr(r.description)}</span>` : ""}
        </span>
      </label>`).join("");
    return `
      <li style="margin-bottom:16px;line-height:1.5">
        <div style="color:#a78bfa;font-weight:600">${escAttr(g.mangaTitle)} — ${escAttr(g.chapterFolder)}</div>
        ${reportRows}
      </li>`;
  }).join("");

  const overlay = document.createElement("div");
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
    display:flex;align-items:center;justify-content:center;padding:16px;`;
  overlay.innerHTML = `
    <div style="background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:16px;
                padding:28px 24px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;
                font-family:Poppins,sans-serif;color:#e8e8f5;">
      <div style="font-size:2rem;margin-bottom:12px">🐛</div>
      <h3 style="margin-bottom:8px;font-size:1.1rem">Nyitott hibajegy van ebben a feltöltésben</h3>
      <p style="color:#9ca3af;font-size:.88rem;margin-bottom:12px">
        Javítottad a lentieket ezzel a feltöltéssel? A bejelölteket lezárjuk javítottként.</p>
      <ul style="margin:0 0 16px 0;padding:0;list-style:none;font-size:.88rem">${rowsHtml}</ul>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button id="bf-close" style="background:#10b981;color:#fff;border:none;padding:11px 16px;
                border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem">✅ Igen, zárjuk be a bejelölteket</button>
        <button id="bf-skip" style="background:none;color:#6b7280;border:none;
                padding:8px;cursor:pointer;font-size:.85rem">Nem, hagyjuk nyitva</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#bf-skip").onclick = () => document.body.removeChild(overlay);
  overlay.querySelector("#bf-close").onclick = async () => {
    const ids = [...overlay.querySelectorAll("[data-bugid]:checked")].map(el => Number(el.dataset.bugid));
    document.body.removeChild(overlay);
    if (!ids.length) return;
    try {
      const r = await fetch("/api/uploader/bugfix-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await r.json();
      if (data.closed) alert(`✅ ${data.closed} hibajegy lezárva javítottként.`);
    } catch {
      alert("Hiba történt a hibajegyek lezárásakor.");
    }
  };
}

/* ══════════════════════════════════════════════════════════
   JAVÍTÁS MÁR FENT LÉVŐ RÉSZHEZ (2026-11-11)
   Ha a feltöltött rész (manga-mappa + rész-mappa) már fent van az
   oldalon, rákérdezünk, hogy javítás-e. Javításnál a képek átmeneti
   helyre mennek, és amikor a rész minden képe felért, a szerver lecseréli
   a fent lévő képeket — a más nevű régieket is törli, hogy ne keveredjenek.
   ══════════════════════════════════════════════════════════ */
function itemDestParts(i) {
  const full = currentPath ? `${currentPath}/${i.relativePath}` : i.relativePath;
  return full.split("/").filter(Boolean);
}

async function askFixChapters(pending) {
  const groups = new Map();
  for (const i of pending) {
    if (i.fixToken || i.fixDecided) continue; // előző körből (újrapróbálás)
    const p = itemDestParts(i);
    if (p.length !== 3) continue; // manga / rész / kép
    const key = `${p[0]}\n${p[1]}`;
    if (!groups.has(key)) groups.set(key, { mangaFolder: p[0], chapterFolder: p[1], items: [] });
    groups.get(key).items.push(i);
  }
  if (!groups.size) return true;

  let existing = [];
  try {
    const r = await fetch("/api/uploader/fix-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs: [...groups.values()].map(g => ({ mangaFolder: g.mangaFolder, chapterFolder: g.chapterFolder })) }),
    });
    if (r.ok) existing = (await r.json()).existing || [];
  } catch (err) {
    console.warn("Javítás-ellenőrzés hiba:", err);
  }
  if (!existing.length) return true;

  existing.forEach(e => { e.newCount = groups.get(`${e.mangaFolder}\n${e.chapterFolder}`).items.length; });
  const decisions = await showFixModal(existing);
  if (!decisions) return false;

  for (const e of existing) {
    const g = groups.get(`${e.mangaFolder}\n${e.chapterFolder}`);
    const d = decisions[`${e.mangaFolder}\n${e.chapterFolder}`];
    if (d === "full" || d === "pages") {
      let data = {};
      try {
        const r = await fetch("/api/uploader/fix-start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mangaFolder: e.mangaFolder, chapterFolder: e.chapterFolder, mode: d }),
        });
        data = await r.json().catch(() => ({}));
        if (!r.ok) data.token = null;
      } catch {}
      if (!data.token) {
        g.items.forEach(i => { i.status = "error"; i.blocked = true; i.errorMsg = data.error || "A javítás nem indítható"; });
        continue;
      }
      g.items.forEach(i => { i.fixToken = data.token; i.fixLabel = `${e.title} – ${e.chapterFolder}`; });
    } else if (d === "skip") {
      g.items.forEach(i => { i.status = "skipped"; i.blocked = true; i.errorMsg = "Már fent van, kihagyva"; });
    } else {
      g.items.forEach(i => { i.fixDecided = true; }); // saját rész, sima feltöltés
    }
  }
  return true;
}

function showFixModal(existing) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
      display:flex;align-items:center;justify-content:center;padding:16px;`;
    const opt = (i, value, checked, label, hint) => `
      <label style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;cursor:pointer;color:#e8e8f5">
        <input type="radio" name="fx${i}" value="${value}" ${checked ? "checked" : ""} style="margin-top:4px">
        <span>${label}${hint ? `<br><span style="color:#9ca3af;font-size:.8rem">${hint}</span>` : ""}</span>
      </label>`;
    const rows = existing.map((e, i) => {
      const head = `<b>${escAttr(e.title)}</b> – ${escAttr(e.chapterFolder)}
        <span style="color:#9ca3af">(fent: ${e.pages} kép${e.own ? "" : `, ${escAttr(e.library)} könyvtárában`}, most: ${e.newCount} kép)</span>`;
      if (!e.allowed) {
        return `<li style="margin-bottom:14px;line-height:1.5">${head}
          <div style="color:#fca5a5;margin-top:6px">→ ${escAttr(e.reason || "Nem javíthatod")} Kimarad.</div></li>`;
      }
      // Kevés kép a fent lévőhöz képest → valószínűleg csak néhány oldal javítása
      const fewPages = e.newCount < e.pages * 0.8;
      return `<li style="margin-bottom:16px;line-height:1.5">${head}
        ${opt(i, "full", !fewPages, "Javítás – <b>az egész rész cseréje</b>",
              "A fent lévő képek mind törlődnek (a más nevűek is), és csak az újak maradnak.")}
        ${opt(i, "pages", fewPages, "Javítás – <b>csak a feltöltött oldalak cseréje</b>",
              "Az azonos nevű és az azonos oldalszámú (pl. 5. oldal: p005.jpg ↔ page_5.png) régi kép cserélődik, a többi oldal marad.")}
        ${e.own
          ? opt(i, "normal", false, "Nem javítás – sima feltöltés", "A képek a mappába kerülnek, a régiek mellé (azonos névnél felülírja).")
          : opt(i, "skip", false, "Nem javítás – kihagyom", "")}
      </li>`;
    }).join("");
    overlay.innerHTML = `
      <div style="background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:16px;
                  padding:28px 24px;max-width:600px;width:100%;max-height:90vh;overflow-y:auto;
                  font-family:Poppins,sans-serif;color:#e8e8f5;">
        <div style="font-size:2rem;margin-bottom:12px">🛠️</div>
        <h3 style="margin-bottom:8px;font-size:1.1rem">Ezek a részek már fent vannak — javítást töltesz fel?</h3>
        <p style="color:#9ca3af;font-size:.84rem;margin:0 0 14px">A csere csak akkor történik meg, ha a rész minden képe hibátlanul felért. A régi képekről mentés készül.</p>
        <ul style="margin:0 0 16px 18px;padding:0;font-size:.88rem;color:#d1d5db">${rows}</ul>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button id="fx-ok" style="background:#7c3aed;color:#fff;border:none;padding:11px 16px;
                  border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem">Folytatás</button>
          <button id="fx-cancel" style="background:none;color:#6b7280;border:none;
                  padding:8px;cursor:pointer;font-size:.85rem">Mégse (semmit nem töltök fel)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#fx-ok").onclick = () => {
      const decisions = {};
      existing.forEach((e, i) => {
        const key = `${e.mangaFolder}\n${e.chapterFolder}`;
        decisions[key] = e.allowed ? (overlay.querySelector(`input[name="fx${i}"]:checked`)?.value || "skip") : "skip";
      });
      document.body.removeChild(overlay);
      resolve(decisions);
    };
    overlay.querySelector("#fx-cancel").onclick = () => { document.body.removeChild(overlay); resolve(null); };
  });
}

// A feltöltés végén: azoknál a javításoknál, ahol a rész minden képe felért, csere
async function commitFinishedFixes() {
  const byToken = new Map();
  for (const i of uploadQueue) {
    if (!i.fixToken || i.fixDone) continue;
    if (!byToken.has(i.fixToken)) byToken.set(i.fixToken, []);
    byToken.get(i.fixToken).push(i);
  }
  if (!byToken.size) return;

  uploadBtn.disabled = true;
  clearBtn.disabled  = true;
  const okLines = [], errLines = [];
  for (const [token, items] of byToken) {
    const label = items[0].fixLabel || "";
    const notDone = items.filter(i => i.status !== "done").length;
    if (notDone) {
      errLines.push(`${label}: ${notDone} kép nem ért fel, a csere NEM történt meg — indítsd újra a feltöltést (a hibás képek újra mennek).`);
      continue;
    }
    uploadBtn.textContent = `🛠️ Csere: ${label}...`;
    let result = null, error = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const r = await fetch("/api/uploader/fix-commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) { result = data; break; }
        if (r.status === 423) { await sleep(30000); continue; } // R2-áthelyezés fut, várunk
        error = data.error || `HTTP ${r.status}`;
        break;
      } catch (err) {
        error = "Hálózati hiba";
        await sleep(5000);
      }
    }
    if (result) {
      items.forEach(i => { i.fixDone = true; });
      okLines.push(`${label}: ${result.mode === "pages" ? `${result.pages} oldal cserélve` : "a rész lecserélve"} ` +
        `(${result.oldPages} → ${result.pagesAfter} kép${result.removed ? `, ${result.removed} régi törölve` : ""})`);
    } else {
      errLines.push(`${label}: a csere nem sikerült — ${error || "a szerver nem válaszolt"}. A fent lévő rész változatlan.`);
    }
  }
  resetUploadButtons();
  renderQueue();
  alert([
    okLines.length ? "✅ Javítás kész:\n" + okLines.join("\n") : "",
    errLines.length ? "❌ Javítás sikertelen:\n" + errLines.join("\n") : "",
  ].filter(Boolean).join("\n\n"));
  if (!bugfixPromptShown && okLines.length) {
    bugfixPromptShown = true;
    checkBugfixAfterUpload();
  }
}

function resetUploadButtons() {
  uploadBtn.disabled = false;
  clearBtn.disabled  = false;
  uploadBtn.textContent = "⬆️ Feltöltés indítása";
}

async function startUpload() {
  let pending = uploadQueue.filter(i => i.status === "pending" || (i.status === "error" && !i.blocked));
  if (!pending.length) return;

  bugfixPromptShown = false;

  // Az előző feltöltés scan-csíkja eltűnik (az új feltöltés végén új scan indul)
  clearTimeout(scanPollTimer);
  document.getElementById("scanStatusMsg")?.classList.add("hidden");

  uploadBtn.disabled = true;
  clearBtn.disabled  = true;
  uploadBtn.textContent = "⏳ Ellenőrzés...";

  // Új mappák ellenőrzése (ha sok fájl és van alkönyvtár a relatív útban)
  const topFolders = [...new Set(
    pending
      .filter(i => i.relativePath.includes("/"))
      .map(i => i.relativePath.split("/")[0])
  )];

  // A gyökérben új sorozat-mappa: fent van-e már a mű (akár más néven)?
  // Más feltöltő sorozatába nem lehet feltölteni; a szerver is ellenőrzi.
  if (!currentPath && topFolders.length > 0) {
    try {
      const r = await fetch("/api/uploader/check-series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folders: topFolders }),
      });
      const data = r.ok ? await r.json() : { blocked: [] };
      if (data.blocked?.length) {
        const decisions = await showSeriesExistsModal(data.blocked);
        if (!decisions) { resetUploadButtons(); return; }
        for (const b of data.blocked) {
          const items = pending.filter(i => i.relativePath.split("/")[0] === b.folder);
          const d = decisions[b.folder];
          if (d === "credited") {
            items.forEach(i => { i.relativePath = b.creditedFolder + i.relativePath.slice(b.folder.length); });
          } else if (d === "own") {
            items.forEach(i => { i.relativePath = b.series.ownFolder + i.relativePath.slice(b.folder.length); });
          } else if (d === "force") {
            items.forEach(i => { i.force = true; });
          } else {
            items.forEach(i => { i.status = "error"; i.blocked = true; i.errorMsg = b.error; });
          }
        }
        pending = pending.filter(i => !i.blocked);
        renderQueue();
        topFolders.splice(0, topFolders.length, ...new Set(
          pending.filter(i => i.relativePath.includes("/")).map(i => i.relativePath.split("/")[0])
        ));
        if (!pending.length) { resetUploadButtons(); return; }
      }
    } catch (err) {
      console.warn("Sorozat-ellenőrzés hiba:", err);
    }
  }

  // Már fent lévő rész: javítás-e? (2026-11-11)
  if (!(await askFixChapters(pending))) { resetUploadButtons(); return; }
  pending = pending.filter(i => !i.blocked);
  renderQueue();
  if (!pending.length) { resetUploadButtons(); return; }
  // A javítások átmeneti mappába mennek → nekik nem kell mappát létrehozni
  topFolders.splice(0, topFolders.length, ...new Set(
    pending.filter(i => !i.fixToken && i.relativePath.includes("/")).map(i => i.relativePath.split("/")[0])
  ));

  if (topFolders.length > 0) {
    try {
      const folderDestPaths = topFolders.map(f => currentPath ? `${currentPath}/${f}` : f);
      const r = await fetch("/api/uploader/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: folderDestPaths }),
      });
      const data = await r.json();
      const existingSet = new Set(data.existing || []);
      const missing = topFolders.filter((_, i) => !existingSet.has(folderDestPaths[i]));

      if (missing.length > 0) {
        const confirmed = await showNewFolderModal(missing);
        if (!confirmed) {
          uploadBtn.disabled = false;
          clearBtn.disabled  = false;
          uploadBtn.textContent = "⬆️ Feltöltés indítása";
          return;
        }
        // Mappák létrehozása
        for (const folderName of missing) {
          const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;
          const force = pending.some(i => i.force && i.relativePath.split("/")[0] === folderName);
          await fetch("/api/uploader/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: folderPath, force }),
          });
        }
      }
    } catch (err) {
      console.warn("Mappa ellenőrzés hiba:", err);
    }
  }

  // Meglévő fájlok ellenőrzése
  const destPaths = pending.filter(item => !item.fixToken).map(item =>
    currentPath ? `${currentPath}/${item.relativePath}` : item.relativePath
  );

  let skipExisting = false;
  try {
    const r = await fetch("/api/uploader/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: destPaths }),
    });
    const data = await r.json();

    if (data.existing?.length) {
      // Meglévő fájlok megjelölése a queue-ban
      data.existing.forEach(existPath => {
        const rel = currentPath ? existPath.slice(currentPath.length + 1) : existPath;
        const item = pending.find(i => i.relativePath === rel && !i.fixToken);
        if (item) item.exists = true;
      });
      renderQueue();

      // Figyelmeztetés modal
      const answer = await showOverwriteModal(data.existing.length, pending.length);
      if (answer === "cancel") {
        uploadBtn.disabled = false;
        clearBtn.disabled  = false;
        uploadBtn.textContent = "⬆️ Feltöltés indítása";
        return;
      }
      skipExisting = (answer === "skip");
    }
  } catch (err) {
    console.warn("Check hiba:", err);
  }

  uploadBtn.textContent = "⬆️ Feltöltés...";

  const toUpload = skipExisting
    ? pending.filter(i => !i.exists)
    : pending;

  // Kihagyott fájlok megjelölése
  if (skipExisting) {
    pending.filter(i => i.exists).forEach(i => { i.status = "skipped"; });
    renderQueue();
  }

  // Folyamatos sor: amint egy fájl kész, jön a következő (korábban 4-es
  // kötegekben ment, és egy lassú fájl a másik hármat is visszatartotta).
  let nextIndex = 0;
  const roundStartedAt = Date.now();
  toUpload.forEach(i => { i.attempts = []; });
  uploadStopped = false;
  concurrencyLimit = CONCURRENT;
  okStreak = 0;
  uploadInProgress = true;
  // Ingadozó netnél (2026-11-07) a párhuzamos szálak száma alkalmazkodik:
  // elakadás után csökken, sok sikeres fájl után visszanő. A „felesleges”
  // szálak addig várnak, amíg újra sorra kerülnek.
  const worker = async id => {
    while (nextIndex < toUpload.length && !uploadStopped) {
      if (id >= concurrencyLimit) { await sleep(1000); continue; }
      await uploadItem(toUpload[nextIndex++]);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENT, toUpload.length) }, (_, id) => worker(id)));
  } finally {
    uploadInProgress = false;
    hideNetBanner();
  }

  uploadBtn.disabled = false;
  clearBtn.disabled  = false;
  uploadBtn.textContent = "⬆️ Feltöltés indítása";
  loadFiles();

  reportUploadErrors(toUpload, roundStartedAt);

  await commitFinishedFixes();

  // Ha a sorban minden hibátlanul felment (és volt is mit feltölteni),
  // automatikusan indul egy scan, hogy az új fejezetek megjelenjenek.
  // (a már fent lévő mű miatt kihagyott mappák nem akadályozzák a scant)
  const anyError = uploadQueue.some(i => i.status === "error" && !i.blocked);
  const anyUploaded = toUpload.some(i => i.status === "done");
  if (!anyError && anyUploaded) startScanAfterUpload();
}

/* ══════════════════════════════════════════════════════════
   SCAN A FELTÖLTÉS UTÁN
   A szerver sorba rendezi a kéréseket (egyszerre egy scan fut, egy
   várhat utána). A kérésünkre akkor tekintjük késznek, ha a kérés
   UTÁN indult scan befejeződött — a requestedAt szerveridő, így a
   kliens órájától független.
   ══════════════════════════════════════════════════════════ */
let scanPollTimer = null;

// kind: running | ok | error; percent: 0–100, vagy null = még nem tudjuk
// (pl. sorban áll) → mozgó, csíkos animáció
const SCAN_PHASE_TEXT = {
  start: "Scan indul...",
  scan: "Mappák átnézése",
  unlock: "Feloldási idők beállítása",
  metadata: "Adatlapok frissítése",
  cache: "Gyorsítótár frissítése",
  discord: "Értesítés küldése",
  done: "Befejezés",
};
function showScanStatus(kind, text, percent = null) {
  const box = document.getElementById("scanStatusMsg");
  if (!box) return;
  box.className = `scan-status-msg ${kind}`;
  document.getElementById("scanStatusText").textContent = text;
  const fill = document.getElementById("scanProgressFill");
  const label = document.getElementById("scanProgressLabel");
  const indeterminate = kind === "running" && percent === null;
  fill.classList.toggle("indeterminate", indeterminate);
  fill.style.width = indeterminate ? "100%" : `${kind === "ok" ? 100 : Math.max(0, Math.min(100, percent ?? 0))}%`;
  label.textContent = indeterminate ? "" : `${kind === "ok" ? 100 : Math.round(percent ?? 0)}%`;
  queueSection.classList.remove("hidden");
}

async function startScanAfterUpload() {
  clearTimeout(scanPollTimer);

  let requestedAt;
  try {
    const r = await fetch("/api/uploader/scan", { method: "POST" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    requestedAt = new Date(data.requestedAt);
    showScanStatus("running", data.state === "queued"
      ? "⏳ Scan sorban áll — egy korábbi scan még fut, utána rögtön a tiéd következik..."
      : "🔄 A scan elindult — az új fejezetek feldolgozása folyamatban...", data.state === "queued" ? null : 0);
  } catch (err) {
    console.warn("Scan indítási hiba:", err);
    showScanStatus("error", "❌ Nem sikerült elindítani a scant. Szólj egy adminnak.");
    return;
  }

  const deadline = Date.now() + 20 * 60 * 1000;

  const poll = async () => {
    try {
      const r = await fetch("/api/uploader/scan-status", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const s = await r.json();

      const startedAt  = s.lastStartedAt  ? new Date(s.lastStartedAt)  : null;
      const finishedAt = s.lastFinishedAt ? new Date(s.lastFinishedAt) : null;
      const ourScanStarted = startedAt && startedAt >= requestedAt;

      if (ourScanStarted && finishedAt && finishedAt >= startedAt && !s.running && !s.queued) {
        if (s.lastExitCode === 0) {
          showScanStatus("ok", "✅ A scan befejeződött — az új fejezetek már megjelentek az oldalon.", 100);
        } else {
          showScanStatus("error", `⚠️ A scan hibával állt le (kód: ${s.lastExitCode}). Szólj egy adminnak.`, s.progress?.percent ?? 0);
        }
        return;
      }
      if (ourScanStarted) {
        // Csak a mi (a kérésünk után indult) scanünk előrehaladását mutatjuk
        const p = s.progress && s.progress.startedAt >= requestedAt.getTime() - 5000 ? s.progress : null;
        const phase = p ? (SCAN_PHASE_TEXT[p.phase] || p.phase) : "Scan fut";
        const detail = p && p.phase === "scan" && p.total ? ` (${p.done}/${p.total} mappa)` : "";
        showScanStatus("running", `🔄 ${phase}${detail}...`, p ? p.percent : null);
      } else if (s.queued || s.running) {
        showScanStatus("running", "⏳ Scan sorban áll — egy korábbi scan még fut, utána rögtön a tiéd következik...", null);
      }
    } catch (err) {
      console.warn("Scan állapot lekérdezési hiba:", err);
    }

    if (Date.now() > deadline) {
      showScanStatus("error", "⚠️ Nem jött visszajelzés a scan befejezéséről. Nézd meg az oldalon, megjelentek-e a fejezetek.");
      return;
    }
    scanPollTimer = setTimeout(poll, 1500);
  };

  scanPollTimer = setTimeout(poll, 1000);
}

function showOverwriteModal(existCount, totalCount) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
      display:flex;align-items:center;justify-content:center;padding:16px;
    `;

    overlay.innerHTML = `
      <div style="background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:16px;
                  padding:28px 24px;max-width:440px;width:100%;font-family:Poppins,sans-serif;color:#e8e8f5;">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <h3 style="margin-bottom:8px;font-size:1.1rem">Felülírási figyelmeztetés</h3>
        <p style="color:#9ca3af;font-size:.9rem;margin-bottom:20px;line-height:1.6">
          <strong style="color:#fbbf24">${existCount} fájl</strong> már létezik a szerveren
          (összesen ${totalCount} fájlból).<br>
          Mit szeretnél tenni?
        </p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button id="ow-overwrite" style="background:#7c3aed;color:#fff;border:none;padding:11px 16px;
                  border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem">
            ✏️ Felülírás – mind feltöltöm
          </button>
          <button id="ow-skip" style="background:rgba(255,255,255,.07);color:#ccc;border:1px solid rgba(255,255,255,.1);
                  padding:11px 16px;border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem">
            ⏭️ Kihagyás – csak az újakat töltöm fel
          </button>
          <button id="ow-cancel" style="background:none;color:#6b7280;border:none;
                  padding:8px;cursor:pointer;font-size:.85rem">
            Mégse
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#ow-overwrite").onclick = () => { document.body.removeChild(overlay); resolve("overwrite"); };
    overlay.querySelector("#ow-skip").onclick      = () => { document.body.removeChild(overlay); resolve("skip"); };
    overlay.querySelector("#ow-cancel").onclick    = () => { document.body.removeChild(overlay); resolve("cancel"); };
  });
}

// Egy feltöltési próbálkozás — a hívó (uploadItem) dönt az újrapróbálásról.
function uploadAttempt(item) {
  const destPath = currentPath
    ? `${currentPath}/${item.relativePath}`
    : item.relativePath;

  const fd = new FormData();
  fd.append("file", item.file);
  fd.append("path", destPath);
  if (item.force) fd.append("force", "1");
  if (item.fixToken) fd.append("fixToken", item.fixToken);

  // Időkorlát nélkül egy beragadt kapcsolat (se válasz, se hiba) örökre
  // várakoztatta a feltöltést: 2026-10-15 Stukker 391/529-nél állt meg
  // hibaüzenet nélkül. Ha STALL_MS-ig nem mozdul semmi, megszakítjuk, és
  // az uploadItem újrapróbálja.
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let lastActivity = Date.now();
    const startedAt = Date.now();
    let sent = 0, total = item.file.size, bodySent = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      // Diagnosztika a hibajelentéshez: a teljes fájl kiment-e már, amikor elakadt
      resolve({ ...result, sent, total, bodySent, ms: Date.now() - startedAt });
    };
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) {
        finish({ ok: false, status: 0, responseText: "stalled" });
        xhr.abort();
      }
    }, 5000);

    xhr.open("POST", "/api/uploader/upload");
    xhr.timeout = MAX_REQUEST_MS;
    // A szerver így akkor is tudja, melyik fájl volt, ha a törzs nem érkezik meg
    xhr.setRequestHeader("X-Upload-Path", encodeURIComponent(destPath));

    xhr.upload.onprogress = e => {
      lastActivity = Date.now();
      sent = e.loaded;
      if (e.lengthComputable) total = e.total;
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 100);
        renderQueue();
      }
    };
    xhr.upload.onload = () => { bodySent = true; sent = total; lastActivity = Date.now(); };
    xhr.onreadystatechange = () => { lastActivity = Date.now(); };

    xhr.onload = () => {
      finish({ ok: xhr.status === 200 || xhr.status === 201, status: xhr.status, responseText: xhr.responseText });
    };
    xhr.onerror   = () => finish({ ok: false, status: 0, responseText: "network error" });
    xhr.ontimeout = () => finish({ ok: false, status: 0, responseText: "timeout" });
    xhr.onabort   = () => finish({ ok: false, status: 0, responseText: "aborted" });

    xhr.send(fd);
  });
}

// Feltöltés max. 3 próbálkozással, automatikusan — korábban a userre
// hárult, hogy manuálisan próbálja újra a hibás elemeket (átlagosan
// 3x kellett kattintania). 4xx (kliens-oldali, pl. jogosultság/rossz
// mappanév) hibáknál nincs értelme újrapróbálni, azok azonnal buknak.
// A szerver hibaüzenete (pl. "fejezet-mappának tűnik…") — korábban csak a
// konzolba került, a felhasználó csak annyit látott: "❌ Hiba".
function uploadErrorMessage(result) {
  if (result.status === 0 && (result.responseText === "stalled" || result.responseText === "timeout"))
    return "Elakadt a kapcsolat (nem jött válasz a szervertől).";
  if (result.status === 0) return "Nem sikerült elérni a szervert (hálózati hiba).";
  if (result.status === 401) return "Lejárt a bejelentkezés — jelentkezz be újra.";
  if (result.status === 403) return "Nincs feltöltési jogosultságod.";
  if (result.status === 413) return "A fájl túl nagy.";
  try {
    const j = JSON.parse(result.responseText);
    if (j && j.error) return String(j.error);
  } catch {}
  return `Szerverhiba (HTTP ${result.status}).`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Ingadozó / lassú net (2026-11-07) ─────────────────────────
   Korábban egy rövid net-kiesésnél mind a 4 szál pár másodperc alatt
   elhasználta a 3 próbálkozását (offline a kérés azonnal bukik), és a sor
   hátralévő része „❌ Hiba” lett. Most hálózati hibánál először
   megnézzük, eléri-e a böngésző a szervert: ha nem, a teljes sor
   szünetel, amíg vissza nem jön a net — ez nem számít próbálkozásnak. */
let concurrencyLimit = CONCURRENT;
let okStreak = 0;
let uploadInProgress = false;
let connWaitPromise = null;

function isNetworkFailure(result) {
  // 0 = nem jött válasz; 502/503/504 és a Cloudflare 52x = a szerver/proxy épp nem elérhető
  return result.status === 0 || [502, 503, 504, 520, 521, 522, 523, 524].includes(result.status);
}

function slowDown() {
  okStreak = 0;
  if (concurrencyLimit > 1) concurrencyLimit--;
}

function noteSuccess() {
  if (++okStreak >= 8 && concurrencyLimit < CONCURRENT) { concurrencyLimit++; okStreak = 0; }
}

async function serverReachable() {
  if (navigator.onLine === false) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch("/api/uploader/speedtest/ping", { cache: "no-store", signal: ctrl.signal });
    return r.ok || r.status === 401; // 401: elérhető, csak a belépés járt le — azt a feltöltés kezeli
  } catch { return false; } finally { clearTimeout(t); }
}

// Közös várakozás: az összes szál ugyanarra az egy ellenőrző ciklusra vár.
function waitForConnection() {
  if (!connWaitPromise) {
    connWaitPromise = (async () => {
      showNetBanner();
      let delay = 3000;
      while (!uploadStopped) {
        await new Promise(r => {
          const done = () => { clearTimeout(t); window.removeEventListener("online", done); r(); };
          const t = setTimeout(done, delay);
          window.addEventListener("online", done);
        });
        if (await serverReachable()) break;
        delay = Math.min(delay * 1.5, 20000);
      }
      hideNetBanner();
    })().finally(() => { connWaitPromise = null; });
  }
  return connWaitPromise;
}

function showNetBanner() {
  let el = document.getElementById("netWaitBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "netWaitBanner";
    el.className = "net-wait-banner";
    el.innerHTML = `📶 <strong>Megszakadt a kapcsolat a szerverrel.</strong>
      A feltöltés szünetel, és magától folytatódik, amint visszajön a net — ne zárd be a lapot.
      <button type="button" id="netWaitStop">Leállítás</button>`;
    document.body.appendChild(el);
    el.querySelector("#netWaitStop").onclick = () => { uploadStopped = true; hideNetBanner(); };
  }
  el.classList.remove("hidden");
}

function hideNetBanner() {
  document.getElementById("netWaitBanner")?.classList.add("hidden");
}

// Feltöltés közben a lap bezárása/frissítése elveszítené a sort
window.addEventListener("beforeunload", e => {
  if (uploadInProgress) { e.preventDefault(); e.returnValue = ""; }
});

async function uploadItem(item) {
  const MAX_ATTEMPTS = 5;      // valódi (nem net-kiesés miatti) hibák száma
  const MAX_NET_WAITS = 30;    // ennyiszer várhat egy fájl a net visszatérésére
  let netWaits = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    item.status = attempt === 1 ? "uploading" : "retrying";
    item.progress = 0;
    renderQueue();

    const result = await uploadAttempt(item);
    if (!result.ok) {
      (item.attempts ||= []).push({
        status: result.status, error: result.status ? null : result.responseText,
        sent: result.sent, total: result.total, bodySent: result.bodySent, ms: result.ms,
      });
    }
    if (result.ok) {
      noteSuccess();
      item.status = "done";
      item.progress = 100;
      item.errorMsg = null;
      renderQueue();
      return;
    }
    item.errorMsg = uploadErrorMessage(result);

    // Lejárt a bejelentkezés (2026-11-06: SKYPRO 30 napos sessionje feltöltés
    // közben járt le, 99 kép bukott el): a sor szünetel, újra-belépés után
    // ugyanez a fájl újra megy — ez nem számít bele a próbálkozásokba.
    if (result.status === 401) {
      if (uploadStopped) break;
      item.status = "login";
      renderQueue();
      if (await waitForRelogin()) { attempt--; continue; }
      break;
    }

    if (uploadStopped) break;

    if (isNetworkFailure(result)) {
      slowDown();
      // Nem éri el a szervert → a sor szünetel, a próbálkozás nem vész el
      if (netWaits < MAX_NET_WAITS && !(await serverReachable())) {
        netWaits++;
        item.status = "network";
        renderQueue();
        await waitForConnection();
        if (uploadStopped) break;
        attempt--;
        continue;
      }
    } else if (result.status >= 400 && result.status < 500) {
      console.warn("Upload hiba (nem javul újrapróbálásra):", result.responseText);
      break;
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(Math.min(2000 * 2 ** (attempt - 1), 20000)); // 2, 4, 8, 16 mp
    } else {
      console.warn(`Upload hiba (${MAX_ATTEMPTS} próbálkozás után):`, result.responseText);
    }
  }

  // Leállításkor a félbemaradt fájl visszakerül a várakozók közé (a következő „Feltöltés indítása” viszi)
  item.status = uploadStopped && item.status !== "error" ? "pending" : "error";
  renderQueue();
}

// Újra-belépés megvárása: egyszerre csak egy ablak, a párhuzamos feltöltések
// mind erre várnak. true = újra be van jelentkezve, mehet tovább.
let reloginPromise = null;
let uploadStopped = false; // a user a belépés-ablakban leállította a kört
function waitForRelogin() {
  if (!reloginPromise) {
    reloginPromise = showReloginModal().finally(() => { reloginPromise = null; });
  }
  return reloginPromise;
}

async function isUploadSessionOk() {
  try {
    const r = await fetch("/api/uploader/speedtest/ping", { cache: "no-store" });
    return r.ok;
  } catch { return false; }
}

function showReloginModal() {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
      display:flex;align-items:center;justify-content:center;padding:16px;`;
    overlay.innerHTML = `
      <div style="background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:16px;
                  padding:28px 24px;max-width:460px;width:100%;font-family:Poppins,sans-serif;color:#e8e8f5;">
        <div style="font-size:2rem;margin-bottom:12px">🔑</div>
        <h3 style="margin-bottom:8px;font-size:1.1rem">Lejárt a bejelentkezésed</h3>
        <p style="color:#9ca3af;font-size:.9rem;margin-bottom:16px;line-height:1.6">
          A feltöltés <strong style="color:#fbbf24">szünetel</strong>, semmi nem veszett el.
          Jelentkezz be újra egy új lapon, majd gyere vissza ide, és kattints a
          <strong>Folytatás</strong> gombra — a feltöltés onnan megy tovább, ahol megállt.
          <br><span style="font-size:.8rem">Ezt a lapot ne zárd be és ne frissítsd, különben a sor elveszik.</span>
        </p>
        <div id="rl-msg" style="color:#f87171;font-size:.85rem;margin-bottom:10px;display:none"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <a href="/login.html" target="_blank" rel="noopener" style="text-align:center;background:rgba(255,255,255,.07);color:#ccc;
             border:1px solid rgba(255,255,255,.1);padding:11px 16px;border-radius:10px;font-weight:600;text-decoration:none;font-size:.9rem">
            🔑 Bejelentkezés új lapon
          </a>
          <button id="rl-continue" style="background:#7c3aed;color:#fff;border:none;padding:11px 16px;
                  border-radius:10px;font-weight:600;cursor:pointer;font-size:.9rem">
            ▶️ Folytatás
          </button>
          <button id="rl-cancel" style="background:none;color:#6b7280;border:none;padding:8px;cursor:pointer;font-size:.85rem">
            Feltöltés leállítása
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const msg = overlay.querySelector("#rl-msg");
    const btn = overlay.querySelector("#rl-continue");
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "⏳ Ellenőrzés...";
      if (await isUploadSessionOk()) {
        document.body.removeChild(overlay);
        resolve(true);
        return;
      }
      msg.textContent = "Még nem vagy bejelentkezve (vagy nincs feltöltési jogod). Jelentkezz be az új lapon, aztán próbáld újra.";
      msg.style.display = "block";
      btn.disabled = false;
      btn.textContent = "▶️ Folytatás";
    };
    overlay.querySelector("#rl-cancel").onclick = () => {
      uploadStopped = true; // a még el nem indult fájlok „Vár” állapotban maradnak
      document.body.removeChild(overlay);
      resolve(false);
    };
  });
}

// A feltöltési kör hibás fájljainak elküldése a szervernek (naplózás,
// 2026-11-06: a „❌ Hiba” okát eddig csak a feltöltő böngészője látta).
function reportUploadErrors(items, roundStartedAt) {
  const failed = items.filter(i => i.status === "error" && !i.blocked);
  if (!failed.length) return;
  const conn = navigator.connection;
  const body = {
    queued: items.length,
    done: items.filter(i => i.status === "done").length,
    failed: failed.length,
    concurrent: CONCURRENT,
    elapsedMs: Date.now() - roundStartedAt,
    online: navigator.onLine,
    connection: conn ? { effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt } : null,
    items: failed.slice(0, 300).map(i => ({
      path: currentPath ? `${currentPath}/${i.relativePath}` : i.relativePath,
      size: i.file?.size ?? null,
      attempts: i.attempts || [],
    })),
  };
  fetch("/api/uploader/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

clearBtn.addEventListener("click", () => {
  uploadQueue = uploadQueue.filter(i => i.status !== "done");
  renderQueue();
});

/* ══════════════════════════════════════════════════════════
   KAPCSOLAT TESZT
   Kör-idő (ping) + feltöltési sávszélesség mérése, hogy a feltöltő
   lássa, a lassúság a saját netje/a szerver felé vezető útvonal miatt
   van-e, mielőtt nagy köteget indítana el.
   ══════════════════════════════════════════════════════════ */
speedtestBtn?.addEventListener("click", runSpeedTest);

async function runSpeedTest() {
  speedtestBtn.disabled = true;
  speedtestResult.className = "speedtest-result";
  speedtestResult.textContent = "⏳ Mérés...";

  try {
    // Kör-idő: 4 ping, az első (kapcsolat-felépülés miatt torzít) kihagyva
    const pings = [];
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      const r = await fetch("/api/uploader/speedtest/ping", { cache: "no-store" });
      if (!r.ok) throw new Error("Ping sikertelen (HTTP " + r.status + ")");
      pings.push(performance.now() - t0);
    }
    const latency = Math.round(pings.slice(1).reduce((a, b) => a + b, 0) / (pings.length - 1));

    // Feltöltési sebesség: 5MB véletlen (tömöríthetetlen) adat
    const SIZE = 5 * 1024 * 1024;
    const data = new Uint8Array(SIZE);
    for (let off = 0; off < SIZE; off += 65536) {
      crypto.getRandomValues(data.subarray(off, Math.min(off + 65536, SIZE)));
    }
    const blob = new Blob([data]);

    const speedMbps = await new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("blob", blob, "speedtest.bin");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploader/speedtest/upload");
      xhr.timeout = 25000;
      const start = performance.now();
      let lastLoaded = 0;

      xhr.upload.onprogress = e => { if (e.lengthComputable) lastLoaded = e.loaded; };
      xhr.onload = () => {
        const seconds = (performance.now() - start) / 1000;
        if (xhr.status === 200) resolve((SIZE * 8) / seconds / 1_000_000);
        else reject(new Error("HTTP " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("Hálózati hiba"));
      xhr.ontimeout = () => {
        const seconds = (performance.now() - start) / 1000;
        if (lastLoaded > 0) resolve((lastLoaded * 8) / seconds / 1_000_000);
        else reject(new Error("Időtúllépés — nagyon lassú kapcsolat"));
      };
      xhr.send(fd);
    });

    let verdict = "✅ Jó";
    let cls = "ok";
    if (speedMbps < 1) { verdict = "🔴 Nagyon lassú — nagy képeknél könnyen elakadhat/timeoutolhat"; cls = "bad"; }
    else if (speedMbps < 3) { verdict = "🟡 Lassú — nagyobb képeknél számíts újrapróbálkozásra"; cls = "warn"; }

    speedtestResult.className = "speedtest-result " + cls;
    speedtestResult.innerHTML = `Feltöltés: <strong>${(Math.round(speedMbps * 10) / 10)} Mbps</strong> · Késleltetés: <strong>${latency} ms</strong> — ${verdict}`;
  } catch (err) {
    speedtestResult.className = "speedtest-result bad";
    speedtestResult.textContent = "❌ Nem sikerült megmérni: " + err.message;
  } finally {
    speedtestBtn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════
   FÁJLBÖNGÉSZŐ
   ══════════════════════════════════════════════════════════ */
async function loadFiles(path = currentPath) {
  currentPath = path;
  renderBreadcrumb();

  browserList.innerHTML = `<div class="empty-dir">Betöltés...</div>`;

  try {
    const r = await fetch(`/api/uploader/files?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    renderFiles(data.items);
  } catch (err) {
    browserList.innerHTML = `<div class="empty-dir">Hiba: ${err.message}</div>`;
  }
}

function renderFiles(items) {
  currentItems = items;

  const q = browserFilter.toLowerCase().trim();
  const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;

  if (!filtered.length) {
    browserList.innerHTML = q
      ? `<div class="empty-dir">Nincs találat: „${q}"</div>`
      : `<div class="empty-dir">📂 Üres mappa</div>`;
    return;
  }

  browserList.innerHTML = filtered.map(item => {
    const isDir = item.type === "dir";
    const icon  = isDir ? "📁" : getFileIcon(item.name);
    const size  = item.size != null ? formatSize(item.size) : "";
    const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;

    return `
      <div class="file-item">
        <span class="file-item-icon">${icon}</span>
        <span class="file-item-name ${isDir ? "is-dir" : "is-file"}"
              ${isDir ? act("navigateTo", itemPath) : ""}
              title="${escAttr(item.name)}">
          ${escAttr(item.name)}
        </span>
        ${size ? `<span class="file-item-size">${size}</span>` : ""}
        <button class="file-item-del" title="Törlés"
                ${act("deleteItem", itemPath, isDir)}>
          🗑️
        </button>
      </div>
    `;
  }).join("");
}

function getFileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (["jpg","jpeg","png","webp","gif","avif"].includes(ext)) return "🖼️";
  if (["zip","rar","7z","tar","gz"].includes(ext)) return "🗜️";
  if (["pdf"].includes(ext)) return "📄";
  return "📄";
}

function navigateTo(path) {
  browserFilter = "";
  if (browserSearch) browserSearch.value = "";
  loadFiles(path);
}

function renderBreadcrumb() {
  const parts = currentPath ? currentPath.split("/") : [];
  let html = `<span class="breadcrumb-part" ${act("navigateTo", "")}>🏠 Gyökér</span>`;
  let built = "";
  parts.forEach((p, i) => {
    built = built ? `${built}/${p}` : p;
    const isLast = i === parts.length - 1;
    html += `<span class="breadcrumb-sep">/</span>`;
    if (isLast) {
      html += `<span class="breadcrumb-current">${escAttr(p)}</span>`;
    } else {
      const snap = built;
      html += `<span class="breadcrumb-part" ${act("navigateTo", snap)}>${escAttr(p)}</span>`;
    }
  });
  breadcrumb.innerHTML = html;
}

/* ── Magyar confirm modal ── */
function showConfirmModal(message, detail) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
      <div style="background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:24px;max-width:400px;width:100%;font-family:Poppins,sans-serif;color:#e8e8f5;">
        <div style="font-size:1.8rem;margin-bottom:10px">🗑️</div>
        <h3 style="margin-bottom:8px;font-size:1rem">${message}</h3>
        ${detail ? `<p style="color:#9ca3af;font-size:.82rem;margin-bottom:20px;word-break:break-all">${detail}</p>` : ""}
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="cm-cancel" style="background:rgba(255,255,255,.07);color:#ccc;border:1px solid rgba(255,255,255,.1);padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem">Mégse</button>
          <button id="cm-ok" style="background:#dc2626;color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem">Törlés</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#cm-ok").onclick     = () => { document.body.removeChild(overlay); resolve(true); };
    overlay.querySelector("#cm-cancel").onclick  = () => { document.body.removeChild(overlay); resolve(false); };
  });
}

/* ── Törlés ── */
async function deleteItem(itemPath, isDir) {
  const label = isDir ? "Biztosan törlöd ezt a mappát és teljes tartalmát?" : "Biztosan törlöd ezt a fájlt?";
  const confirmed = await showConfirmModal(label, itemPath);
  if (!confirmed) return;

  const r = await fetch("/api/uploader/file", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: itemPath }),
  });

  if (r.ok) {
    loadFiles(currentPath);
  } else {
    const err = await r.json();
    alert("Törlési hiba: " + (err.error || "ismeretlen"));
  }
}

// A fájllista data-on-click elemei által hívható függvények (actions.js)
window.PadliActions.register({ navigateTo, deleteItem });

/* ── Böngésző kereső ── */
if (browserSearch) {
  browserSearch.addEventListener("input", () => {
    browserFilter = browserSearch.value;
    renderFiles(currentItems);
  });
}

/* ── Indulás ── */
loadFiles("");
renderQueue();

/* ══════════════════════════════════════════════════════════
   MANGÁIM ADATLAPJA — cím/leírás/borító/műfaj/címke szerkesztés
   a saját (uploaders listában szereplő) mangákra
   ══════════════════════════════════════════════════════════ */
(async function initMyManga() {
  const section = document.getElementById("myMangaSection");
  const select  = document.getElementById("myMangaSelect");
  const form    = document.getElementById("myMangaForm");
  if (!section || !select || !form) return;

  let mangas = [];
  try {
    const r = await fetch("/api/uploader/my-manga");
    if (!r.ok) return; // nincs feltöltői jogosultság, a szekció marad rejtve
    mangas = await r.json();
  } catch { return; }

  if (!mangas.length) return;
  section.style.display = "";

  for (const m of mangas) {
    const opt = document.createElement("option");
    opt.value = m.slug;
    opt.textContent = m.title;
    select.appendChild(opt);
  }

  const titleEl    = document.getElementById("mmTitle");
  const descEl     = document.getElementById("mmDescription");
  const coverUrlEl = document.getElementById("mmCoverUrl");
  const coverFileEl = document.getElementById("mmCoverFile");
  const coverPreview = document.getElementById("mmCoverPreview");
  const genresEl   = document.getElementById("mmGenres");
  const tagsEl     = document.getElementById("mmTags");
  const saveBtn    = document.getElementById("mmSaveBtn");
  const saveStatus = document.getElementById("mmSaveStatus");

  select.addEventListener("change", async () => {
    saveStatus.textContent = "";
    if (!select.value) { form.style.display = "none"; return; }
    const r = await fetch(`/api/uploader/manga/${encodeURIComponent(select.value)}`);
    if (!r.ok) { alert("Nem sikerült betölteni az adatlapot."); return; }
    const data = await r.json();
    titleEl.value = data.title || "";
    descEl.value = data.description || "";
    coverUrlEl.value = data.cover_url || "";
    coverPreview.src = data.cover_url || "";
    coverPreview.style.display = data.cover_url ? "" : "none";
    genresEl.value = (data.genres || []).join(", ");
    tagsEl.value = (data.tags || []).join(", ");
    coverFileEl.value = "";
    form.style.display = "";
  });

  coverUrlEl.addEventListener("input", () => {
    coverPreview.src = coverUrlEl.value;
    coverPreview.style.display = coverUrlEl.value ? "" : "none";
  });
  coverFileEl.addEventListener("change", () => {
    const file = coverFileEl.files[0];
    if (!file) return;
    coverUrlEl.value = "";
    coverPreview.src = URL.createObjectURL(file);
    coverPreview.style.display = "";
  });

  saveBtn.addEventListener("click", async () => {
    const slug = select.value;
    if (!slug) return;
    saveStatus.style.color = "#22c55e";
    saveStatus.textContent = "Mentés...";

    try {
      if (coverFileEl.files[0]) {
        const fd = new FormData();
        fd.append("cover", coverFileEl.files[0]);
        const rCover = await fetch(`/api/uploader/manga/${encodeURIComponent(slug)}/cover`, { method: "POST", body: fd });
        if (!rCover.ok) throw new Error((await rCover.json()).error || "Borító-feltöltés sikertelen");
      }

      const genres = genresEl.value.split(",").map(s => s.trim()).filter(Boolean);
      const tags = tagsEl.value.split(",").map(s => s.trim()).filter(Boolean);
      const r = await fetch(`/api/uploader/manga/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleEl.value.trim(),
          description: descEl.value.trim(),
          cover_url: coverFileEl.files[0] ? null : (coverUrlEl.value.trim() || null),
          genres, tags,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Mentés sikertelen");

      saveStatus.textContent = "✓ Elmentve";
      setTimeout(() => { saveStatus.textContent = ""; }, 2500);
    } catch (err) {
      saveStatus.style.color = "#f87171";
      saveStatus.textContent = "Hiba: " + err.message;
    }
  });
})();
