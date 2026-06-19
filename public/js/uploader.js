/* ══════════════════════════════════════════════════════════
   UPLOADER — Kavita fájlfeltöltő
   ══════════════════════════════════════════════════════════ */

const CONCURRENT = 4; // párhuzamos feltöltések száma

let currentPath = "";
let uploadQueue = []; // { file, relativePath, status, progress }
let currentItems = []; // az aktuálisan betöltött fájlok/mappák
let browserFilter = ""; // szűrési szöveg

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

function addToQueue(file, relativePath) {
  // Ne adjuk hozzá kétszer ugyanazt
  const key = relativePath;
  if (uploadQueue.find(i => i.relativePath === key && i.status !== "error")) return;
  uploadQueue.push({ file, relativePath, status: "pending", progress: 0 });
}

/* ══════════════════════════════════════════════════════════
   QUEUE RENDER
   ══════════════════════════════════════════════════════════ */
function renderQueue() {
  if (!uploadQueue.length) {
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
      <span class="queue-item-status ${item.status}">${statusLabel(item.status)}</span>
    </div>
    ${item.status === "uploading" ? `
      <div class="queue-progress">
        <div class="queue-progress-bar" style="width:${item.progress}%"></div>
      </div>` : ""}
  `).join("");

  const done    = uploadQueue.filter(i => i.status === "done").length;
  const skipped = uploadQueue.filter(i => i.status === "skipped").length;
  const error   = uploadQueue.filter(i => i.status === "error").length;
  const active  = uploadQueue.filter(i => i.status === "uploading" || i.status === "pending").length;

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
  const isActive = uploadQueue.some(i => i.status === "uploading" || i.status === "pending");

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
    }
  } else {
    progressWrap.classList.add("hidden");
  }
}

function statusLabel(s) {
  return { pending: "⏳ Vár", uploading: "⬆️ Tölt...", done: "✅ Kész", error: "❌ Hiba", skipped: "⏭️ Kihagyva" }[s] || s;
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

async function startUpload() {
  const pending = uploadQueue.filter(i => i.status === "pending" || i.status === "error");
  if (!pending.length) return;

  uploadBtn.disabled = true;
  clearBtn.disabled  = true;
  uploadBtn.textContent = "⏳ Ellenőrzés...";

  // Új mappák ellenőrzése (ha sok fájl és van alkönyvtár a relatív útban)
  const topFolders = [...new Set(
    pending
      .filter(i => i.relativePath.includes("/"))
      .map(i => i.relativePath.split("/")[0])
  )];

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
          await fetch("/api/uploader/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: folderPath }),
          });
        }
      }
    } catch (err) {
      console.warn("Mappa ellenőrzés hiba:", err);
    }
  }

  // Meglévő fájlok ellenőrzése
  const destPaths = pending.map(item =>
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
        const item = pending.find(i => i.relativePath === rel);
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

  for (let i = 0; i < toUpload.length; i += CONCURRENT) {
    const batch = toUpload.slice(i, i + CONCURRENT);
    await Promise.all(batch.map(item => uploadItem(item)));
  }

  uploadBtn.disabled = false;
  clearBtn.disabled  = false;
  uploadBtn.textContent = "⬆️ Feltöltés indítása";
  loadFiles();
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

async function uploadItem(item) {
  item.status = "uploading";
  item.progress = 0;
  renderQueue();

  const destPath = currentPath
    ? `${currentPath}/${item.relativePath}`
    : item.relativePath;

  const fd = new FormData();
  fd.append("file", item.file);
  fd.append("path", destPath);

  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploader/upload");

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 100);
        renderQueue();
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        item.status = "done";
        item.progress = 100;
      } else {
        item.status = "error";
        console.warn("Upload hiba:", xhr.responseText);
      }
      renderQueue();
      resolve();
    };

    xhr.onerror = () => {
      item.status = "error";
      renderQueue();
      resolve();
    };

    xhr.send(fd);
  });
}

clearBtn.addEventListener("click", () => {
  uploadQueue = uploadQueue.filter(i => i.status !== "done");
  renderQueue();
});

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
              onclick="${isDir ? `navigateTo('${itemPath.replace(/'/g, "\\'")}')` : ""}"
              title="${item.name}">
          ${item.name}
        </span>
        ${size ? `<span class="file-item-size">${size}</span>` : ""}
        <button class="file-item-del" title="Törlés"
                onclick="deleteItem('${itemPath.replace(/'/g, "\\'")}', ${isDir})">
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
  let html = `<span class="breadcrumb-part" onclick="navigateTo('')">🏠 Gyökér</span>`;
  let built = "";
  parts.forEach((p, i) => {
    built = built ? `${built}/${p}` : p;
    const isLast = i === parts.length - 1;
    html += `<span class="breadcrumb-sep">/</span>`;
    if (isLast) {
      html += `<span class="breadcrumb-current">${p}</span>`;
    } else {
      const snap = built;
      html += `<span class="breadcrumb-part" onclick="navigateTo('${snap.replace(/'/g, "\\'")}')">${p}</span>`;
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

// Globálisba tesszük hogy az onclick attribútumok elérjék
window.navigateTo = navigateTo;
window.deleteItem = deleteItem;

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
