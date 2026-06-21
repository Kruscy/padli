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
      SELECT id FROM wishlist
      WHERE anilist_id = $1
    `, [anilistId]);

    if (exists.rowCount) {
      const wishId = exists.rows[0].id;
      const userId = req.session.user.id;

      // megnézzük lájkolta-e már
      const liked = await pool.query(`
        SELECT 1 FROM wishlist_likes
        WHERE wishlist_id = $1 AND user_id = $2
      `, [wishId, userId]);

      if (liked.rowCount) {
        // már lájkolta
        return res.json({
          alreadyExists: true,
          alreadyLiked: true,
          message: "Már padlizsánoztad ezt a művet 🍆"
        });
      }

      // még nem lájkolta → auto like
      await pool.query(`
        INSERT INTO wishlist_likes (wishlist_id, user_id)
        VALUES ($1, $2)
      `, [wishId, userId]);

      return res.json({
        alreadyExists: true,
        alreadyLiked: false,
        message: "Már fent volt - kapott egy 🍆 tőled!"
      });
    }

    /* ===== AniList ===== */
    const query = `
      query ($id: Int) {
        Media(id: $id, type: MANGA) {
          id
          title { english romaji native }
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

    const title = m.title.english || m.title.romaji || m.title.native;
    if (!title) return res.status(400).json({ error: "Nem található cím" });

    const result = await pool.query(`
      INSERT INTO wishlist (user_id, anilist_id, title, cover_url, episodes)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [
      req.session.user.id,
      m.id,
      title,
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

      -- Claim (dolgozik rajta)
      COALESCE(
        JSON_AGG(
          DISTINCT jsonb_build_object(
            'id', cu.id,
            'username', cu.username
          )
        ) FILTER (WHERE cu.id IS NOT NULL),
        '[]'
      ) AS claimed_by,
      
      COALESCE(BOOL_OR(wc.user_id = $1), false) AS claimed_by_me,

      -- Planned (tervben van)
      COALESCE(
        JSON_AGG(
          DISTINCT jsonb_build_object(
            'id', pu.id,
            'username', pu.username
          )
        ) FILTER (WHERE pu.id IS NOT NULL),
        '[]'
      ) AS planned_by,
      
      COALESCE(BOOL_OR(wp.user_id = $1), false) AS planned_by_me

    FROM wishlist w
    JOIN users u ON u.id = w.user_id

    LEFT JOIN wishlist_likes wl ON wl.wishlist_id = w.id
    LEFT JOIN wishlist_claims wc ON wc.wishlist_id = w.id
    LEFT JOIN users cu ON cu.id = wc.user_id
    
    LEFT JOIN wishlist_planned wp ON wp.wishlist_id = w.id
    LEFT JOIN users pu ON pu.id = wp.user_id

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

/* ================= CLAIM TOGGLE (Dolgozik rajta) ================= */
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
    INSERT INTO wishlist_claims (wishlist_id, user_id)
    VALUES ($1,$2)
  `, [id, req.session.user.id]);

  res.json({ claimed: true });
});

/* ================= PLAN TOGGLE (Tervben van) ================= */
router.post("/:id/plan", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = req.params.id;

  const exists = await pool.query(`
    SELECT 1 FROM wishlist_planned
    WHERE wishlist_id=$1 AND user_id=$2
  `, [id, req.session.user.id]);

  if (exists.rowCount) {
    await pool.query(`
      DELETE FROM wishlist_planned
      WHERE wishlist_id=$1 AND user_id=$2
    `, [id, req.session.user.id]);

    return res.json({ planned: false });
  }

  await pool.query(`
    INSERT INTO wishlist_planned (wishlist_id, user_id)
    VALUES ($1,$2)
  `, [id, req.session.user.id]);

  res.json({ planned: true });
});

/* ================= DELETE ================= */
router.delete("/:id", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  await pool.query(`DELETE FROM wishlist WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});
/* ================= FOR POLLS - UNCLAIMED RANDOM ================= */
router.get("/for-polls/unclaimed", requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const { limit = 10 } = req.query;

    const { rows } = await pool.query(`
      SELECT w.id, w.title, w.cover_url
      FROM wishlist w
      WHERE NOT EXISTS (
        SELECT 1 FROM wishlist_claims wc 
        WHERE wc.wishlist_id = w.id
      )
      ORDER BY RANDOM()
      LIMIT $1
    `, [parseInt(limit)]);

    res.json(rows);

  } catch (err) {
    console.error("FOR POLLS UNCLAIMED ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= FOR POLLS - ADMIN'S PLANNED ================= */
router.get("/for-polls/my-planned", requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const userId = req.session.user.id;
    const { limit = 10 } = req.query;

    const { rows } = await pool.query(`
      SELECT w.id, w.title, w.cover_url
      FROM wishlist w
      INNER JOIN wishlist_planned wp ON wp.wishlist_id = w.id
      WHERE wp.user_id = $1
      ORDER BY RANDOM()
      LIMIT $2
    `, [userId, parseInt(limit)]);

    res.json(rows);

  } catch (err) {
    console.error("FOR POLLS MY PLANNED ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
