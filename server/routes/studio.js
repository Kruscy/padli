/* ── Padlizsan Studio letöltés (2026-11-08) ─────────────────────
   Tesztfázis: csak a STUDIO_TESTERS (.env, vesszővel elválasztott
   felhasználó-azonosítók; alap: 5 = Ascyra) látja és töltheti le.
   A kész ZIP-et a Windowson épített csomagból kézzel kell a
   /opt/padli/studio-dist mappába tenni; mindig a legújabb .zip megy ki.
   A mappa nincs a public/ alatt, így közvetlen URL-lel nem érhető el. ── */
import express from "express";
import fs from "fs";
import path from "path";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();
const DIST_DIR = process.env.STUDIO_DIST_DIR || "/opt/padli/studio-dist";
const testers = () => new Set(String(process.env.STUDIO_TESTERS || "5").split(",").map(s => parseInt(s, 10)).filter(Boolean));

function latestZip() {
  try {
    return fs.readdirSync(DIST_DIR)
      .filter(f => /\.zip$/i.test(f))
      .map(f => ({ name: f, stat: fs.statSync(path.join(DIST_DIR, f)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] || null;
  } catch {
    return null;
  }
}

router.get("/info", requireLogin, (req, res) => {
  if (!testers().has(req.session.user.id)) return res.json({ allowed: false });
  const z = latestZip();
  res.json({
    allowed: true,
    file: z ? { name: z.name, size: z.stat.size, date: z.stat.mtime } : null,
  });
});

router.get("/download", requireLogin, (req, res) => {
  if (!testers().has(req.session.user.id)) return res.status(404).json({ error: "Nem található" });
  const z = latestZip();
  if (!z) return res.status(404).json({ error: "Még nincs feltöltött csomag" });
  console.log(`[STUDIO] letöltés: ${req.session.user.username} → ${z.name}`);
  res.setHeader("Cache-Control", "no-store");
  res.download(path.join(DIST_DIR, z.name), z.name);
});

export default router;
