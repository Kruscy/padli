import fetch from "node-fetch";
import OpenAI from "openai";
import { callGemini } from "./gemini-client.js";

/* ── Magyar cím ellenőrzés — 4 szintű tartalék lánc ────────────
   1. Geoapify (OpenStreetMap alapú geocoding)
   2. Google Geocoding
   3. Gemini (AI-alapú plauzibilitás-ellenőrzés)
   4. GPT (AI-alapú plauzibilitás-ellenőrzés)

   A cél: kiszűrni a nyilvánvalóan kitalált/hamis címeket (pl.
   "Uz, Zh, 6800"), amiket a szabad szöveges beviteli mezőkbe
   bárki beírhat. Az 1-2. szint valós térképi adatokhoz illeszti
   a bevitt címet; ha mindkettő elérhetetlen (saját infra-hiba),
   a 3-4. szint egy AI modellt kérdez meg, hogy plauzibilis-e a
   cím (irányítószám ↔ város ↔ utca egyezés).

   SOHA nem engedünk át semmit ellenőrzés nélkül — csak akkor
   fail-open, ha mind a 4 szolgáltatás egyszerre elérhetetlen. ── */

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // ékezetek eltávolítása
    .replace(/[^a-z0-9]/g, "");
}

async function validateWithGeoapify({ post_code, city, street, house_number }) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return null; // nincs beállítva, próbáljuk a másik szolgáltatót

  const query = `${street} ${house_number}, ${post_code} ${city}, Hungary`;
  const res = await fetch(
    `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&apiKey=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error("Geoapify HTTP " + res.status);

  const data = await res.json();
  const props = data.features?.[0]?.properties;
  if (!props) {
    return { valid: false, reason: "A megadott cím nem található." };
  }

  const preciseEnough = ["building", "street", "amenity"].includes(props.result_type);
  if (!preciseEnough) {
    return { valid: false, reason: "A megadott cím nem azonosítható be pontosan (ellenőrizd az utcanevet és a házszámot)." };
  }

  const cityMatches = normalize(props.city || props.county) === normalize(city)
    || normalize(props.city || "").includes(normalize(city))
    || normalize(city).includes(normalize(props.city || ""));
  const postcodeMatches = (props.postcode || "").trim() === post_code.trim();

  if (!postcodeMatches || !cityMatches) {
    return {
      valid: false,
      reason: `A megadott irányítószám/város nem egyezik a valós címmel (a rendszer szerint: ${props.postcode} ${props.city}).`,
    };
  }

  return { valid: true, normalized: props, provider: "geoapify" };
}

async function validateWithGoogle({ post_code, city, street, house_number }) {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) return null;

  const query = `${street} ${house_number}, ${city}, ${post_code}, Hungary`;
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error("Google Geocoding HTTP " + res.status);

  const data = await res.json();
  if (data.status === "ZERO_RESULTS") {
    return { valid: false, reason: "A megadott cím nem található." };
  }
  if (data.status !== "OK") throw new Error("Google Geocoding status: " + data.status);

  const result = data.results?.[0];
  const locationType = result?.geometry?.location_type;
  const preciseEnough = locationType === "ROOFTOP" || locationType === "RANGE_INTERPOLATED";
  if (!preciseEnough) {
    return { valid: false, reason: "A megadott cím nem azonosítható be pontosan (ellenőrizd az utcanevet és a házszámot)." };
  }

  const comp = (type) => result.address_components.find(c => c.types.includes(type))?.long_name || "";
  const foundCity = comp("locality") || comp("postal_town") || comp("administrative_area_level_2");
  const foundPostcode = comp("postal_code");

  const cityMatches = normalize(foundCity).includes(normalize(city)) || normalize(city).includes(normalize(foundCity));
  const postcodeMatches = foundPostcode.trim() === post_code.trim();

  if (!postcodeMatches || !cityMatches) {
    return {
      valid: false,
      reason: `A megadott irányítószám/város nem egyezik a valós címmel (a rendszer szerint: ${foundPostcode} ${foundCity}).`,
    };
  }

  return { valid: true, normalized: result, provider: "google" };
}

function buildPlausibilityPrompt({ post_code, city, street, house_number }) {
  return `Egy magyarországi cím hitelességét kell megítélned. Az alábbi címet egy felhasználó adta meg egy weboldalon, számla kiállításához:

Irányítószám: ${post_code}
Település: ${city}
Utca: ${street}
Házszám: ${house_number}

Létezik-e Magyarországon ilyen irányítószám, és ahhoz TÉNYLEG ez a település tartozik-e? Plauzibilis-e az utcanév (nem kitalált, nem értelmetlen rövidítés, pl. nem "Zh" vagy "Xy")?

Válaszolj KIZÁRÓLAG egy JSON objektummal, más szöveg nélkül:
{"valid": true vagy false, "reason": "rövid magyar indoklás"}`;
}

function parseAiJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Nem sikerült JSON-t kinyerni az AI válaszból");
  return JSON.parse(match[0]);
}

async function validateWithGemini(addr) {
  const data = await callGemini("gemini-3.1-flash-lite", {
    contents: [{ role: "user", parts: [{ text: buildPlausibilityPrompt(addr) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
  }, 15000, "address-validate");
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  const parsed = parseAiJson(text);
  return { valid: !!parsed.valid, reason: parsed.reason || "Az AI ellenőrzés szerint a cím nem tűnik valódinak.", provider: "gemini" };
}

async function validateWithGpt(addr) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const openai = new OpenAI({ apiKey });
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    temperature: 0,
    messages: [{ role: "user", content: buildPlausibilityPrompt(addr) }],
  });
  const text = res.choices?.[0]?.message?.content || "";
  const parsed = parseAiJson(text);
  return { valid: !!parsed.valid, reason: parsed.reason || "Az AI ellenőrzés szerint a cím nem tűnik valódinak.", provider: "gpt" };
}

export async function validateHungarianAddress(addr) {
  try {
    const r = await validateWithGeoapify(addr);
    if (r) return r;
  } catch (err) {
    console.error("[address-validate] Geoapify hiba, Google fallback:", err.message);
  }

  try {
    const r = await validateWithGoogle(addr);
    if (r) return r;
  } catch (err) {
    console.error("[address-validate] Google Geocoding hiba is, Gemini fallback:", err.message);
  }

  try {
    const r = await validateWithGemini(addr);
    if (r) return r;
  } catch (err) {
    console.error("[address-validate] Gemini hiba is, GPT fallback:", err.message);
  }

  try {
    const r = await validateWithGpt(addr);
    if (r) return r;
  } catch (err) {
    console.error("[address-validate] GPT hiba is:", err.message);
  }

  // Mind a 4 szolgáltató elérhetetlen vagy nincs beállítva kulcs —
  // ez már valóban a mi infrastruktúránk hibája, nem blokkoljuk emiatt
  // a felhasználót.
  return { valid: true, skipped: true };
}

/* ── Valódi név ellenőrzése ─────────────────────────────────────
   Két lépcső:
   1. Gyors, olcsó heurisztika (üres, felhasználónévvel egyezik,
      nincs szóköz, számot tartalmaz) — ezt azonnal elutasítjuk,
      AI hívás nélkül.
   2. AI-alapú plauzibilitás-ellenőrzés (Gemini elsődleges, GPT
      tartalék) — ez szűri ki azt, ami formailag két szóból áll,
      de értelmetlen karaktersorozat (pl. "Asdf Qwerty", "Xyzz
      Blah"), amit a heurisztika önmagában nem tud felismerni.
   Csak akkor engedünk át AI-ellenőrzés nélkül, ha MINDKÉT AI
   szolgáltatás elérhetetlen (saját infra-hiba). ── */
function nameHeuristicCheck(name, username) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { valid: false, reason: "A név megadása kötelező." };

  if (normalize(trimmed) === normalize(username || "")) {
    return { valid: false, reason: "Kérjük a valódi nevedet add meg, ne a felhasználóneved." };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return { valid: false, reason: "Kérjük add meg a teljes neved (vezetéknév és keresztnév is)." };
  }
  if (parts.some(p => p.length < 2)) {
    return { valid: false, reason: "Érvénytelen név." };
  }
  if (/\d/.test(trimmed)) {
    return { valid: false, reason: "A név nem tartalmazhat számot." };
  }

  return { valid: true };
}

function buildNamePlausibilityPrompt(name) {
  return `El kell döntened, hogy az alábbi szöveg egy VALÓDI, hihető emberi teljes név-e (vezetéknév + keresztnév), amit egy számla kiállításához adtak meg:

"${name}"

Utasítsd el, ha: értelmetlen karaktersorozat, billentyűzet-kopogás (pl. "Asdf Qwerty", "Xyzz Blah"), nyilvánvaló becenév/felhasználónév, placeholder szöveg (pl. "Teszt Elek" is gyanús, de fogadd el, ha egyébként hihető magyar vagy külföldi névnek tűnik), vagy bármi más, ami nem tűnik valódi emberi névnek.
Fogadd el, ha hihető magyar vagy külföldi emberi névnek tűnik, még akkor is, ha nem ismered a konkrét személyt.

Válaszolj KIZÁRÓLAG egy JSON objektummal, más szöveg nélkül:
{"valid": true vagy false, "reason": "rövid magyar indoklás"}`;
}

async function validateNameWithGemini(name) {
  const data = await callGemini("gemini-3.1-flash-lite", {
    contents: [{ role: "user", parts: [{ text: buildNamePlausibilityPrompt(name) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 150, thinkingConfig: { thinkingBudget: 0 } },
  }, 15000, "address-validate");
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  const parsed = parseAiJson(text);
  return { valid: !!parsed.valid, reason: parsed.reason || "A név nem tűnik valódinak." };
}

async function validateNameWithGpt(name) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const openai = new OpenAI({ apiKey });
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    temperature: 0,
    messages: [{ role: "user", content: buildNamePlausibilityPrompt(name) }],
  });
  const text = res.choices?.[0]?.message?.content || "";
  const parsed = parseAiJson(text);
  return { valid: !!parsed.valid, reason: parsed.reason || "A név nem tűnik valódinak." };
}

export async function validateRealName(name, username) {
  const heuristic = nameHeuristicCheck(name, username);
  if (!heuristic.valid) return heuristic;

  const trimmed = name.trim();

  try {
    const r = await validateNameWithGemini(trimmed);
    if (r) return r;
  } catch (err) {
    console.error("[address-validate] névellenőrzés Gemini hiba, GPT fallback:", err.message);
  }

  try {
    const r = await validateNameWithGpt(trimmed);
    if (r) return r;
  } catch (err) {
    console.error("[address-validate] névellenőrzés GPT hiba is:", err.message);
  }

  // Mindkét AI elérhetetlen — ne blokkoljuk a felhasználót a mi
  // infrastruktúránk hibája miatt, a heurisztikus ellenőrzés
  // már lefutott sikeresen.
  return { valid: true, skipped: true };
}
