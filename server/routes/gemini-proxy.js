// server/routes/gemini-proxy.js
// Belső hálózati proxy a manga-image-translator (192.168.0.90) szolgáltatásnak,
// hogy az is a mi Gemini kulcs-rotációnkat használja OpenAI-kompatibilis
// chat/completions formátumon keresztül. Szabványos "Authorization: Bearer"
// fejléccel védett (ez a CUSTOM_OPENAI_API_KEY-ként megy át bármelyik
// OpenAI-kompatibilis kliensen) — nélküle bárki a mi kvótánkat égethetné.
import express from "express";
import crypto from "crypto";
import { callGeminiOpenAiChat } from "../lib/gemini-client.js";

const router = express.Router();

// 2026-07-24-i incidens: a PadliCrome (manga-image-translator, 192.168.0.90)
// néha egyszerre sok oldalt küld fordításra, ami egy pillanat alatt annyi
// párhuzamos kérést indít, hogy a teljes kulcs-pool (11 kulcs × 15 RPM) egy
// szempillantás alatt kimerül, és minden kulcs 429-et ad ugyanabban a
// másodpercben. Innentől max ennyi kérést engedünk egyszerre a Gemini felé
// erről a proxyról — a többi a sorban vár, ez szétteríti a terhelést
// ahelyett, hogy egyszerre robbanna rá a teljes kulcs-poolra.
const MAX_CONCURRENT = 8;
let activeCount = 0;
const waitQueue = [];

function acquireSlot() {
  return new Promise(resolve => {
    if (activeCount < MAX_CONCURRENT) {
      activeCount++;
      resolve();
    } else {
      waitQueue.push(resolve);
    }
  });
}

function releaseSlot() {
  activeCount--;
  const next = waitQueue.shift();
  if (next) {
    activeCount++;
    next();
  }
}

function isAuthorized(req) {
  const auth = req.headers["authorization"] || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = process.env.GEMINI_PROXY_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Diagnosztikai célú, minimális kérés-napló — nem tárol tartalmat, csak
// annyit, hogy honnan, milyen modellel és hány/milyen típusú üzenettel
// jött a kérés, hogy kvóta-problémánál ne kelljen találgatni.
function summarizeRequest(req) {
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const hasImage = messages.some(m =>
    Array.isArray(m.content) && m.content.some(c => c?.type === "image_url")
  );
  return {
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    model: body.model || "(nincs megadva)",
    messageCount: messages.length,
    hasImage,
  };
}

router.post("/v1/chat/completions", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const info = summarizeRequest(req);
  const startedAt = new Date().toISOString();

  await acquireSlot();
  try {
    const data = await callGeminiOpenAiChat(req.body, 60000, "gemini-proxy");
    console.log(`[gemini-proxy] ${startedAt} OK ip=${info.ip} model=${info.model} messages=${info.messageCount} hasImage=${info.hasImage} active=${activeCount} queued=${waitQueue.length}`);
    res.json(data);
  } catch (err) {
    if (err.isQuotaExhausted) {
      console.warn(`[gemini-proxy] ${startedAt} QUOTA_EXCEEDED ip=${info.ip} model=${info.model} messages=${info.messageCount} hasImage=${info.hasImage} active=${activeCount} queued=${waitQueue.length}`);
      return res.status(429).json({ error: "quota_exceeded", message: err.message });
    }
    console.error(`[gemini-proxy] ${startedAt} UPSTREAM_ERROR ip=${info.ip} model=${info.model} messages=${info.messageCount} hasImage=${info.hasImage} hiba: ${err.message}`);
    res.status(502).json({ error: "upstream_error", message: err.message });
  } finally {
    releaseSlot();
  }
});

export default router;
