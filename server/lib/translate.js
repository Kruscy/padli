import fetch from "node-fetch";
import { pool } from "../db.js";
import { callGemini } from "./gemini-client.js";
import { notifyAdminOnce } from "./admin-alert.js";

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const GEMINI_MODEL = "gemini-3.1-flash-lite";

async function logDeeplUsage(success, statusCode, errorMessage) {
  try {
    await pool.query(
      `INSERT INTO api_key_usage (provider, key_label, success, status_code, error_message) VALUES ($1,$2,$3,$4,$5)`,
      ["deepl", "DeepL", success, statusCode || null, errorMessage ? String(errorMessage).slice(0, 500) : null]
    );
  } catch (err) {
    console.error("api_key_usage log hiba:", err.message);
  }
}

async function translateWithDeepL(text) {
  const res = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      "Content-Type": "application/json"
    },
    // Az AniList-leírások HTML-t (<br>, <i>) tartalmazhatnak — ezt a DeepL
    // tag_handlinggel érintetlenül hagyja, nem fordítja bele
    body: JSON.stringify({ text: [text], target_lang: "HU", ...(/<[a-z\/]/i.test(text) ? { tag_handling: "html" } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  // A DeepL free kvóta kimerülésekor 456-ot ad vissza, de minden nem-OK
  // választ hibaként kezelünk.
  if (!res.ok) {
    await logDeeplUsage(false, res.status, null);
    if (res.status === 456) {
      await notifyAdminOnce("deepl", "⚠️ A DeepL fordító havi ingyenes kvótája elfogyott.");
    }
    throw new Error(`DeepL HTTP ${res.status}`);
  }
  const data = await res.json();
  const translated = data.translations?.[0]?.text;
  if (!translated) {
    await logDeeplUsage(false, res.status, "üres válasz");
    throw new Error("DeepL: üres válasz");
  }
  await logDeeplUsage(true, res.status, null);
  return translated;
}

async function translateWithGemini(text) {
  const data = await callGemini(GEMINI_MODEL, {
    contents: [{
      role: "user",
      parts: [{ text: "Fordítsd le magyarra az alábbi szöveget. Csak a fordítást add vissza, ne fűzz hozzá semmilyen magyarázatot vagy megjegyzést:\n\n" + text }]
    }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } }
  }, 20000, "translate");
  const translated = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("").trim();
  if (!translated) throw new Error("Gemini: üres válasz");
  return translated;
}

/* ── Magyar fordítás: Gemini elsőként, DeepL tartalékként ─────────────
   Elsőként Geminit hívunk (kulcs-rotációval, túlterhelésnél tartalék
   modellel). Ha az sem válaszol, a DeepL free fordít (2026-10-21: a
   Gemini-túlterhelés miatt a leírások különben angolul maradtak, a DeepL
   havi kerete pedig kihasználatlan volt). ── */
export async function tryTranslateToHungarian(text) {
  if (!text) return null;

  try {
    return await translateWithGemini(text);
  } catch (err) {
    console.error("Gemini fordítási hiba: " + err.message);
  }

  if (DEEPL_API_KEY) {
    try {
      return await translateWithDeepL(text);
    } catch (err) {
      console.error("DeepL fordítási hiba: " + err.message);
    }
  }

  return null;
}

// Sikertelen fordításnál az eredeti szöveget adja vissza (a szerkesztő
// fordító gombja ebből ismeri fel a hibát). Leírás mentéséhez a
// tryTranslateToHungarian kell: ott a null jelzi, hogy ne az angol
// szöveg kerüljön a magyar leírás helyére.
export async function translateToHungarian(text) {
  if (!text) return text;
  return (await tryTranslateToHungarian(text)) ?? text;
}
