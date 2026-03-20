import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

/* =====================================================
   CREATE POLL (ADMIN)
===================================================== */
router.post("/", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const { title, durationDays, options } = req.body;

  if (!title || !options || options.length < 2 || options.length > 10) {
    return res.status(400).json({ error: "Invalid poll data" });
  }

  try {
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + Number(durationDays));

    const pollRes = await pool.query(
      `
      INSERT INTO polls (title, created_by, ends_at)
      VALUES ($1,$2,$3)
      RETURNING id
    `,
      [title, req.session.user.id, endsAt]
    );

    const pollId = pollRes.rows[0].id;

    for (const option of options) {
      await pool.query(
        `
        INSERT INTO poll_options (poll_id, title, image_url)
        VALUES ($1,$2,$3)
      `,
        [pollId, option.title, option.image_url || null]
      );
    }

    res.json({ ok: true, pollId });
  } catch (err) {
    console.error("CREATE POLL ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/* =========================================
   GET ALL ACTIVE POLLS
========================================= */
router.get("/", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM polls
      WHERE active = true
        AND ends_at > now()
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET POLLS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/* =====================================================
   ACTIVE POLLS (⚠ EZ KELL A HEROHOZ)
===================================================== */
router.get("/active", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        p.id,
        p.title,
        p.ends_at,
        EXISTS (
          SELECT 1
          FROM poll_votes v
          WHERE v.poll_id = p.id
          AND v.user_id = $1
        ) AS voted
      FROM polls p
      WHERE p.active = true
        AND p.ends_at > NOW()
      ORDER BY p.created_at DESC
    `,
      [req.session.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET ACTIVE POLLS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   CLOSED POLLS
===================================================== */
router.get("/closed", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.title,
        p.ends_at,
        po.id AS option_id,
        po.title,
        COUNT(v.id)::int AS votes
      FROM polls p
      JOIN poll_options po ON po.poll_id = p.id
      LEFT JOIN poll_votes v ON v.option_id = po.id
      WHERE p.ends_at <= NOW()
      GROUP BY
        p.id,
        p.title,
        p.ends_at,
        po.id,
        po.title
      ORDER BY p.ends_at DESC
    `);

    const polls = {};

    for (const row of rows) {
      if (!polls[row.id]) {
        polls[row.id] = {
          id: row.id,
          title: row.title,
          ends_at: row.ends_at,
          options: []
        };
      }

      polls[row.id].options.push({
        id: row.option_id,
        title: row.title,
        votes: row.votes
      });
    }

    res.json(Object.values(polls));
  } catch (err) {
    console.error("CLOSED POLLS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   SINGLE POLL
===================================================== */
router.get("/:id", requireLogin, async (req, res) => {
  const pollId = Number(req.params.id);

  if (isNaN(pollId))
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pollRes = await pool.query(
      `SELECT * FROM polls WHERE id=$1`,
      [pollId]
    );

    if (!pollRes.rowCount)
      return res.status(404).json({ error: "Not found" });

    const optionsRes = await pool.query(
      `
      SELECT
        po.id,
        po.title,
        po.image_url,
        COUNT(pv.id)::int AS votes
      FROM poll_options po
      LEFT JOIN poll_votes pv ON pv.option_id = po.id
      WHERE po.poll_id=$1
      GROUP BY po.id
      ORDER BY po.id
    `,
      [pollId]
    );

    res.json({
      poll: pollRes.rows[0],
      options: optionsRes.rows
    });
  } catch (err) {
    console.error("GET POLL ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   VOTE
===================================================== */
router.post("/:id/vote", requireLogin, async (req, res) => {
  const pollId = Number(req.params.id);
  const { optionId } = req.body;
  const userId = req.session.user.id;

  try {
    await pool.query(
      `
      INSERT INTO poll_votes (poll_id, option_id, user_id)
      VALUES ($1,$2,$3)
    `,
      [pollId, optionId, userId]
    );

    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Already voted" });
    }

    console.error("VOTE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   CLOSE POLL (ADMIN)
===================================================== */
router.post("/:id/close", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  await pool.query(
    `
    UPDATE polls
    SET active=false
    WHERE id=$1
  `,
    [req.params.id]
  );

  res.json({ ok: true });
});

export default router;
