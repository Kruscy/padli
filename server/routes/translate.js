// server/routes/translate.js
import express from "express";
import { translateToHungarian } from "../lib/translate.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "Nincs szöveg" });

    const translatedText = await translateToHungarian(text);
    if (translatedText === text) {
      return res.status(502).json({ error: "Fordítás sikertelen (DeepL és Gemini is hibázott)" });
    }

    res.json({ translatedText });
  } catch (err) {
    console.error("Translate error:", err.message);
    res.status(500).json({ error: "Fordítási hiba" });
  }
});

export default router;
