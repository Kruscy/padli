/* ── Oldal beállításai + verzió (admin) ────────────────────────
   GET  /api/admin/site          — beállítások, verzió, frissítés
   PUT  /api/admin/site          — név, cím, Patreon (csak a tulajdonos)
   PUT  /api/admin/site/owner    — tulajdonos átadása másik adminnak ── */
import express from "express";
import { pool } from "../db.js";
import { getSite, isOwner, saveSiteSettings } from "../lib/site-config.js";
import { checkForUpdate } from "../lib/update-check.js";
import { logSecurityEvent } from "../lib/security-log.js";

const router = express.Router();

router.use((req, res, next) => {
  if (req.session.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
});
const requireOwner = (req, res, next) =>
  isOwner(req.session.user.id) ? next() : res.status(403).json({ error: "Csak az oldal tulajdonosa módosíthatja." });

router.get("/", async (req, res) => {
  const { name, url, patreonUrl, description, ownerUserId } = getSite();
  res.json({
    site: { name, url, patreonUrl, description, ownerUserId },
    canEdit: isOwner(req.session.user.id),
    version: await checkForUpdate(),
  });
});

const httpUrl = (u) => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x : null; } catch { return null; } };

router.put("/", requireOwner, async (req, res) => {
  const { name, url, patreonUrl, description } = req.body || {};
  const values = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 60) return res.status(400).json({ error: "Az oldal neve 1–60 karakter legyen." });
    values.name = name.trim();
  }
  if (url !== undefined) {
    const u = httpUrl(url);
    if (!u) return res.status(400).json({ error: "Az oldal címe érvényes http(s) cím legyen." });
    values.url = u.origin;
  }
  if (patreonUrl !== undefined) {
    if (patreonUrl && !httpUrl(patreonUrl)) return res.status(400).json({ error: "A Patreon-link érvénytelen." });
    values.patreonUrl = patreonUrl ? String(patreonUrl).trim() : "";
  }
  if (description !== undefined) {
    if (typeof description !== "string" || description.length > 300) return res.status(400).json({ error: "A leírás legfeljebb 300 karakter." });
    values.description = description.trim();
  }
  const site = await saveSiteSettings(values);
  logSecurityEvent({ req, type: "site_settings_changed", severity: "warn", userId: req.session.user.id,
                     username: req.session.user.username, details: { keys: Object.keys(values) } });
  res.json({ ok: true, site: { name: site.name, url: site.url, patreonUrl: site.patreonUrl, description: site.description } });
});

router.put("/owner", requireOwner, async (req, res) => {
  const userId = Number(req.body?.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "Hibás felhasználó." });
  const { rows } = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'admin'`, [userId]);
  if (!rows.length) return res.status(400).json({ error: "Csak admin lehet tulajdonos." });
  await saveSiteSettings({ ownerUserId: userId });
  logSecurityEvent({ req, type: "site_owner_changed", severity: "high", userId: req.session.user.id,
                     username: req.session.user.username, details: { newOwner: userId } });
  res.json({ ok: true, ownerUserId: userId });
});

export default router;
