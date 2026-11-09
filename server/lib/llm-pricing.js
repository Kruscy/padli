/* ── GPT-modellek árazása pontban (2026-11-08) ─────────────────
   A Padlizsan Studio helyi motorja a képet a felhasználó gépén dolgozza
   fel, és csak a szöveg fordítását kéri tőlünk, a mi OpenAI-kulcsunkkal.
   Ezt tokenre pontosan számoljuk el:

     pont = valós költség (USD) × árfolyam × FELÁR / egy pont értéke (Ft)

   • egy pont értéke: a legolcsóbb pontcsomag (Max: 9999 Ft / 4000 pont
     = 2,50 Ft) — ennél olcsóbban senki nem jut ponthoz;
   • FELÁR 2,0 = a költségünk + ugyanannyi haszon (a user kérése:
     „legalább amennyit használnak, annyi hasznunk legyen”);
   • az árfolyam szándékosan kicsit a valós fölött van (árfolyamkockázat).
   Mind felülírható .env-ből újraindítással. ── */

export const USD_HUF  = Number(process.env.PC_USD_HUF) || 340;
export const MARKUP   = Number(process.env.PC_LLM_MARKUP) || 2.0;
export const POINT_FT = Number(process.env.PC_POINT_FT) || 2.5;

// USD / 1M token: [bemenet, gyorsítótárazott bemenet, kimenet]
// reasoning: ismeri-e a reasoning_effort-ot (a gpt-4.1 nem)
export const LLM_MODELS = {
  // 2026-11-08: mérve jó minőség, ~9× olcsóbb a 5.4 mininél; alapból „gondolkodna”, de a proxy
  // reasoning_effort nélkül none-t küld (különben ~3× drágább)
  "gpt-6-luna":   { label: "GPT-6 Luna (legolcsóbb, jó)",            price: [0.10, 0.01, 0.50], reasoning: true },
  "gpt-5.4-nano": { label: "GPT-5.4 nano (gyors, olcsó)",            price: [0.20, 0.02, 1.25], reasoning: true },
  "gpt-4.1-mini": { label: "GPT-4.1 mini (olcsó, jó)",                price: [0.40, 0.10, 1.60], reasoning: false },
  "gpt-5.4-mini": { label: "GPT-5.4 mini (ajánlott)",                 price: [0.75, 0.075, 4.50], reasoning: true },
  // 2026-11-09: a GPT-4.1 és a GPT-5.5 kikerült (drága, nem jobb); az árak a számláinkból visszaszámolva
  "gpt-5.4":       { label: "GPT-5.4 (nagyon jó)",                     price: [2.50, 0.25, 15.00], reasoning: true },
  "gpt-5.6-terra": { label: "GPT-5.6 Terra (legjobb)",                 price: [2.00, 0.20, 12.00], reasoning: true },
};
export const DEFAULT_LLM_MODEL = "gpt-5.4-mini";

// usage: { prompt_tokens, completion_tokens, prompt_tokens_details: { cached_tokens } }
export function usageCostUsd(model, usage) {
  const [pin, pcached, pout] = LLM_MODELS[model].price;
  const prompt = usage?.prompt_tokens || 0;
  const cached = Math.min(usage?.prompt_tokens_details?.cached_tokens || 0, prompt);
  const out = usage?.completion_tokens || 0;
  return ((prompt - cached) * pin + cached * pcached + out * pout) / 1e6;
}

export const usdToPoints = usd => (usd * USD_HUF * MARKUP) / POINT_FT;

// Minimum oldalanként (2026-11-08, a user döntése): 0,4 pont = 1 Ft. A helyi
// motor oldalanként egy hívást küld (a korábbi oldalak kontextusával, ~4000
// token), ezért hívásonként alkalmazzuk — de csak valódi fordításra: a
// „Kapcsolat tesztelése” apró hívására (MIN_FROM_PROMPT_TOKENS alatt) nem.
export const MIN_POINTS_PER_PAGE = Number(process.env.PC_LLM_MIN_POINTS) || 0.4;
export const MIN_FROM_PROMPT_TOKENS = 500;
export const callPoints = (usd, promptTokens) =>
  promptTokens >= MIN_FROM_PROMPT_TOKENS ? Math.max(MIN_POINTS_PER_PAGE, usdToPoints(usd)) : usdToPoints(usd);

// A felületnek: pont / 1M token, és becslés egy átlagos oldalra
// (2026-11-08 éles mérés a helyi motorral: ~3600–4200 bemeneti token a
// korábbi oldalak kontextusával + ~350–420 kimeneti)
export function modelPriceList() {
  return Object.entries(LLM_MODELS).map(([id, m]) => {
    // 2026-11-09: egy fejezet 2. oldalától az utasítás nagy része az OpenAI gyorsítótárából jön
    // (mérve: 4203-ból 2688 token), ezért a becslés 1500 friss + 2500 gyorsítótáras + 400 kimeneti token
    const [pin, pcached, pout] = m.price;
    const perPage = Math.max(MIN_POINTS_PER_PAGE, usdToPoints((1500 * pin + 2500 * pcached + 400 * pout) / 1e6));
    return {
      id, label: m.label, default: id === DEFAULT_LLM_MODEL,
      points_per_1m_input: +usdToPoints(pin).toFixed(2),
      points_per_1m_output: +usdToPoints(pout).toFixed(2),
      est_points_per_page: +perPage.toFixed(3),
    };
  });
}
