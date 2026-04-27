// server/routes/ocr.js – MangaOCR szerver alapú
import express from "express";
import fetch   from "node-fetch";

const router   = express.Router();
const OCR_URL  = process.env.OCR_URL || "http://192.168.0.90:8001";

router.post("/", async (req, res) => {
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
      return res.status(500).json({ error: "OCR hiba: " + err.slice(0, 200) });
    }

    const data = await ocrRes.json();
    return res.json({ text: data.text });

  } catch (e) {
    console.error("[ocr]", e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
