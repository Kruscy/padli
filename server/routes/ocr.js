// server/routes/ocr.js – MangaOCR szerver alapú
import express from "express";
import fetch   from "node-fetch";
import { pool } from "../db.js";

const router   = express.Router();
const OCR_URL  = process.env.OCR_URL || "http://192.168.0.90:8001";

function logUsage(success, statusCode, durationMs, errorMessage) {
  pool.query(
    `INSERT INTO remote_service_usage (service, success, status_code, duration_ms, error_message) VALUES ('ocr',$1,$2,$3,$4)`,
    [success, statusCode, durationMs, errorMessage]
  ).catch(err => console.error("remote_service_usage log hiba:", err.message));
}

router.post("/", async (req, res) => {
  const startedAt = Date.now();
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64)
      return res.status(400).json({ error: "imageBase64 szükséges" });

    const ocrRes = await fetch(`${OCR_URL}/ocr`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ imageBase64 }),
      signal:  AbortSignal.timeout(30000)
    });

    if (!ocrRes.ok) {
      const err = await ocrRes.text().catch(() => "?");
      logUsage(false, ocrRes.status, Date.now() - startedAt, err.slice(0, 300));
      return res.status(500).json({ error: "OCR hiba: " + err.slice(0, 200) });
    }

    const data = await ocrRes.json();
    logUsage(true, ocrRes.status, Date.now() - startedAt, null);
    return res.json({ text: data.text });

  } catch (e) {
    console.error("[ocr]", e);
    logUsage(false, null, Date.now() - startedAt, e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
