import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { clearNewReleasesCache } from "../cache/new-releases.js";

// Kézi scan-t (header "Scan library" gomb, POST /api/admin/scan) csak ő
// indíthat. A feltöltő oldal a sikeres feltöltés után a saját végpontján
// (POST /api/uploader/scan) keresztül indít scant, ott nincs ilyen megkötés.
export const SCAN_OWNER_USER_ID = 5; // Ascyra

const SCAN_LOCK = "/tmp/padlizsanfansub.scan.lock";

// Az admin gomb és a feltöltő ugyanazt a sort használja, így egyszerre
// legfeljebb egy scan fut és legfeljebb egy vár utána.
// queuedScopes: null = nincs várakozó kérés; Set<string|null> = várakozó
// kérések könyvtár-útvonalai (null = teljes scan). Ha a futó scan végén
// pontosan egy, nem-teljes scope várakozik, csak azt futtatjuk újra —
// ha több különböző (vagy egy teljes) scope gyűlt össze, biztonságból
// teljes scant indítunk, hogy semelyik feltöltőé ne maradjon ki.
const state = {
  queuedScopes: null,
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

// A scan kimenete (benne a Discord-küldés esetleges hibája) eddig
// elveszett ("ignore") — most a logs/scan.log-ba megy. 5 MB fölött a régi
// napló scan.log.1 néven megmarad, és újat kezdünk.
const SCAN_LOG = path.join(process.cwd(), "logs", "scan.log");
function openScanLog() {
  try {
    fs.mkdirSync(path.dirname(SCAN_LOG), { recursive: true });
    if (fs.existsSync(SCAN_LOG) && fs.statSync(SCAN_LOG).size > 5 * 1024 * 1024) {
      fs.renameSync(SCAN_LOG, SCAN_LOG + ".1");
    }
    const fd = fs.openSync(SCAN_LOG, "a");
    fs.writeSync(fd, `\n===== Scan indul: ${new Date().toISOString()} =====\n`);
    return fd;
  } catch (err) {
    console.error("Scan napló megnyitási hiba:", err.message);
    return "ignore";
  }
}

function spawnScan(scopeLibraryPath = null) {
  clearNewReleasesCache();
  const logFd = openScanLog();
  const env = { ...process.env };
  if (scopeLibraryPath) env.SCAN_LIBRARY_PATH = scopeLibraryPath;
  else delete env.SCAN_LIBRARY_PATH;
  const scan = spawn("node", ["./server/scan.js"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env,
  });
  if (typeof logFd === "number") fs.closeSync(logFd); // a gyerekfolyamat már örökölte
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
  console.log(`🔄 Scan started${scopeLibraryPath ? ` (szűkítve: ${scopeLibraryPath})` : ""}`);
}

// "started" | "queued" — scopeLibraryPath: ha meg van adva, csak ennek a
// könyvtárnak az útvonalát nézi át a scan (feltöltés utáni auto-scan);
// ha nincs (admin gomb, cron), teljes scan megy.
export function requestScan(scopeLibraryPath = null) {
  if (!isScanRunning()) {
    spawnScan(scopeLibraryPath);
    return "started";
  }
  if (!state.queuedScopes) {
    state.queuedScopes = new Set([scopeLibraryPath]);
    console.log("⏳ Scan már fut – a következő scan sorba állt");
    // Megvárjuk amíg a lock felszabadul, majd elindítjuk
    const interval = setInterval(() => {
      if (!isScanRunning()) {
        clearInterval(interval);
        const scopes = state.queuedScopes;
        state.queuedScopes = null;
        const finalScope = (scopes.size === 1 && !scopes.has(null)) ? [...scopes][0] : null;
        spawnScan(finalScope);
      }
    }, 5000); // 5 másodpercenként ellenőrzi
  } else {
    state.queuedScopes.add(scopeLibraryPath);
    console.log("⏳ Scan már fut és egy scan már sorban van – összevonva");
  }
  return "queued";
}

// A futó scan előrehaladása (server/scan.js írja). Csak akkor adjuk vissza,
// ha a fájl a jelenleg futó (vagy épp most végzett) scan-folyamathoz tartozik.
const PROGRESS = "/tmp/padlizsanfansub.scan.progress.json";
const PHASE_PCT = { start: 2, unlock: 82, metadata: 88, cache: 93, discord: 96, done: 100 };
function readProgress() {
  try {
    const p = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
    if (Date.now() - (p.at || 0) > 15 * 60e3) return null; // elavult
    let percent = PHASE_PCT[p.phase] ?? 0;
    if (p.phase === "scan") percent = p.total ? Math.round(5 + 75 * Math.min(p.done, p.total) / p.total) : 5;
    return { phase: p.phase, done: p.done, total: p.total, percent, startedAt: p.startedAt };
  } catch {
    return null;
  }
}

export function getScanStatus() {
  return {
    progress: readProgress(),
    running: isScanRunning(),
    queued: !!state.queuedScopes,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastExitCode: state.lastExitCode,
    now: new Date(),
  };
}
