import fetch from "node-fetch";
import { pool } from "../db.js";
import { notifyAdminOnce } from "./admin-alert.js";

/* ── Gemini kulcs-rotáció ─────────────────────────────────────
   Több ingyenes Gemini API kulcs között váltunk automatikusan, ha
   az egyik kimerül (429 / RESOURCE_EXHAUSTED). A kulcsokat a
   gemini_keys táblában tároljuk (admin panelről bővíthető/törölhető,
   újraindítás nélkül), első indításkor a régi .env kulcsokból
   töltjük fel. Minden hívást naplózunk az api_key_usage táblába
   (admin panel havi kimutatás ehhez), és riasztást küldünk az
   adminnak, amikor egy kulcs kimerül, illetve amikor mindegyik
   kimerült egyszerre. ── */

const MODEL_FOR_VALIDATION = "gemini-3.1-flash-lite";
const CACHE_TTL_MS = 30000;
const RPM_LIMIT = 15;
const RPM_WINDOW_MS = 60000;

let cachedKeys = null;
let cachedAt = 0;

async function ensureSeeded() {
  const envKeys = [
    { label: "Gemini-1", key: process.env.GEMINI_API_KEY },
    { label: "Gemini-2", key: process.env.GEMINI_API_KEY_2 },
    { label: "Gemini-3", key: process.env.GEMINI_API_KEY_3 },
  ].filter(k => k.key);
  for (const k of envKeys) {
    await pool.query(
      `INSERT INTO gemini_keys (label, api_key) VALUES ($1,$2)`,
      [k.label, k.key]
    );
  }
}

async function loadKeys() {
  const now = Date.now();
  if (cachedKeys && now - cachedAt < CACHE_TTL_MS) return cachedKeys;

  let { rows } = await pool.query(
    `SELECT id, label, api_key FROM gemini_keys WHERE is_active = true ORDER BY id`
  );
  if (rows.length === 0) {
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS c FROM gemini_keys`);
    if (countRows[0].c === 0) {
      await ensureSeeded();
      ({ rows } = await pool.query(
        `SELECT id, label, api_key FROM gemini_keys WHERE is_active = true ORDER BY id`
      ));
    }
  }

  cachedKeys = rows.map(r => ({ id: r.id, label: r.label, key: r.api_key }));
  cachedAt = now;
  return cachedKeys;
}

export function invalidateKeyCache() {
  cachedKeys = null;
  cachedAt = 0;
}

// Memóriában tartjuk, melyik kulcs mikorig számít kimerültnek —
// 429 után a következő UTC éjfélig nem próbálkozunk vele újra
// (a napi kvóták jellemzően éjfélkor resetelnek).
const exhaustedUntil = new Map();

function nextUtcMidnight() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

async function logUsage(keyLabel, success, statusCode, errorMessage) {
  try {
    await pool.query(
      `INSERT INTO api_key_usage (provider, key_label, success, status_code, error_message) VALUES ($1,$2,$3,$4,$5)`,
      ["gemini", keyLabel, success, statusCode || null, errorMessage ? String(errorMessage).slice(0, 500) : null]
    );
  } catch (err) {
    console.error("api_key_usage log hiba:", err.message);
  }
}

// Gördülő ablak (60mp) a percenkénti kérésszám becslésére kulcsonként,
// hogy proaktívan elkerüljük a 15 RPM ingyenes limitet ahelyett, hogy
// mindig ugyanazt (az elsőt) hajtanánk neki és csak a 429 után váltanánk.
const recentRequests = new Map(); // label -> timestamp[]

function requestsInLastMinute(label) {
  const now = Date.now();
  const arr = (recentRequests.get(label) || []).filter(t => now - t < RPM_WINDOW_MS);
  recentRequests.set(label, arr);
  return arr.length;
}

function recordRequest(label) {
  const arr = recentRequests.get(label) || [];
  arr.push(Date.now());
  recentRequests.set(label, arr);
}

// A Gemini 429 válasz szövegében a quotaId jelzi, hogy napi vagy
// percenkénti korlátról van-e szó (pl. "...PerDay..." vs "...PerMinute...").
// Ez alapján döntjük el, hogy egész napra letiltsuk-e a kulcsot, vagy csak
// egy rövid hűtési időre – különben egy átmeneti percenkénti pörgés is
// tévesen egész napra kiütné a kulcsot.
function isDailyQuotaError(bodyText) {
  const hasDaily = /PerDay/i.test(bodyText);
  const hasMinute = /PerMinute/i.test(bodyText);
  if (hasDaily && !hasMinute) return true;
  if (hasMinute && !hasDaily) return false;
  return true; // ismeretlen formátum esetén a biztonságosabb (napi) útra megyünk
}

/**
 * Alacsony szintű, megosztott kulcs-rotációs logika. Bármilyen Gemini
 * HTTP hívást ki tud szolgálni (natív generateContent vagy az
 * OpenAI-kompatibilis chat/completions), a napi/percenkénti kvóta
 * kezelés és a naplózás minden hívónál ugyanaz.
 * @param {(key: string) => string} buildUrl
 * @param {(key: string) => object} buildHeaders
 * @param {object} body
 * @param {number} timeoutMs
 */
async function callWithRotation(buildUrl, buildHeaders, body, timeoutMs) {
  const KEYS = await loadKeys();
  if (!KEYS.length) {
    const err = new Error("Nincs beállítva Gemini API kulcs");
    err.isQuotaExhausted = false;
    throw err;
  }

  const now = Date.now();
  const fresh = KEYS.filter(k => (exhaustedUntil.get(k.label) || 0) < now);
  const pool_ = fresh.length ? fresh : KEYS; // ha mind kimerült/korlátozott, azért próbáljuk – hátha közben resetelt

  // Előnyben részesítjük azokat a kulcsokat, amik az elmúlt percben még
  // nem közelítik meg a 15 RPM ingyenes limitet, és köztük is a
  // legkevesebbet használtat próbáljuk először – ez tényleges rotáció,
  // nem csak "mindig az első kulcs, amíg el nem romlik".
  const notBusy = pool_.filter(k => requestsInLastMinute(k.label) < RPM_LIMIT);
  const candidates = notBusy.length ? notBusy : pool_;
  // Holtverseny esetén (jellemzően minden kulcs 0 használattal áll a 60mp-es
  // ablakban) a JS sort() stabil, tehát ID sorrendet tartana – ez azt
  // eredményezte, hogy gyakorlatilag mindig ugyanaz a pár legrégebbi kulcs
  // kapta a forgalmat, az újonnan hozzáadottak meg sosem jutottak sorra.
  // Megkeveréssel a holtversenyek véletlenszerűen dőlnek el.
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const tryOrder = shuffled.sort(
    (a, b) => requestsInLastMinute(a.label) - requestsInLastMinute(b.label)
  );

  let lastErr = null;
  let allQuotaErrors = true;
  for (const { label, key } of tryOrder) {
    try {
      recordRequest(label);
      const res = await fetch(buildUrl(key), {
        method: "POST",
        headers: buildHeaders(key),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429) {
        const text = await res.text().catch(() => "");
        const isDaily = isDailyQuotaError(text);

        if (isDaily) {
          const wasAlreadyExhausted = (exhaustedUntil.get(label) || 0) > Date.now();
          exhaustedUntil.set(label, nextUtcMidnight());
          await logUsage(label, false, 429, "daily quota exceeded");
          if (!wasAlreadyExhausted) {
            await notifyAdminOnce("gemini_" + label, "⚠️ A " + label + " Gemini API kulcs kimerült mára (napi ingyenes kvóta elfogyott).");
          }
          lastErr = new Error(label + ": napi kvóta kimerült (429)");
        } else {
          // Percenkénti (RPM) korlát – ez átmeneti, nem valódi kimerülés,
          // ezért csak rövid hűtési időt kap és nincs admin riasztás.
          exhaustedUntil.set(label, Date.now() + 65000);
          await logUsage(label, false, 429, "per-minute rate limit");
          lastErr = new Error(label + ": percenkénti korlát elérve (429)");
        }
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        await logUsage(label, false, res.status, text);
        lastErr = new Error(label + ": HTTP " + res.status);
        allQuotaErrors = false;
        continue;
      }

      await logUsage(label, true, 200, null);
      return await res.json();
    } catch (err) {
      lastErr = err;
      allQuotaErrors = false;
      await logUsage(label, false, null, err.message);
    }
  }

  await notifyAdminOnce("gemini_all", "🚨 Mind a Gemini API kulcs kimerült — a Padli AI és a leírás-fordító sem tud most válaszolni Geminivel.");
  const finalErr = lastErr || new Error("Nincs elérhető Gemini kulcs");
  finalErr.isQuotaExhausted = allQuotaErrors;
  throw finalErr;
}

/**
 * Gemini generateContent hívás automatikus kulcs-rotációval.
 * @param {string} model - pl. "gemini-3.1-flash-lite"
 * @param {object} body - a generateContent request body (contents, systemInstruction, generationConfig)
 * @param {number} timeoutMs
 * @returns {Promise<object>} a nyers Gemini JSON válasz
 */
export async function callGemini(model, body, timeoutMs = 30000) {
  return callWithRotation(
    (key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    () => ({ "Content-Type": "application/json" }),
    body,
    timeoutMs
  );
}

/**
 * Gemini hívás az OpenAI-kompatibilis chat/completions endpointon
 * keresztül, ugyanazzal a kulcs-rotációval. Ehhez külső (más gépen
 * futó) szolgáltatások csatlakoznak a gemini-proxy route-on át.
 * @param {object} body - OpenAI chat/completions formátumú kérés
 * @param {number} timeoutMs
 */
export async function callGeminiOpenAiChat(body, timeoutMs = 60000) {
  return callWithRotation(
    () => `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
    (key) => ({ "Content-Type": "application/json", "Authorization": `Bearer ${key}` }),
    body,
    timeoutMs
  );
}

export async function getKeyLabels() {
  const KEYS = await loadKeys();
  return KEYS.map(k => k.label);
}

/* Valós idejű állapot (memóriában tartott kimerülés-info) az admin
   panel számára — pontosan azt tükrözi, amit a rotációs logika is
   használ, nem a naplóból utólag következtetett állapotot. */
export async function getStatus() {
  const KEYS = await loadKeys();
  const now = Date.now();
  return KEYS.map(k => ({
    id: k.id,
    label: k.label,
    exhausted: (exhaustedUntil.get(k.label) || 0) > now,
  }));
}

/* Új kulcs hozzáadása előtt gyors ellenőrzés egy minimális
   generateContent hívással — 400/403 esetén a kulcs érvénytelen,
   429 esetén a kulcs valós, csak épp kimerült a napi kvótája. */
export async function validateGeminiKey(apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_FOR_VALIDATION}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (res.status === 400 || res.status === 403) {
      return { valid: false, message: "Érvénytelen API kulcs" };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, message: "Nem sikerült ellenőrizni a kulcsot: " + err.message };
  }
}
