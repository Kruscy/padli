// ============================================================
// patreon-settings.js - DEBUG VERZIÓ
// Részletes logging minden lépésnél
// ============================================================

console.log("📝 Patreon Settings Script betöltve");

/* ══════════════════════════════════════════════════════════
   LOGGING HELPER
   ══════════════════════════════════════════════════════════ */

function logDebug(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🐛 ${message}`);
  if (data) {
    console.log("   📦 Adat:", data);
  }
}

function logError(message, error = null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${message}`);
  if (error) {
    console.error("   🔥 Hiba:", error);
    if (error.stack) {
      console.error("   📚 Stack:", error.stack);
    }
  }
}

function logSuccess(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ✅ ${message}`);
  if (data) {
    console.log("   📦 Adat:", data);
  }
}

/* ══════════════════════════════════════════════════════════
   STATUS LEKÉRDEZÉS
   ══════════════════════════════════════════════════════════ */

async function loadPatreonStatus() {
  logDebug("loadPatreonStatus() meghívva");
  
  try {
    logDebug("Fetch indítása: /api/patreon/status");
    
    const res = await fetch("/api/patreon/status", {
      method: "GET",
      credentials: "include", // Cookie küldése
      headers: {
        "Accept": "application/json"
      }
    });

    logDebug("Fetch válasz érkezett", {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: {
        contentType: res.headers.get("content-type"),
        setCookie: res.headers.get("set-cookie")
      }
    });

    if (!res.ok) {
      logError("Status endpoint hiba", {
        status: res.status,
        statusText: res.statusText
      });
      
      if (res.status === 401) {
        logError("401 Unauthorized - Nincs session vagy lejárt");
        showDebugInfo("❌ Nincs bejelentkezve (401 Unauthorized)");
      } else if (res.status === 403) {
        logError("403 Forbidden - Hozzáférés megtagadva");
        showDebugInfo("❌ Hozzáférés megtagadva (403 Forbidden)");
      } else if (res.status === 500) {
        logError("500 Server Error - Backend hiba");
        showDebugInfo("❌ Szerver hiba (500)");
      }
      
      return;
    }

    logDebug("JSON parse kezdése");
    const data = await res.json();
    logSuccess("Status lekérdezés sikeres", data);

    const connected = document.getElementById("patreon-connected");
    const disconnected = document.getElementById("patreon-disconnected");

    if (!connected || !disconnected) {
      logError("DOM elemek hiányoznak", {
        connected: !!connected,
        disconnected: !!disconnected
      });
      return;
    }

    if (!data.connected) {
      logDebug("Patreon NINCS csatlakoztatva");
      disconnected.classList.remove("hidden");
      connected.classList.add("hidden");
      showDebugInfo("ℹ️ Patreon nincs csatlakoztatva");
    } else {
      logSuccess("Patreon csatlakoztatva", {
        tier: data.tier,
        active: data.active
      });
      
      const activeEl = document.getElementById("patreonActive");
      const tierEl = document.getElementById("patreonTier");
      
      if (activeEl) {
        activeEl.textContent = data.active ? "Aktív ✅" : "Inaktív ❌";
        logDebug("Active státusz beállítva:", data.active);
      }
      
      if (tierEl) {
        tierEl.textContent = data.tier || "—";
        logDebug("Tier beállítva:", data.tier);
      }

      connected.classList.remove("hidden");
      disconnected.classList.add("hidden");
      showDebugInfo(`✅ Patreon csatlakoztatva - ${data.tier || "Nincs tier"} - ${data.active ? "Aktív" : "Inaktív"}`);
    }

  } catch (err) {
    logError("loadPatreonStatus() catch block", err);
    showDebugInfo(`❌ Hiba: ${err.message}`);
  }
}

/* ══════════════════════════════════════════════════════════
   CONNECT BUTTON
   ══════════════════════════════════════════════════════════ */

const connectBtn = document.getElementById("patreonConnectBtn");

if (connectBtn) {
  logDebug("Connect gomb megtalálva, event listener hozzáadása");
  
  connectBtn.addEventListener("click", async () => {
    logDebug("🖱️ CONNECT gomb kattintva");
    
    try {
      // Ellenőrzés: van-e session?
      logDebug("Session ellenőrzés indítása");
      
      const sessionCheck = await fetch("/api/auth/check", {
        credentials: "include"
      });
      
      logDebug("Session check válasz", {
        status: sessionCheck.status,
        ok: sessionCheck.ok
      });
      
      if (!sessionCheck.ok) {
        logError("Session ellenőrzés sikertelen - Nincs bejelentkezve");
        alert("⚠️ Jelentkezz be először a Patreon csatlakoztatáshoz!");
        showDebugInfo("❌ Session ellenőrzés sikertelen");
        
        // Redirect login-ra
        logDebug("Redirect login.html-re");
        location.href = "/login.html?redirect=/settings.html&action=patreon";
        return;
      }
      
      logSuccess("Session OK, átirányítás /api/patreon/connect-re");
      showDebugInfo("🔄 Átirányítás Patreonra...");
      
      // Átirányítás
      location.href = "/api/patreon/connect";
      
    } catch (err) {
      logError("Connect button click hiba", err);
      
      // Ha session check endpoint nem létezik, próbáljuk meg direktben
      logDebug("Session check hiba, direkt átirányítás próbálása");
      showDebugInfo("⚠️ Session check hiba, átirányítás próbálása...");
      
      location.href = "/api/patreon/connect";
    }
  });
  
} else {
  logError("Connect gomb NEM található a DOM-ban!");
  showDebugInfo("❌ Connect gomb nem található");
}

/* ══════════════════════════════════════════════════════════
   DISCONNECT BUTTON
   ══════════════════════════════════════════════════════════ */

const disconnectBtn = document.getElementById("patreonDisconnectBtn");

if (disconnectBtn) {
  logDebug("Disconnect gomb megtalálva");
  
  disconnectBtn.addEventListener("click", async () => {
    logDebug("🖱️ DISCONNECT gomb kattintva");
    
    if (!confirm("Biztosan leválasztod a Patreon fiókot?")) {
      logDebug("Disconnect megerősítés visszavonva");
      return;
    }

    try {
      logDebug("Disconnect POST indítása");
      
      const res = await fetch("/api/patreon/disconnect", {
        method: "POST",
        credentials: "include"
      });
      
      logDebug("Disconnect válasz", {
        status: res.status,
        ok: res.ok
      });
      
      if (res.ok) {
        logSuccess("Disconnect sikeres");
        showDebugInfo("✅ Patreon leválasztva");
        location.reload();
      } else {
        logError("Disconnect hiba", { status: res.status });
        showDebugInfo(`❌ Disconnect hiba: ${res.status}`);
      }

    } catch (err) {
      logError("Disconnect catch block", err);
      showDebugInfo(`❌ Disconnect hiba: ${err.message}`);
    }
  });
  
} else {
  logError("Disconnect gomb NEM található!");
}

/* ══════════════════════════════════════════════════════════
   SYNC BUTTON
   ══════════════════════════════════════════════════════════ */

const syncBtn = document.getElementById("patreonSyncBtn");
const syncStatus = document.getElementById("patreonSyncStatus");

if (syncBtn) {
  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = "⏳ Frissítés...";
    if (syncStatus) syncStatus.textContent = "";

    try {
      const res = await fetch("/api/patreon/sync", {
        method: "POST",
        credentials: "include"
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const activeEl = document.getElementById("patreonActive");
        const tierEl = document.getElementById("patreonTier");
        if (activeEl) activeEl.textContent = data.active ? "Aktív ✅" : "Inaktív ❌";
        if (tierEl) tierEl.textContent = data.tier || "—";
        if (syncStatus) {
          syncStatus.style.color = "#4ade80";
          syncStatus.textContent = "✅ Frissítve";
        }
        logSuccess("Patreon sync sikeres", data);
      } else {
        if (syncStatus) {
          syncStatus.style.color = "#f87171";
          syncStatus.textContent = "❌ " + (data.error || "Hiba történt");
        }
        logError("Patreon sync hiba", data);
      }
    } catch (err) {
      if (syncStatus) {
        syncStatus.style.color = "#f87171";
        syncStatus.textContent = "❌ Hálózati hiba, próbáld újra.";
      }
      logError("Patreon sync catch", err);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = "🔄 Jogosultság frissítése";
    }
  });
}

/* ══════════════════════════════════════════════════════════
   URL PARAMÉTEREK (success/error)
   ══════════════════════════════════════════════════════════ */

logDebug("URL paraméterek ellenőrzése", {
  search: location.search,
  href: location.href
});

if (location.search.includes("patreon=connected")) {
  logSuccess("URL param: patreon=connected");
  alert("💜 Patreon sikeresen összekapcsolva!");
  showDebugInfo("✅ Patreon sikeresen összekapcsolva!");
  
  // URL tisztítása
  const cleanUrl = location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
  logDebug("URL megtisztítva");
}

if (location.search.includes("patreon=error")) {
  logError("URL param: patreon=error");
  
  const urlParams = new URLSearchParams(location.search);
  const reason = urlParams.get("reason") || "ismeretlen";
  
  alert(`❌ Patreon hiba történt! (${reason})`);
  showDebugInfo(`❌ Patreon hiba: ${reason}`);
  
  // URL tisztítása
  const cleanUrl = location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
}

/* ══════════════════════════════════════════════════════════
   DEBUG INFO BOX
   ══════════════════════════════════════════════════════════ */

function showDebugInfo(message) {
  const debugBox = document.getElementById("patreonDebugBox");
  if (!debugBox) {
    logDebug("Debug box nem található, létrehozás");
    createDebugBox();
    return showDebugInfo(message);
  }
  
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.style.cssText = "padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.75rem;";
  entry.textContent = `[${timestamp}] ${message}`;
  
  debugBox.appendChild(entry);
  
  // Scroll to bottom
  debugBox.scrollTop = debugBox.scrollHeight;
  
  // Max 50 bejegyzés
  if (debugBox.children.length > 50) {
    debugBox.removeChild(debugBox.firstChild);
  }
}

function createDebugBox() {
  logDebug("Debug box létrehozása");
  
  const box = document.createElement("div");
  box.id = "patreonDebugBox";
  box.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 400px;
    max-height: 300px;
    background: rgba(0, 0, 0, 0.9);
    border: 2px solid #7c3aed;
    border-radius: 8px;
    padding: 12px;
    color: #fff;
    font-family: monospace;
    font-size: 0.75rem;
    overflow-y: auto;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  `;
  
  const header = document.createElement("div");
  header.style.cssText = "font-weight: bold; margin-bottom: 8px; color: #a855f7; display: flex; justify-content: space-between; align-items: center;";
  header.innerHTML = `
    <span>🐛 Patreon Debug Log</span>
    <button onclick="this.parentElement.parentElement.remove()" style="background: #ef4444; border: none; color: white; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.7rem;">✕</button>
  `;
  
  box.appendChild(header);
  document.body.appendChild(box);
  
  logSuccess("Debug box létrehozva");
}

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */

logDebug("Script init kezdése");
createDebugBox();
showDebugInfo("🚀 Patreon Settings betöltve");

// Késleltetett status lekérdezés (DOM ready után)
if (document.readyState === "loading") {
  logDebug("DOM még töltődik, DOMContentLoaded listener hozzáadása");
  document.addEventListener("DOMContentLoaded", () => {
    logDebug("DOMContentLoaded fired");
    loadPatreonStatus();
  });
} else {
  logDebug("DOM már kész, azonnali status lekérdezés");
  loadPatreonStatus();
}

/* ══════════════════════════════════════════════════════════
   EXPORT DEBUG DATA
   ══════════════════════════════════════════════════════════ */

// Globális debug objektum
window.patreonDebug = {
  logs: [],
  
  exportLogs() {
    console.log("📥 Debug logok exportálása");
    const debugBox = document.getElementById("patreonDebugBox");
    if (debugBox) {
      const logs = Array.from(debugBox.children)
        .slice(1) // Skip header
        .map(el => el.textContent)
        .join("\n");
      
      console.log("=== PATREON DEBUG LOGS ===");
      console.log(logs);
      console.log("=========================");
      
      return logs;
    }
    return "Nincs log";
  },
  
  clearLogs() {
    const debugBox = document.getElementById("patreonDebugBox");
    if (debugBox) {
      while (debugBox.children.length > 1) {
        debugBox.removeChild(debugBox.lastChild);
      }
    }
    console.clear();
    logSuccess("Logok törölve");
  },
  
  testConnect() {
    logDebug("Manuális connect teszt");
    fetch("/api/patreon/connect", {
      method: "GET",
      credentials: "include",
      redirect: "manual"
    })
    .then(res => {
      logDebug("Connect test válasz", {
        status: res.status,
        type: res.type,
        redirected: res.redirected,
        url: res.url
      });
    })
    .catch(err => {
      logError("Connect test hiba", err);
    });
  },
  
  testStatus() {
    logDebug("Manuális status teszt");
    loadPatreonStatus();
  }
};

console.log("💡 Debug parancsok:");
console.log("   patreonDebug.exportLogs() - Logok exportálása");
console.log("   patreonDebug.clearLogs() - Logok törlése");
console.log("   patreonDebug.testConnect() - Connect endpoint teszt");
console.log("   patreonDebug.testStatus() - Status lekérdezés teszt");

logSuccess("Script init befejezve");
