/* ── Torii-modellek árazása pontban (2026-11-08) ────────────────
   A Padlizsan Studio felhős (Torii) módjában a felhasználó választhat
   modellt. A Torii minden válaszban megadja a valós fogyasztást
   (metadata.credits_used); ebből számolunk:

     pont = max(1, kredit × KREDIT_FT × FELÁR / PONT_FT)

   • KREDIT_FT: 27 883 Ft / 60 000 kredit = 0,465 Ft (a user vásárlása);
   • FELÁR 2,0 = költség + ugyanannyi haszon; PONT_FT 2,5 Ft (Max csomag);
   • legalább 1 pont/oldal: ez a régi fix ár, az olcsó modelleknél ennél
     jóval nagyobb a haszon (1,06 kredit ≈ 0,49 Ft költség → 2,5 Ft).
   A BYOK-ot (saját OpenAI-kulcs a Toriinak) szándékosan nem használjuk:
   mérve a Torii saját modelljei olcsóbbak (GPT-6 Luna: 1,029 kredit,
   BYOK-kal 1 kredit + a mi OpenAI-költségünk). ── */
import { MARKUP, POINT_FT } from "./llm-pricing.js";

export const TORII_FT_PER_CREDIT = Number(process.env.PC_TORII_FT_PER_CREDIT) || 0.465;
export const MIN_POINTS_PER_PAGE = 1;
export const DEFAULT_TORII_MODEL = "gemini-3.1-flash-lite";

// A Torii saját modelljei (toriitranslate.com/api); baseCredits: a régi
// Python-app „N+ kredit” címkéje — csak becslés a felületnek, a valós
// fogyasztást a válasz adja.
export const TORII_MODELS = {
  "gemini-3.1-flash-lite": { label: "Gemini 3.1 Flash Lite (alap, gyors)", baseCredits: 1 },
  "gpt-6-luna":            { label: "GPT-6 Luna",                          baseCredits: 1 },
  "deepseek-v4-flash":     { label: "DeepSeek V4 Flash",                   baseCredits: 1 },
  "grok-4.20":             { label: "Grok 4.20",                           baseCredits: 2 },
  "kimi-k2.5":             { label: "Kimi K2.5",                           baseCredits: 2 },
  "gemini-3-flash":        { label: "Gemini 3 Flash",                      baseCredits: 3 },
  "gemini-3.8-flash":      { label: "Gemini 3.8 Flash",                    baseCredits: 3 },
  "claude-sonnet-5.5":     { label: "Claude Sonnet 5.5",                   baseCredits: 4 },
  "gpt-6.1-sol":           { label: "GPT-6.1 Sol",                         baseCredits: 4 },
  "claude-opus-5.5":       { label: "Claude Opus 5.5 (legjobb, drága)",    baseCredits: 5 },
};

export const creditsToPoints = credits =>
  Math.max(MIN_POINTS_PER_PAGE, (Number(credits) || 0) * TORII_FT_PER_CREDIT * MARKUP / POINT_FT);

export function toriiPriceList() {
  return Object.entries(TORII_MODELS).map(([id, m]) => ({
    id, label: m.label, default: id === DEFAULT_TORII_MODEL,
    // a „+” miatt (hosszabb szöveg többe kerül) 1,4-szeres ráhagyással becsülünk
    est_points_per_page: +creditsToPoints(m.baseCredits * 1.4).toFixed(2),
  }));
}
