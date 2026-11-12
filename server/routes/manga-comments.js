/* ── Hozzászólások a manga-adatlapon (2026-11-12) ─────────────
   GET    /api/manga/:slug/comments?before=<id>   – lista (30-asával, legújabb elöl)
   POST   /api/manga/:slug/comments               – új hozzászólás (megerősített e-mail kell)
   PATCH  /api/manga-comments/:id                 – saját szerkesztése
   DELETE /api/manga-comments/:id                 – saját, vagy admin bármelyiket (soft delete)
   A szöveg nyers szövegként tárolódik, a kliens escape-eli. ── */
import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { logAdminAction } from "../lib/admin-log.js";

const router = express.Router();
const MAX_LEN = 2000;
const PAGE = 30;

// Duplikált slug esetén ugyanazt a bejegyzést, mint az adatlap (több fejezetes)
async function mangaIdBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT m.id, m.title FROM manga m LEFT JOIN chapter c ON c.manga_id = m.id
      WHERE m.slug = $1 GROUP BY m.id ORDER BY count(c.id) DESC, m.id ASC LIMIT 1`, [slug]);
  return rows[0] || null;
}

const isAdmin = req => req.session.user?.role === "admin";

// Áradás elleni védelem: 15 mp két hozzászólás között, óránként max 20
const recent = new Map(); // userId → [időbélyegek]
function rateCheck(userId) {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter(t => now - t < 3600_000);
  if (list.length && now - list[list.length - 1] < 15_000) return "Várj pár másodpercet a következő hozzászólás előtt.";
  if (list.length >= 20) return "Óránként legfeljebb 20 hozzászólást írhatsz.";
  list.push(now); recent.set(userId, list);
  return null;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of recent) if (!v.some(t => now - t < 3600_000)) recent.delete(k);
}, 600_000).unref();

function cleanBody(body) {
  if (typeof body !== "string") return null;
  const t = body.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!t || t.length > MAX_LEN) return null;
  return t;
}

async function canPost(userId) {
  const { rows } = await pool.query("SELECT email_verified FROM users WHERE id = $1", [userId]);
  if (!rows.length) return { ok: false, reason: "Nem vagy bejelentkezve." };
  if (!rows[0].email_verified) return { ok: false, reason: "Hozzászóláshoz erősítsd meg az e-mail-címedet." };
  return { ok: true };
}

const shape = (r, req) => ({
  id: Number(r.id), body: r.body, spoiler: r.spoiler,
  created_at: r.created_at, edited_at: r.edited_at,
  user: r.user_id ? { username: r.username, avatar: r.avatar || null, role: r.role } : null,
  mine: !!r.user_id && r.user_id === req.session.user.id,
  canDelete: (!!r.user_id && r.user_id === req.session.user.id) || isAdmin(req),
});

router.get("/manga/:slug/comments", requireLogin, async (req, res) => {
  try {
    const manga = await mangaIdBySlug(req.params.slug);
    if (!manga) return res.status(404).json({ error: "Nincs ilyen mű" });
    const before = parseInt(req.query.before, 10);
    const params = [manga.id];
    let cond = "";
    if (Number.isInteger(before)) { params.push(before); cond = "AND c.id < $2"; }
    const [list, total, perm] = await Promise.all([
      pool.query(
        `SELECT c.id, c.body, c.spoiler, c.created_at, c.edited_at, c.user_id,
                u.username, u.avatar, u.role
           FROM manga_comments c LEFT JOIN users u ON u.id = c.user_id
          WHERE c.manga_id = $1 AND c.deleted_at IS NULL ${cond}
          ORDER BY c.id DESC LIMIT ${PAGE + 1}`, params),
      pool.query("SELECT count(*)::int AS n FROM manga_comments WHERE manga_id = $1 AND deleted_at IS NULL", [manga.id]),
      canPost(req.session.user.id),
    ]);
    const rows = list.rows.slice(0, PAGE);
    res.json({
      comments: rows.map(r => shape(r, req)),
      hasMore: list.rows.length > PAGE,
      total: total.rows[0].n,
      canPost: perm.ok, reason: perm.reason || null,
    });
  } catch (err) {
    console.error("[COMMENTS] list:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.post("/manga/:slug/comments", requireLogin, express.json(), async (req, res) => {
  const user = req.session.user;
  const body = cleanBody(req.body?.body);
  if (!body) return res.status(400).json({ error: `A hozzászólás 1–${MAX_LEN} karakter lehet.` });
  try {
    const perm = await canPost(user.id);
    if (!perm.ok) return res.status(403).json({ error: perm.reason });
    const manga = await mangaIdBySlug(req.params.slug);
    if (!manga) return res.status(404).json({ error: "Nincs ilyen mű" });
    const limited = rateCheck(user.id);
    if (limited) return res.status(429).json({ error: limited });
    const { rows } = await pool.query(
      `INSERT INTO manga_comments (manga_id, user_id, body, spoiler) VALUES ($1, $2, $3, $4)
       RETURNING id, body, spoiler, created_at, edited_at, user_id`,
      [manga.id, user.id, body, !!req.body?.spoiler]);
    const u = (await pool.query("SELECT username, avatar, role FROM users WHERE id = $1", [user.id])).rows[0] || {};
    res.json({ ok: true, comment: shape({ ...rows[0], ...u }, req) });
  } catch (err) {
    console.error("[COMMENTS] post:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.patch("/manga-comments/:id", requireLogin, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = cleanBody(req.body?.body);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Hibás azonosító" });
  if (!body) return res.status(400).json({ error: `A hozzászólás 1–${MAX_LEN} karakter lehet.` });
  try {
    const { rows } = await pool.query(
      `UPDATE manga_comments SET body = $1, spoiler = $2, edited_at = now()
        WHERE id = $3 AND user_id = $4 AND deleted_at IS NULL
        RETURNING id, body, spoiler, edited_at`,
      [body, !!req.body?.spoiler, id, req.session.user.id]);
    if (!rows.length) return res.status(404).json({ error: "Nincs ilyen saját hozzászólás" });
    res.json({ ok: true, comment: { ...rows[0], id: Number(rows[0].id) } });
  } catch (err) {
    console.error("[COMMENTS] edit:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

router.delete("/manga-comments/:id", requireLogin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Hibás azonosító" });
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.user_id, c.body, u.username, m.title
         FROM manga_comments c JOIN manga m ON m.id = c.manga_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]);
    const c = rows[0];
    if (!c) return res.status(404).json({ error: "Nincs ilyen hozzászólás" });
    const own = c.user_id === req.session.user.id;
    if (!own && !isAdmin(req)) return res.status(403).json({ error: "Csak a saját hozzászólásodat törölheted" });
    await pool.query("UPDATE manga_comments SET deleted_at = now(), deleted_by = $2 WHERE id = $1",
      [id, req.session.user.id]);
    if (!own) {
      await logAdminAction(req, { action: "manga_comment_delete", targetType: "manga_comment", targetId: id,
        targetTitle: c.title, details: { author: c.username, body: c.body.slice(0, 500) } });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[COMMENTS] delete:", err.message);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

export default router;
