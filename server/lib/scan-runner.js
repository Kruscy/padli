import fs from "fs";
import { spawn } from "child_process";
import { clearNewReleasesCache } from "../cache/new-releases.js";

// Kézi scan-t (header "Scan library" gomb, POST /api/admin/scan) csak ő
// indíthat. A feltöltő oldal a sikeres feltöltés után a saját végpontján
// (POST /api/uploader/scan) keresztül indít scant, ott nincs ilyen megkötés.
export const SCAN_OWNER_USER_ID = 5; // Ascyra

const SCAN_LOCK = "/tmp/padlizsanfansub.scan.lock";

// Az admin gomb és a feltöltő ugyanazt a sort használja, így egyszerre
// legfeljebb egy scan fut és legfeljebb egy vár utána.
const state = {
  queued: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastExitCode: null,
};

export function isScanRunning() {
  if (!fs.existsSync(SCAN_LOCK)) return false;
  // Stale lock ellenőrzés: ha a PID már nem él, töröljük
  try {
    const pid = parseInt(fs.readFileSync(SCAN_LOCK, "utf8").trim(), 10);
    process.kill(pid, 0); // 0 = csak ellenőrzés, nem küld signalt
    return true; // PID él → scan fut
  } catch {
    try { fs.unlinkSync(SCAN_LOCK); } catch {} // stale lock → töröljük
    return false;
  }
}

function spawnScan() {
  clearNewReleasesCache();
  const scan = spawn("node", ["./server/scan.js"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore"
  });
  state.lastStartedAt = new Date();
  scan.on("exit", (code) => {
    state.lastFinishedAt = new Date();
    state.lastExitCode = code;
    // A scan közben érkező kérések a régi listával tölthették újra a
    // cache-t, ezért a végén is ürítjük, hogy az új fejezetek látszódjanak.
    clearNewReleasesCache();
    console.log(`✅ Scan befejeződött (kilépési kód: ${code})`);
  });
  scan.on("error", (err) => {
    state.lastFinishedAt = new Date();
    state.lastExitCode = -1;
    console.error("❌ Scan spawn hiba:", err.message);
  });
  scan.unref();
  console.log("🔄 Scan started");
}

// "started" | "queued"
export function requestScan() {
  if (!isScanRunning()) {
    spawnScan();
    return "started";
  }
  if (!state.queued) {
    state.queued = true;
    console.log("⏳ Scan már fut – a következő scan sorba állt");
    // Megvárjuk amíg a lock felszabadul, majd elindítjuk
    const interval = setInterval(() => {
      if (!isScanRunning()) {
        clearInterval(interval);
        state.queued = false;
        spawnScan();
      }
    }, 5000); // 5 másodpercenként ellenőrzi
  } else {
    console.log("⏳ Scan már fut és egy scan már sorban van – összevonva");
  }
  return "queued";
}

export function getScanStatus() {
  return {
    running: isScanRunning(),
    queued: state.queued,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastExitCode: state.lastExitCode,
    now: new Date(),
  };
}
