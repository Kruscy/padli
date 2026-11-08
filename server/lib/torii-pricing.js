/* ── Torii-modellek árazása pontban (2026-11-08) ────────────────
   A Padlizsan Studio felhős (Torii) módjában a felhasználó választhat
   modellt. A Torii minden válaszban megadja a valós fogyasztást
   (metadata.credits_used, tokenek); ebből számolunk:

     költség (Ft) = kredit × KREDIT_FT  [+ BYOK-nál a mi OpenAI-díjunk]
     pont         = max(1, költség × FELÁR / PONT_FT)

   • KREDIT_FT: 27 883 Ft / 60 000 kredit = 0,465 Ft (a user vásárlása);
   • FELÁR 2,0 = költség + ugyanannyi haszon; PONT_FT 2,5 Ft (Max csomag);
   • legalább 1 pont/oldal (a régi fix ár).

   BYOK (2026-11-08, mérés két 15 000 px-es csíkkal): a drága OpenAI-
   modelleket a mi OpenAI-kulcsunkkal futtatjuk (x-byok-openai). Ilyenkor
   a Torii fix 1 kreditet kér, a fordítást az OpenAI számlázza:
     GPT-5.6 Terra: Torii saját 1,21–1,67 Ft, BYOK 0,81–0,97 Ft (~40% olcsóbb).
   Az olcsó modelleknél (GPT-6 Luna) nem éri meg: ugyanannyi, és a kulcs
   nem megy ki. ── */
import { MARKUP, POINT_FT, USD_HUF } from "./llm-pricing.js";

export const TORII_FT_PER_CREDIT = Number(process.env.PC_TORII_FT_PER_CREDIT) || 0.465;
export const MIN_POINTS_PER_PAGE = 1;
export const DEFAULT_TORII_MODEL = "gemini-3.1-flash-lite";

// baseCredits: becslés a felületnek (mérve, átlagos webtoon-csík);
// byok: a mi OpenAI-kulcsunkkal fut, oaPrice: $ / 1M token [bemenet, kimenet]
// (forrásoldalak szerint; a magasabb értékkel számolunk)
export const TORII_MODELS = {
  "gemini-3.1-flash-lite": { label: "Gemini 3.1 Flash Lite (alap, gyors)", baseCredits: 1.1 },
  "gpt-6-luna":            { label: "GPT-6 Luna",                          baseCredits: 1.05 },
  "deepseek-v4-flash":     { label: "DeepSeek V4 Flash",                   baseCredits: 1.05 },
  "grok-4.20":             { label: "Grok 4.20",                           baseCredits: 2 },
  "kimi-k2.5":             { label: "Kimi K2.5",                           baseCredits: 2 },
  "gemini-3-flash":        { label: "Gemini 3 Flash",                      baseCredits: 3 },
  "gemini-3.8-flash":      { label: "Gemini 3.8 Flash",                    baseCredits: 3 },
  "gpt-5.6-terra":         { label: "GPT-5.6 Terra",                       baseCredits: 1, byok: "openai", oaPrice: [2.00, 12.00] },
  "gpt-6.1-sol":           { label: "GPT-6.1 Sol",                         baseCredits: 1, byok: "openai", oaPrice: [2.00, 10.00] },
  "claude-sonnet-5.5":     { label: "Claude Sonnet 5.5",                   baseCredits: 4.5 },
  "claude-opus-5.5":       { label: "Claude Opus 5.5 (legjobb, drága)",    baseCredits: 6 },
};

// a BYOK-os OpenAI-díj a Torii által visszaadott tokenekből (a gondolkodás kimenetnek számít)
export function byokOpenAiFt(model, meta) {
  const spec = TORII_MODELS[model];
  if (!spec?.byok || !meta) return 0;
  const inTok = Number(meta.prompt_tokens) || 0;
  const outTok = (Number(meta.completion_tokens) || 0) + (Number(meta.reasoning_tokens) || 0);
  return (inTok * spec.oaPrice[0] + outTok * spec.oaPrice[1]) / 1e6 * USD_HUF;
}

export const costFtOf = (model, credits, meta) => (Number(credits) || 0) * TORII_FT_PER_CREDIT + byokOpenAiFt(model, meta);
export const ftToPoints = ft => Math.max(MIN_POINTS_PER_PAGE, ft * MARKUP / POINT_FT);
export const creditsToPoints = credits => ftToPoints((Number(credits) || 0) * TORII_FT_PER_CREDIT);

// becslés: átlagos oldal ~1000 bemeneti + ~150 kimeneti token (prompttal, szótárral)
export function estPointsPerPage(model) {
  const spec = TORII_MODELS[model];
  if (!spec) return MIN_POINTS_PER_PAGE;
  const est = spec.byok ? costFtOf(model, 1, { prompt_tokens: 1000, completion_tokens: 150 }) : spec.baseCredits * 1.3 * TORII_FT_PER_CREDIT;
  return ftToPoints(est);
}

export function toriiPriceList() {
  return Object.entries(TORII_MODELS).map(([id, m]) => ({
    id, label: m.label, default: id === DEFAULT_TORII_MODEL,
    est_points_per_page: +estPointsPerPage(id).toFixed(2),
  }));
}
