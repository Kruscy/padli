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

// Modell-szintű túlterhelés (2026-10-21-i diagnózis): a Google gyakran 503-at
// ("This model is currently experiencing high demand"), időtúllépést, vagy
// kvóta-azonosító nélküli 429 RESOURCE_EXHAUSTED-et ad — ilyenkor az egész
// MODELL túlterhelt, nem a kulcs fogyott ki, így a kulcscsere nem segít.
// Korábban minden ilyen hibánál a következő kulcsra ugrottunk (egy kérés =
// akár 11 hívás), a kvóta-azonosító nélküli 429 pedig mind a 11 kulcsot
// kitiltotta 65 mp-re és "minden kulcs kimerült" riasztást küldött.
// Most: modellenként legfeljebb OVERLOAD_ATTEMPTS próbálkozás rövid
// várakozással, utána a tartalék modell; a túlterhelt modellt rövid ideig
// kihagyjuk.
const FALLBACK_MODELS = {
  "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
};
const OVERLOAD_ATTEMPTS = 2;
const OVERLOAD_BACKOFF_MS = 2000;
const MODEL_COOLDOWN_MS = 30000;
const modelCooldownUntil = new Map(); // model -> timestamp

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

async function logUsage(keyLabel, success, statusCode, errorMessage, source) {
  try {
    await pool.query(
      `INSERT INTO api_key_usage (provider, key_label, success, status_code, error_message, source) VALUES ($1,$2,$3,$4,$5,$6)`,
      ["gemini", keyLabel, success, statusCode || null, errorMessage ? String(errorMessage).slice(0, 500) : null, source || null]
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
//
// FONTOS (2026-07-22-i incidens): a Gemini 429 válasza gyakran EGYSZERRE
// listázza a "PerDay" és "PerMinute" quotaId-t is (több egyidejűleg
// megsértett kvótát sorol fel egy válaszban), NEM azt jelenti, hogy a napi
// kvóta ténylegesen kimerült. Korábban ez az ambiguous eset "biztonságból"
// napi kimerülésnek számított — ez okozta, hogy egy pillanatnyi, sok
// párhuzamos kéréssel járó percenkénti (RPM) korlátozás (pl. PadliCrome
// egyszerre több oldalt fordít) az ÖSSZES kulcsot egyszerre "kimerültnek"
// jelölte egész napra, holott néhány kérésen kívül semmi nem történt és a
// kulcsok másodperceken belül újra sikeresen válaszoltak. Csak akkor
// tekintjük valódi napi kimerülésnek, ha KIZÁRÓLAG "PerDay" szerepel a
// válaszban — minden más (ambiguous vagy ismeretlen formátum) esetben a
// rövidebb, kevésbé zavaró percenkénti hűtést alkalmazzuk.
function isDailyQuotaError(bodyText) {
  const hasDaily = /PerDay/i.test(bodyText);
  const hasMinute = /PerMinute/i.test(bodyText);
  return hasDaily && !hasMinute;
}

// Kulcshoz kötött kvóta-hiba-e a 429: csak akkor, ha a válasz megnevezi a
// kvótát (PerDay / PerMinute quotaId). A kvóta-azonosító nélküli
// "Resource has been exhausted" a modell túlterheltsége — az mind a 11
// kulcson egyszerre jön, kulcscserével nem oldható meg.
function isKeyQuotaError(bodyText) {
  return /PerDay|PerMinute/i.test(bodyText);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A tartalék modellen a régi modellhez írt beállítás hibát adhat: a 3.5-ös
// modellek a thinkingBudget: 0-t 400-zal utasítják el, ott thinkingLevel kell.
function adaptNativeBody(body, model) {
  const tc = body?.generationConfig?.thinkingConfig;
  if (!tc || tc.thinkingBudget === undefined || !/^gemini-3\.5/.test(model)) return body;
  const { thinkingBudget, ...rest } = tc;
  return {
    ...body,
    generationConfig: {
      ...body.generationConfig,
      thinkingConfig: { ...rest, thinkingLevel: thinkingBudget === 0 ? "minimal" : "low" },
    },
  };
}

/**
 * Alacsony szintű, megosztott kulcs-rotációs logika. Bármilyen Gemini
 * HTTP hívást ki tud szolgálni (natív generateContent vagy az
 * OpenAI-kompatibilis chat/completions), a napi/percenkénti kvóta
 * kezelés és a naplózás minden hívónál ugyanaz.
 * @param {string} model - a kért modell; túlterheltség esetén a FALLBACK_MODELS szerinti tartalék
 * @param {(key: string, model: string) => {url: string, headers: object, body: object}} buildRequest
 * @param {number} timeoutMs
 * @param {string} source - melyik funkció hívta (pl. "padli-ai", "gemini-proxy") — a
 *   naplóba kerül, hogy egy jövőbeli burst-nél azonosítható legyen az okozó.
 */
async function callWithRotation(model, buildRequest, timeoutMs, source) {
  const KEYS = await loadKeys();
  if (!KEYS.length) {
    const err = new Error("Nincs beállítva Gemini API kulcs");
    err.isQuotaExhausted = false;
    throw err;
  }

  // A túlterhelés miatt pihentetett modellt kihagyjuk, amíg van másik
  const models = [model, FALLBACK_MODELS[model]].filter((m, i) => i === 0 || m);
  const nowMs = Date.now();
  const available = models.filter(m => (modelCooldownUntil.get(m) || 0) < nowMs);
  const modelOrder = available.length ? available : models;

  let lastErr = null;
  let allQuotaErrors = true;
  let overloaded = false;

  for (const currentModel of modelOrder) {
    const isFallback = currentModel !== model;
    let overloadFails = 0;

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

    // Túlterhelésnél (503 / időtúllépés / azonosító nélküli 429) legfeljebb
    // OVERLOAD_ATTEMPTS próbálkozás után a modellt pihentetjük és jön a tartalék
    const markOverload = async () => {
      overloaded = true;
      allQuotaErrors = false;
      overloadFails++;
      if (overloadFails >= OVERLOAD_ATTEMPTS) {
        modelCooldownUntil.set(currentModel, Date.now() + MODEL_COOLDOWN_MS);
        return true;
      }
      await sleep(OVERLOAD_BACKOFF_MS);
      return false;
    };
    const note = (msg) => (isFallback ? `[${currentModel}] ` : "") + (msg || "");

    for (const { label, key } of tryOrder) {
      try {
        recordRequest(label);
        const req = buildRequest(key, currentModel);
        const res = await fetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 429) {
          const text = await res.text().catch(() => "");

          if (!isKeyQuotaError(text)) {
            await logUsage(label, false, 429, note(text || "model overloaded"), source);
            lastErr = new Error(currentModel + ": a modell túlterhelt (429)");
            // Azonosító nélküli 429: a modell kapacitása fogyott el, a többi
            // kulcs is ugyanezt kapná — azonnal pihentetjük a modellt
            overloaded = true;
            allQuotaErrors = false;
            modelCooldownUntil.set(currentModel, Date.now() + MODEL_COOLDOWN_MS);
            break;
          }

          if (isDailyQuotaError(text)) {
            const wasAlreadyExhausted = (exhaustedUntil.get(label) || 0) > Date.now();
            exhaustedUntil.set(label, nextUtcMidnight());
            await logUsage(label, false, 429, note(text || "daily quota exceeded"), source);
            if (!wasAlreadyExhausted) {
              await notifyAdminOnce("gemini_" + label, "⚠️ A " + label + " Gemini API kulcs kimerült mára (napi ingyenes kvóta elfogyott).");
            }
            lastErr = new Error(label + ": napi kvóta kimerült (429)");
          } else {
            // Percenkénti (RPM) korlát – ez átmeneti, nem valódi kimerülés,
            // ezért csak rövid hűtési időt kap és nincs admin riasztás.
            exhaustedUntil.set(label, Date.now() + 65000);
            await logUsage(label, false, 429, note(text || "per-minute rate limit"), source);
            lastErr = new Error(label + ": percenkénti korlát elérve (429)");
          }
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          await logUsage(label, false, res.status, note(text), source);
          lastErr = new Error(label + ": HTTP " + res.status);
          if (res.status >= 500) {
            if (await markOverload()) break;
            continue;
          }
          allQuotaErrors = false;
          // 400 (a kérés hibás ennek a modellnek) / 404 (a modell nem elérhető):
          // minden kulcs ugyanezt adná — jöhet a tartalék modell
          if (res.status === 400 || res.status === 404) break;
          continue;
        }

        await logUsage(label, true, 200, isFallback ? `tartalék modell: ${currentModel}` : null, source);
        return await res.json();
      } catch (err) {
        lastErr = err;
        await logUsage(label, false, null, note(err.message), source);
        if (await markOverload()) break;
      }
    }
  }

  if (allQuotaErrors) {
    await notifyAdminOnce("gemini_all", "🚨 Mind a Gemini API kulcs kimerült" + (source ? ` (${source} hívás közben)` : "") + " — a Padli AI és a leírás-fordító sem tud most válaszolni Geminivel.");
  } else if (overloaded) {
    console.warn(`[gemini] a modell túlterhelt (${modelOrder.join(", ")})` + (source ? ` — ${source}` : ""));
  }
  const finalErr = lastErr || new Error("Nincs elérhető Gemini kulcs");
  finalErr.isQuotaExhausted = allQuotaErrors;
  finalErr.isOverloaded = overloaded && !allQuotaErrors;
  throw finalErr;
}

/**
 * Gemini generateContent hívás automatikus kulcs-rotációval.
 * @param {string} model - pl. "gemini-3.1-flash-lite"
 * @param {object} body - a generateContent request body (contents, systemInstruction, generationConfig)
 * @param {number} timeoutMs
 * @param {string} source - hívó azonosítója a naplózáshoz (pl. "padli-ai", "translate")
 * @returns {Promise<object>} a nyers Gemini JSON válasz
 */
export async function callGemini(model, body, timeoutMs = 30000, source = "unknown") {
  return callWithRotation(
    model,
    (key, m) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
      headers: { "Content-Type": "application/json" },
      body: m === model ? body : adaptNativeBody(body, m),
    }),
    timeoutMs,
    source
  );
}

/**
 * Gemini hívás az OpenAI-kompatibilis chat/completions endpointon
 * keresztül, ugyanazzal a kulcs-rotációval. Ehhez külső (más gépen
 * futó) szolgáltatások csatlakoznak a gemini-proxy route-on át.
 * @param {object} body - OpenAI chat/completions formátumú kérés
 * @param {number} timeoutMs
 * @param {string} source - hívó azonosítója a naplózáshoz
 */
export async function callGeminiOpenAiChat(body, timeoutMs = 60000, source = "unknown") {
  return callWithRotation(
    body?.model,
    (key, m) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: m === body?.model ? body : { ...body, model: m },
    }),
    timeoutMs,
    source
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
