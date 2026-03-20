import express from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* ================= ADD ================= */
router.post("/", requireLogin, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url.includes("anilist.co")) {
      return res.status(400).json({ error: "Csak AniList link" });
    }

    const match = url.match(/anime\/(\d+)/) || url.match(/manga\/(\d+)/);
    if (!match) {
      return res.status(400).json({ error: "Hibás link" });
    }

    const anilistId = match[1];
// DUPLIKÁCIÓ CHECK
const exists = await pool.query(`
  SELECT 1 FROM wishlist
  WHERE anilist_id = $1
`, [anilistId]);

if (exists.rowCount) {
  return res.status(400).json({ error: "Ez már benne van a listában" });
}
    /* ===== AniList ===== */
    const query = `
      query ($id: Int) {
        Media(id: $id, type: MANGA) {
          id
          title { english }
          coverImage { large }
          chapters
        }
      }
    `;

    const api = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { id: parseInt(anilistId) }
      })
    });

    const json = await api.json();
    const m = json.data?.Media;

    if (!m) {
      return res.status(400).json({ error: "Nem található" });
    }

    const result = await pool.query(`
      INSERT INTO wishlist (user_id, anilist_id, title, cover_url, episodes)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [
      req.session.user.id,
      m.id,
      m.title.english,
      m.coverImage?.large,
      m.chapters
    ]);

    res.json(result.rows[0]);

  } catch (err) {
    console.error("WISHLIST ADD ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= LIST ================= */
router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;

  const { rows } = await pool.query(`
    SELECT
      w.*,
      u.username,

      COUNT(DISTINCT wl.user_id) AS likes_count,
      COALESCE(BOOL_OR(wl.user_id = $1), false) AS liked_by_me,

      COALESCE(
        JSON_AGG(
          DISTINCT jsonb_build_object(
            'id', cu.id,
            'username', cu.username
          )
        ) FILTER (WHERE cu.id IS NOT NULL),
        '[]'
      ) AS claimed_by

    FROM wishlist w
    JOIN users u ON u.id = w.user_id

    LEFT JOIN wishlist_likes wl ON wl.wishlist_id = w.id
    LEFT JOIN wishlist_claims wc ON wc.wishlist_id = w.id
    LEFT JOIN users cu ON cu.id = wc.user_id

    GROUP BY w.id, u.username
    ORDER BY likes_count DESC, w.created_at DESC
  `, [userId]);
  res.json(rows);
});

/* ================= LIKE TOGGLE ================= */
router.post("/:id/like", requireLogin, async (req, res) => {
  const id = req.params.id;
  const userId = req.session.user.id;

  const exists = await pool.query(`
    SELECT 1 FROM wishlist_likes
    WHERE wishlist_id=$1 AND user_id=$2
  `, [id, userId]);

  if (exists.rowCount) {
    await pool.query(`
      DELETE FROM wishlist_likes
      WHERE wishlist_id=$1 AND user_id=$2
    `, [id, userId]);

    return res.json({ liked: false });
  }

  await pool.query(`
    INSERT INTO wishlist_likes (wishlist_id, user_id)
    VALUES ($1,$2)
  `, [id, userId]);

  res.json({ liked: true });
});
/* ================= CLAIM ================= */
router.post("/:id/claim", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = req.params.id;

  const exists = await pool.query(`
    SELECT 1 FROM wishlist_claims
    WHERE wishlist_id=$1 AND user_id=$2
  `, [id, req.session.user.id]);

  if (exists.rowCount) {
    await pool.query(`
      DELETE FROM wishlist_claims
      WHERE wishlist_id=$1 AND user_id=$2
    `, [id, req.session.user.id]);

    return res.json({ claimed: false });
  }

  await pool.query(`
    INSERT INTO wishlist_claims (wishlist_id,user_id)
    VALUES ($1,$2)
  `, [id, req.session.user.id]);

  res.json({ claimed: true });
});

/* ================= DELETE ================= */
router.delete("/:id", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  await pool.query(`DELETE FROM wishlist WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;
