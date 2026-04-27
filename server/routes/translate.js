// server/routes/translate.js
import express from "express";
import fetch   from "node-fetch";

const router = express.Router();

const LIBRE_URL = process.env.LIBRETRANSLATE_URL || "http://192.168.0.90:5000";

router.post("/", async (req, res) => {
  try {
    const { text, source = "en", target = "hu" } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "Nincs szöveg" });

    const response = await fetch(`${LIBRE_URL}/translate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ q: text, source, target, format: "text" }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error || "Fordítási hiba" });
    }

    res.json({ translatedText: data.translatedText });
  } catch (err) {
    console.error("Translate error:", err.message);
    res.status(500).json({ error: "LibreTranslate nem elérhető" });
  }
});

export default router;
