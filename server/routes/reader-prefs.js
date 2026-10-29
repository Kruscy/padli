/* ── Olvasó-beállítások (felhasználónként, eszközönként) ───────
   GET /api/reader-prefs          → { mobile: {…}|null, desktop: {…}|null }
   PUT /api/reader-prefs/:device  → a mentett (ellenőrzött) beállítás
   Az ellenőrzés ugyanaz, mint a böngészőben (public/js/reader-core.js). ── */
import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { normalizePrefs, DEVICES } from "../../public/js/reader-core.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const { rows } = await pool.query(`SELECT device, prefs FROM reader_prefs WHERE user_id = $1`, [req.session.user.id]);
  const out = Object.fromEntries(DEVICES.map(d => [d, null]));
  for (const r of rows) if (DEVICES.includes(r.device)) out[r.device] = normalizePrefs(r.prefs);
  res.json(out);
});

router.put("/:device", requireLogin, async (req, res) => {
  const { device } = req.params;
  if (!DEVICES.includes(device)) return res.status(400).json({ error: "Ismeretlen eszköztípus" });
  const prefs = normalizePrefs(req.body);
  await pool.query(
    `INSERT INTO reader_prefs (user_id, device, prefs, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, device) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
    [req.session.user.id, device, JSON.stringify(prefs)]
  );
  res.json(prefs);
});

export default router;
