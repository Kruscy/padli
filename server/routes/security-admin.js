import express from "express";
import net from "net";
import { pool } from "../db.js";
import { refreshBlocks, logSecurityEvent } from "../lib/security-log.js";
import { SCAN_OWNER_USER_ID } from "../lib/scan-runner.js";

/* ── Biztonsági napló API (/api/admin/security/*) ──
   Csak Ascyra (ugyanaz a tulajdonosi fiók, mint a kézi scannél). ── */
const router = express.Router();

router.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin" || req.session.user.id !== SCAN_OWNER_USER_ID) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

const clampInt = (v, d, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || d));

router.get("/summary", async (req, res) => {
  const hours = clampInt(req.query.hours, 24, 1, 24 * 90);
  try {
    const since = `now() - (${hours} || ' hours')::interval`;
    const [byType, topIps, countries, alerts, blocks] = await Promise.all([
      pool.query(`SELECT type, severity, COUNT(*)::int n, COALESCE(SUM((details->>'suppressed')::int),0)::int suppressed
                  FROM security_events WHERE created_at > ${since} AND type <> 'alert'
                  GROUP BY type, severity ORDER BY n DESC`),
      pool.query(`SELECT ip, MAX(country) country, COUNT(*)::int n,
                         COUNT(*) FILTER (WHERE severity <> 'info')::int suspicious,
                         array_agg(DISTINCT type) types, MAX(created_at) last_seen,
                         array_remove(array_agg(DISTINCT username), NULL) users
                  FROM security_events WHERE created_at > ${since} AND ip IS NOT NULL AND type NOT IN ('login_success')
                  GROUP BY ip ORDER BY suspicious DESC, n DESC LIMIT 25`),
      pool.query(`SELECT COALESCE(country,'?') country, COUNT(*)::int n FROM security_events
                  WHERE created_at > ${since} AND severity <> 'info' GROUP BY 1 ORDER BY n DESC LIMIT 10`),
      pool.query(`SELECT created_at, details->>'text' AS text FROM security_events
                  WHERE type = 'alert' AND created_at > ${since} ORDER BY created_at DESC LIMIT 30`),
      pool.query(`SELECT ip, reason, created_by, created_at, expires_at FROM ip_blocks
                  WHERE expires_at IS NULL OR expires_at > now() ORDER BY created_at DESC`),
    ]);
    res.json({ hours, byType: byType.rows, topIps: topIps.rows, countries: countries.rows,
               alerts: alerts.rows, blocks: blocks.rows });
  } catch (err) {
    console.error("[security-admin] summary hiba:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.get("/events", async (req, res) => {
  const limit = clampInt(req.query.limit, 100, 1, 500);
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (req.query.type) add("type = ?", String(req.query.type));
  if (req.query.ip) add("ip = ?", String(req.query.ip));
  if (req.query.user) add("username ILIKE ?", `%${String(req.query.user)}%`);
  if (req.query.severity === "suspicious") where.push("severity <> 'info'");
  if (req.query.hideInfo === "1") where.push("type NOT IN ('login_success', 'register', 'password_reset_request')");
  if (req.query.before) add("id < ?", clampInt(req.query.before, 0, 0, Number.MAX_SAFE_INTEGER));
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, type, severity, ip, country, user_id, username, method, path, user_agent, details
       FROM security_events ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY id DESC LIMIT ${limit}`, params);
    res.json({ events: rows });
  } catch (err) {
    console.error("[security-admin] events hiba:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

// Admin-műveleti napló (admin_action_log) — pl. fejezet-feloldások
router.get("/admin-actions", async (req, res) => {
  const limit = clampInt(req.query.limit, 100, 1, 500);
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (req.query.admin) add("admin_username ILIKE ?", `%${String(req.query.admin)}%`);
  if (req.query.target) add("target_title ILIKE ?", `%${String(req.query.target)}%`);
  if (req.query.before) add("id < ?", clampInt(req.query.before, 0, 0, Number.MAX_SAFE_INTEGER));
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, admin_username, action, target_type, target_id, target_title, details
       FROM admin_action_log ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY id DESC LIMIT ${limit}`, params);
    res.json({ actions: rows });
  } catch (err) {
    console.error("[security-admin] admin-actions hiba:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.post("/block", express.json(), async (req, res) => {
  const ip = String(req.body?.ip || "").trim();
  const hours = req.body?.hours ? clampInt(req.body.hours, 24, 1, 24 * 365) : null;
  const reason = String(req.body?.reason || "").slice(0, 300) || null;
  if (!net.isIP(ip)) return res.status(400).json({ error: "Érvénytelen IP-cím" });
  try {
    await pool.query(
      `INSERT INTO ip_blocks (ip, reason, created_by, expires_at)
       VALUES ($1, $2, $3, ${hours ? `now() + ($4 || ' hours')::interval` : "NULL"})
       ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by,
                                      created_at = now(), expires_at = EXCLUDED.expires_at`,
      hours ? [ip, reason, req.session.user.username, hours] : [ip, reason, req.session.user.username]
    );
    await refreshBlocks();
    logSecurityEvent({ req, type: "ip_blocked", severity: "warn", details: { target: ip, hours, reason } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[security-admin] block hiba:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.delete("/block/:ip", async (req, res) => {
  try {
    await pool.query(`DELETE FROM ip_blocks WHERE ip = $1`, [req.params.ip]);
    await refreshBlocks();
    logSecurityEvent({ req, type: "ip_unblocked", details: { target: req.params.ip } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Szerver hiba" });
  }
});

export default router;
