/* ── Buborékszövegek fordítása GPT-vel (2026-11-08) ────────────
   A külső PadliCrome-ban a képelemzést és a szövegbeírást a Torii végzi,
   a fordítást mi: csak a kiolvasott szöveget kapjuk, képet nem.
   Modell: gpt-5.4-mini (mérve: ~0,26 Ft egy 10 buborékos oldal).
   Egy kérés egy egész fejezet lehet: a modell látja az összefüggést
   (nevek, tegezés/magázás egységes), és az állandó rendszer-prompt az
   OpenAI-nál gyorsítótárazódik (90%-kal olcsóbb bemenet).
   A pages[i] tömb hossza a válaszban kötelezően megegyezik a bemenetével
   (JSON-séma + ellenőrzés), különben a buborékok elcsúsznának. ── */

export const TEXT_MODEL = process.env.PC_TEXT_MODEL || "gpt-5.4-mini";
// USD / 1M token: bemenet, gyorsítótárazott bemenet, kimenet
const PRICES = {
  "gpt-5.4-mini": [0.75, 0.075, 4.50],
  "gpt-6-luna":   [0.10, 0.01, 0.50],
  "gpt-4.1-mini": [0.40, 0.10, 1.60],
  "gpt-5.4-nano": [0.20, 0.02, 1.25],
};

export const LIMITS = { pages: 80, bubblesPerPage: 80, charsPerBubble: 1000, totalChars: 60000 };
const PAGES_PER_CALL = 20;      // ennyi oldal egy modellhívásban (a kimenet ne vágódjon le)
const CALL_TIMEOUT_MS = 120000;

const SYSTEM_PROMPT = `Profi manga/manhwa/manhua fordító vagy egy magyar fansub csapatnál. Szövegbuborékokat fordítasz magyarra.

Szabályok:
- Természetes, élő, olvasmányos magyar szöveg; a szereplők hangvételét (durva, kedves, hivatalos, gúnyos) tartsd meg. Ne tükörfordíts.
- Tegeződés fiatalok, barátok, ellenségek között; magázás idősebbeknek, feletteseknek, idegeneknek hivatalos helyzetben. Egy szereplőpár között a fejezeten belül következetesen.
- Hangutánzó szavakat (SFX) magyar megfelelővel add vissza (pl. BANG → BUMM, WHOOSH → SUHH), ha nincs értelmes megfelelője, hagyd meg.
- Személy- és helyneveket ne fordíts. Ha szójegyzéket kapsz, azt kötelező követni.
- Az írásjeleket (…, !!, ?!) és a nagybetűs kiemelést tartsd meg.
- Minden bemeneti buborékhoz pontosan egy kimeneti szöveg tartozik, ugyanabban a sorrendben, oldalanként ugyanannyi elem. Buborékot ne vonj össze, ne hagyj ki; üres bemenetre üres szöveg.
- Csak a fordítást add vissza, megjegyzés nélkül.`;

const SCHEMA = {
  name: "translation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pages: { type: "array", items: { type: "array", items: { type: "string" } } },
    },
    required: ["pages"],
  },
};

// Bemenet ellenőrzése → { pages, glossary, notes } vagy hibaszöveg (string)
export function validateInput(body) {
  const pages = body?.pages;
  if (!Array.isArray(pages) || !pages.length) return "A „pages” kötelező: oldalanként a buborékszövegek tömbje";
  if (pages.length > LIMITS.pages) return `Egy kérésben legfeljebb ${LIMITS.pages} oldal lehet`;
  let total = 0;
  for (const p of pages) {
    if (!Array.isArray(p)) return "Minden oldal szövegek tömbje kell legyen";
    if (p.length > LIMITS.bubblesPerPage) return `Egy oldalon legfeljebb ${LIMITS.bubblesPerPage} buborék lehet`;
    for (const t of p) {
      if (typeof t !== "string") return "A buborékok szövegek kell legyenek";
      if (t.length > LIMITS.charsPerBubble) return `Egy buborék legfeljebb ${LIMITS.charsPerBubble} karakter lehet`;
      total += t.length;
    }
  }
  if (total > LIMITS.totalChars) return `Egy kérésben legfeljebb ${LIMITS.totalChars} karakter lehet`;

  // szójegyzék: { "angol": "magyar" } vagy [{ source, target }]
  let glossary = [];
  const g = body.glossary;
  if (g && typeof g === "object") {
    const entries = Array.isArray(g) ? g.map(e => [e?.source, e?.target]) : Object.entries(g);
    glossary = entries
      .filter(([s, t]) => typeof s === "string" && typeof t === "string" && s.trim())
      .slice(0, 200)
      .map(([s, t]) => [s.trim().slice(0, 100), t.trim().slice(0, 100)]);
  }
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1500) : "";
  return { pages, glossary, notes };
}

// Oldalak, amelyeken van legalább egy nem üres buborék (ezekért jár pont)
export const billablePages = pages => pages.filter(p => p.some(t => t.trim())).length;

async function callModel(userContent) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TEXT_MODEL,
        reasoning_effort: "none",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userContent }],
        response_format: { type: "json_schema", json_schema: SCHEMA },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${j.error?.message || "ismeretlen hiba"}`);
    return j;
  } finally {
    clearTimeout(timer);
  }
}

function costOf(u) {
  const [pin, pcached, pout] = PRICES[TEXT_MODEL] || PRICES["gpt-5.4-mini"];
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return ((u.prompt_tokens - cached) * pin + cached * pcached + u.completion_tokens * pout) / 1e6;
}

/* Fordítás. Visszaad: { pages, usage: { prompt, cached, completion, costUsd } }
   Hiba esetén kivételt dob (a hívó adja vissza a pontot). */
export async function translateBubbles({ pages, glossary, notes, title }) {
  const usage = { prompt: 0, cached: 0, completion: 0, costUsd: 0 };
  const out = new Array(pages.length);

  // Az üres oldalakat nem küldjük el
  const idx = pages.map((p, i) => (p.some(t => t.trim()) ? i : -1)).filter(i => i >= 0);
  pages.forEach((p, i) => { if (!idx.includes(i)) out[i] = p.map(() => ""); });

  const header = [
    title ? `Mű: ${title}` : "",
    glossary.length ? "Szójegyzék (kötelező):\n" + glossary.map(([s, t]) => `${s} = ${t}`).join("\n") : "",
    notes ? `Megjegyzés a fordítónak: ${notes}` : "",
  ].filter(Boolean).join("\n\n");

  for (let start = 0; start < idx.length; start += PAGES_PER_CALL) {
    const chunk = idx.slice(start, start + PAGES_PER_CALL);
    const input = chunk.map(i => pages[i]);
    const userContent = (header ? header + "\n\n" : "") +
      "Fordítandó oldalak (JSON: oldalanként a buborékok):\n" + JSON.stringify({ pages: input });

    let result = null;
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
      const j = await callModel(userContent);
      const u = j.usage || {};
      usage.prompt += u.prompt_tokens || 0;
      usage.cached += u.prompt_tokens_details?.cached_tokens || 0;
      usage.completion += u.completion_tokens || 0;
      usage.costUsd += costOf({ prompt_tokens: u.prompt_tokens || 0, completion_tokens: u.completion_tokens || 0, prompt_tokens_details: u.prompt_tokens_details });
      let parsed;
      try { parsed = JSON.parse(j.choices?.[0]?.message?.content || "").pages; } catch { parsed = null; }
      const shapeOk = Array.isArray(parsed) && parsed.length === input.length &&
        parsed.every((p, k) => Array.isArray(p) && p.length === input[k].length && p.every(t => typeof t === "string"));
      if (shapeOk) result = parsed;
      else if (attempt === 2) throw new Error("A modell válaszában nem egyezett a buborékok száma");
    }
    chunk.forEach((i, k) => {
      // üres bemeneti buborék → üres kimenet (a modell néha kitölti)
      out[i] = result[k].map((t, b) => (pages[i][b].trim() ? t : ""));
    });
  }
  return { pages: out, usage };
}
