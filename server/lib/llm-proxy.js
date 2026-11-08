/* ── OpenAI-kompatibilis szövegfordító a Padlizsan Studio helyi motorjához ──
   POST /api/pc/v1/llm/v1/chat/completions, GET /api/pc/v1/llm/v1/models
   (2026-11-08). A helyi motor (XianScan) a felhasználó gépén dolgozza fel
   a képet, és szabványos Chat Completions kérést küld; mi a saját
   OpenAI-kulcsunkkal továbbítjuk, és a valós tokenhasználat alapján
   pontot vonunk (lib/llm-pricing.js: költség × 2).
   Csak az engedélyezett modellek, és csak a szükséges mezők mennek tovább.
   stream:true esetén a teljes választ egyetlen SSE-darabban küldjük vissza
   (a szabványos kliensek így is feldolgozzák). ── */
import { pool } from "../db.js";
import { LLM_MODELS, DEFAULT_LLM_MODEL, usageCostUsd, usdToPoints, modelPriceList } from "./llm-pricing.js";
import { availablePoints, chargeMilli } from "./llm-meter.js";

const MAX_COMPLETION_TOKENS = 16384;
const PRECHECK_OUT_TOKENS = 2000;     // a hívás előtti egyenleg-ellenőrzéshez feltételezett kimenet
const CALL_TIMEOUT_MS = 180000;
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high"]);

const oaiError = (res, status, message, code) =>
  res.status(status).json({ error: { message, type: code || "invalid_request_error", code: code || null } });

export function listModels(req, res) {
  res.json({
    object: "list",
    data: modelPriceList().map(m => ({ id: m.id, object: "model", owned_by: "padlizsanfansub", ...m })),
  });
}

export async function chatCompletions(req, res) {
  const user = req.authUser;
  const b = req.body || {};
  const model = b.model;
  if (!LLM_MODELS[model]) {
    return oaiError(res, 400,
      `Ismeretlen vagy nem engedélyezett modell: „${model}”. Választható: ${Object.keys(LLM_MODELS).join(", ")} (ajánlott: ${DEFAULT_LLM_MODEL}).`,
      "model_not_found");
  }
  if (!Array.isArray(b.messages) || !b.messages.length) return oaiError(res, 400, "A „messages” kötelező.");

  const maxOut = Math.min(Math.max(parseInt(b.max_completion_tokens ?? b.max_tokens, 10) || 4096, 1), MAX_COMPLETION_TOKENS);
  const body = { model, messages: b.messages, max_completion_tokens: maxOut };
  const spec = LLM_MODELS[model];
  if (spec.reasoning) {
    // reasoning_effort: az "auto" és az ismeretlen értékek helyett a legolcsóbb
    body.reasoning_effort = EFFORTS.has(b.reasoning_effort) ? b.reasoning_effort : "none";
  } else {
    if (typeof b.temperature === "number") body.temperature = b.temperature;
    if (typeof b.top_p === "number") body.top_p = b.top_p;
  }
  if (b.response_format && typeof b.response_format === "object") body.response_format = b.response_format;
  if (Array.isArray(b.stop) || typeof b.stop === "string") body.stop = b.stop;

  // Előzetes ellenőrzés: a hívás becsült legrosszabb ára is fedezve legyen
  const approxIn = Math.ceil(JSON.stringify(b.messages).length / 3);
  const estPoints = usdToPoints(usageCostUsd(model, { prompt_tokens: approxIn, completion_tokens: Math.min(maxOut, PRECHECK_OUT_TOKENS) }));
  const acc = await availablePoints(user.id);
  if (acc.available < Math.max(estPoints, 0.01)) {
    return oaiError(res, 402,
      `Nincs elég pont (elérhető: ${acc.available.toFixed(2)}, ehhez a kéréshez kb. ${estPoints.toFixed(2)} kell).`,
      "insufficient_points");
  }

  const log = (ok, usage, costUsd, milli, error) => pool.query(
    `INSERT INTO pc_llm_usage (user_id, api_key_id, model, prompt_tokens, cached_tokens, completion_tokens, cost_usd, points_milli, ok, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [user.id, user.keyId || null, model, usage?.prompt_tokens || 0, usage?.prompt_tokens_details?.cached_tokens || 0,
     usage?.completion_tokens || 0, costUsd || 0, milli || 0, ok, error ? String(error).slice(0, 500) : null]
  ).catch(e => console.error("[LLM-PROXY] napló:", e.message));

  let j;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // A hibás kérésért is fizetünk, ha az OpenAI számolt tokent — ilyenkor nincs usage, nem vonunk
      log(false, null, 0, 0, `OpenAI ${r.status}: ${j.error?.message || ""}`);
      const status = r.status === 400 ? 400 : r.status === 429 ? 503 : 502;
      return oaiError(res, status, `A fordítószolgáltatás hibát adott (${r.status}): ${j.error?.message || "ismeretlen"}`.slice(0, 400), "upstream_error");
    }
  } catch (err) {
    log(false, null, 0, 0, err.message);
    return oaiError(res, 504, "A fordítószolgáltatás nem válaszolt időben. Próbáld újra.", "upstream_timeout");
  }

  const costUsd = usageCostUsd(model, j.usage);
  const milli = Math.ceil(usdToPoints(costUsd) * 1000);
  let after;
  try {
    after = await chargeMilli(user.id, milli);
  } catch (err) {
    console.error("[LLM-PROXY] elszámolás:", err.message);
  }
  log(true, j.usage, costUsd, milli);

  const used = (milli / 1000).toFixed(3);
  const left = after ? after.available.toFixed(3) : "";
  res.setHeader("X-Points-Used", used);
  if (after) res.setHeader("X-Points-Remaining", left);
  res.setHeader("Access-Control-Expose-Headers", "X-Points-Remaining, X-Points-Used");

  const out = {
    id: j.id, object: "chat.completion", created: j.created, model: j.model,
    choices: j.choices, usage: j.usage,
    padlizsan: { points_used: Number(used), points_remaining: after ? Number(left) : null },
  };

  if (b.stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    const choice = j.choices?.[0] || {};
    const chunk = {
      id: j.id, object: "chat.completion.chunk", created: j.created, model: j.model,
      choices: [{ index: 0, delta: { role: "assistant", content: choice.message?.content ?? "" }, finish_reason: choice.finish_reason || "stop" }],
      usage: j.usage, padlizsan: out.padlizsan,
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  res.json(out);
}
