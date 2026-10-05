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
    ${item.status === "uploading" || item.status === "retrying" ? `
      <div class="queue-progress">
        <div class="queue-progress-bar" style="width:${item.progress}%"></div>
      </div>` : ""}
  `).join("");

  const done    = uploadQueue.filter(i => i.status === "done").length;
  const skipped = uploadQueue.filter(i => i.status === "skipped").length;
  const error   = uploadQueue.filter(i => i.status === "error").length;
  const active  = uploadQueue.filter(i => i.status === "uploading" || i.status === "retrying" || i.status === "pending").length;

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
  return { pending: "⏳ Vár", uploading: "⬆️ Tölt...", retrying: "🔁 Újrapróbálás...", done: "✅ Kész", error: "❌ Hiba", skipped: "⏭️ Kihagyva" }[s] || s;
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

  // Ha a sorban minden hibátlanul felment (és volt is mit feltölteni),
  // automatikusan indul egy scan, hogy az új fejezetek megjelenjenek.
  const anyError = uploadQueue.some(i => i.status === "error");
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

function showScanStatus(kind, text) {
  const box = document.getElementById("scanStatusMsg");
  if (!box) return;
  box.className = `scan-status-msg ${kind}`;
  box.textContent = text;
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
      ? "⏳ Scan elindítva — egy korábbi scan még fut, utána rögtön a tiéd következik..."
      : "🔄 A scan elindult — az új fejezetek feldolgozása folyamatban...");
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
          showScanStatus("ok", "✅ A scan befejeződött — az új fejezetek már megjelentek az oldalon.");
        } else {
          showScanStatus("error", `⚠️ A scan hibával állt le (kód: ${s.lastExitCode}). Szólj egy adminnak.`);
        }
        return;
      }
      if (ourScanStarted) {
        showScanStatus("running", "🔄 A scan fut — az új fejezetek feldolgozása folyamatban...");
      }
    } catch (err) {
      console.warn("Scan állapot lekérdezési hiba:", err);
    }

    if (Date.now() > deadline) {
      showScanStatus("error", "⚠️ Nem jött visszajelzés a scan befejezéséről. Nézd meg az oldalon, megjelentek-e a fejezetek.");
      return;
    }
    scanPollTimer = setTimeout(poll, 4000);
  };

  scanPollTimer = setTimeout(poll, 3000);
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
      resolve({ ok: xhr.status === 200 || xhr.status === 201, status: xhr.status, responseText: xhr.responseText });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, responseText: "network error" });

    xhr.send(fd);
  });
}

// Feltöltés max. 3 próbálkozással, automatikusan — korábban a userre
// hárult, hogy manuálisan próbálja újra a hibás elemeket (átlagosan
// 3x kellett kattintania). 4xx (kliens-oldali, pl. jogosultság/rossz
// mappanév) hibáknál nincs értelme újrapróbálni, azok azonnal buknak.
async function uploadItem(item) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    item.status = attempt === 1 ? "uploading" : "retrying";
    item.progress = 0;
    renderQueue();

    const result = await uploadAttempt(item);
    if (result.ok) {
      item.status = "done";
      item.progress = 100;
      renderQueue();
      return;
    }

    if (result.status >= 400 && result.status < 500) {
      console.warn("Upload hiba (nem javul újrapróbálásra):", result.responseText);
      break;
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, attempt * 1500));
    } else {
      console.warn(`Upload hiba (${MAX_ATTEMPTS} próbálkozás után):`, result.responseText);
    }
  }

  item.status = "error";
  renderQueue();
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
