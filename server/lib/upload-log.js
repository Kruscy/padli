/* ── Feltöltési hibák naplózása (2026-11-06) ──────────────────
   Ichmar feltöltései rendszeresen elbuktak („❌ Hiba”), de a szerver
   naplójában semmi nem látszott: a végpont a hibás/félbeszakadt
   kéréseket nem naplózta. Két forrásból gyűjtünk:
   1) szerveroldal: minden nem-2xx válasz és minden olyan kérés, amit a
      kliens (vagy a proxy) a válasz előtt bontott — mennyi adat jött meg
      a várt Content-Length-ből, mennyi ideig tartott;
   2) kliensoldal: a böngésző a feltöltési kör végén elküldi, mit látott
      (hálózati hiba / elakadás / timeout, hány bájt ment ki, a teljes
      fájl kiment-e már, amikor elakadt).
   Kimenet: journal ([FELTÖLTÉS-HIBA] / [FELTÖLTÉS-KLIENS] előtag) és
   logs/upload-errors.jsonl (méretkorláttal, egy régi példány marad). ── */
import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve("logs");
const LOG_FILE = path.join(LOG_DIR, "upload-errors.jsonl");
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const SLOW_MS = 30000;

function appendJsonl(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + ".1");
    } catch {}
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.warn("[upload-log] írási hiba:", err.message);
  }
}

function clientIp(req) {
  return req.headers["cf-connecting-ip"] || req.ip;
}

function headerPath(req) {
  const raw = req.headers["x-upload-path"];
  if (!raw) return null;
  try { return decodeURIComponent(String(raw)).slice(0, 500); } catch { return String(raw).slice(0, 500); }
}

const kb = n => (n == null ? "?" : `${Math.round(n / 1024)} KB`);

/* Middleware a multer ELÉ. A beérkezett bájtokat a multer req.pipe()
   hívásakor kezdjük számolni: egy korábban felrakott 'data' figyelő
   folyó módba kapcsolná a streamet, és a multer adatot veszítene.
   (A socket.bytesRead nem jó: a proxy keep-alive kapcsolatain több
   felhasználó kérései osztoznak.) */
export function trackUploadRequest(req, res, next) {
  const t0 = Date.now();
  const expected = Number(req.headers["content-length"]) || null;
  const ip = clientIp(req); // megszakadt kapcsolatnál később már nem olvasható
  let received = 0;
  let finished = false;
  let logged = false;

  const origPipe = req.pipe;
  req.pipe = function (dest, opts) {
    req.on("data", chunk => { received += chunk.length; });
    return origPipe.call(this, dest, opts);
  };

  // A végpont hibaüzenete (pl. 409/415 szövege) is kerüljön a naplóba
  const origJson = res.json.bind(res);
  res.json = body => {
    if (body && body.error) res.locals.uploadError = String(body.error).slice(0, 200);
    return origJson(body);
  };

  const log = (kind, extra = {}) => {
    if (logged) return;
    logged = true;
    const entry = {
      at: new Date().toISOString(),
      source: "server",
      kind, // "http_error" | "aborted" | "slow"
      user: req.session?.user?.username || null,
      userId: req.session?.user?.id || null,
      ip,
      path: req.body?.path || headerPath(req),
      expectedBytes: expected,
      receivedBytes: received,
      ms: Date.now() - t0,
      ...extra,
    };
    appendJsonl(entry);
    console.warn(
      `[FELTÖLTÉS-HIBA] ${entry.user || "?"} ${kind}${extra.status ? " HTTP " + extra.status : ""}` +
      ` „${entry.path || "?"}” — ${kb(received)} / ${kb(expected)} érkezett, ${(entry.ms / 1000).toFixed(1)} mp` +
      (extra.error ? ` — ${extra.error}` : "")
    );
  };

  res.on("finish", () => {
    finished = true;
    if (res.statusCode >= 400) log("http_error", { status: res.statusCode, error: res.locals.uploadError || null });
    // Sikeres, de nagyon lassú kérés: a kliens 45 mp mozdulatlanság után megszakít,
    // ezért a lassú, de még átment kérések is árulkodóak
    else if (Date.now() - t0 > SLOW_MS) log("slow", { status: res.statusCode });
  });
  res.on("close", () => {
    // writableFinished itt nem megbízható: megszakadt kapcsolatnál a
    // hibakezelő még „lezárja” a választ, de 'finish' sosem jön
    if (!finished) log("aborted", {
      bodyComplete: req.complete,
      error: req.complete ? "a kapcsolat a válasz előtt megszakadt (a fájl beérkezett)"
                          : "a kapcsolat a fájl feltöltése közben megszakadt",
    });
  });
  next();
}

/* Kliens-jelentés: egy feltöltési kör hibás fájljai. */
const reportCounts = new Map(); // userId -> { windowStart, n }
const REPORT_LIMIT_PER_HOUR = 30;
const MAX_ITEMS = 300;

const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max));
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

export function handleClientUploadReport(req, res) {
  const userId = req.session?.user?.id;
  const now = Date.now();
  const c = reportCounts.get(userId);
  if (c && now - c.windowStart < 3600e3) {
    if (c.n >= REPORT_LIMIT_PER_HOUR) return res.status(429).json({ error: "Túl sok jelentés" });
    c.n++;
  } else {
    reportCounts.set(userId, { windowStart: now, n: 1 });
  }

  const b = req.body || {};
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, MAX_ITEMS).map(i => ({
    path: str(i?.path, 500),
    size: num(i?.size),
    attempts: (Array.isArray(i?.attempts) ? i.attempts : []).slice(0, 5).map(a => ({
      status: num(a?.status),
      error: str(a?.error, 200),
      sent: num(a?.sent),
      total: num(a?.total),
      bodySent: !!a?.bodySent,
      ms: num(a?.ms),
    })),
  }));

  const entry = {
    at: new Date().toISOString(),
    source: "client",
    user: req.session.user.username,
    userId,
    ip: clientIp(req),
    ua: str(req.headers["user-agent"], 300),
    queued: num(b.queued),
    done: num(b.done),
    failed: num(b.failed),
    concurrent: num(b.concurrent),
    elapsedMs: num(b.elapsedMs),
    connection: b.connection && typeof b.connection === "object" ? {
      effectiveType: str(b.connection.effectiveType, 20),
      downlink: num(b.connection.downlink),
      rtt: num(b.connection.rtt),
    } : null,
    online: typeof b.online === "boolean" ? b.online : null,
    items,
  };
  appendJsonl(entry);

  // Összesítő sor a journalba: hibatípusonként darabszám + elakadt-e a teljes fájl kiküldése után
  const kinds = new Map();
  let afterBody = 0;
  for (const it of items) {
    const last = it.attempts[it.attempts.length - 1];
    if (!last) continue;
    const k = last.status ? `HTTP ${last.status}` : (last.error || "ismeretlen");
    kinds.set(k, (kinds.get(k) || 0) + 1);
    if (last.bodySent) afterBody++;
  }
  console.warn(
    `[FELTÖLTÉS-KLIENS] ${entry.user}: ${entry.failed ?? items.length} hibás / ${entry.queued ?? "?"} fájl` +
    ` (kész: ${entry.done ?? "?"}) — ${[...kinds].map(([k, n]) => `${k}: ${n}`).join(", ") || "nincs részlet"}` +
    `; ebből a teljes fájl kiküldése UTÁN akadt el: ${afterBody}`
  );
  res.json({ ok: true });
}
