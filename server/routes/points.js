// server/routes/points.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/* ── MIDDLEWARE ──────────────────────────────────────────── */
function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Bejelentkezés szükséges" });
  next();
}

/* ── GET /api/points/balance – pont egyenleg és log ───────── */
router.get("/balance", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    // Összpontszám lekérése
    const { rows: balanceRows } = await pool.query(`
      SELECT COALESCE(SUM(points), 0) as total_points
      FROM user_points
      WHERE user_id = $1 AND NOT spent
    `, [userId]);

    const totalPoints = parseInt(balanceRows[0].total_points);

    // Pont log lekérése (elfogadott javítások)
    const { rows: logRows } = await pool.query(`
      SELECT 
        up.id,
        up.points,
        up.earned_at,
        up.spent,
        bf.manga_slug,
        bf.chapter,
        bf.image_index,
        bf.image_file,
        u_admin.username as approved_by_name
      FROM user_points up
      JOIN bug_fixes bf ON bf.id = up.fix_id
      LEFT JOIN users u_admin ON u_admin.id = up.approved_by
      WHERE up.user_id = $1
      ORDER BY up.earned_at DESC
    `, [userId]);

    // Elköltött pontok összege
    const { rows: spentRows } = await pool.query(`
      SELECT COALESCE(SUM(points), 0) as spent_points
      FROM user_points
      WHERE user_id = $1 AND spent = true
    `, [userId]);

    const spentPoints = parseInt(spentRows[0].spent_points);

    res.json({
      total_points: totalPoints,
      spent_points: spentPoints,
      available_points: totalPoints,
      log: logRows
    });
  } catch (err) {
    console.error("Points balance error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/points/my-gifts – saját gift kódok ──────────── */
router.get("/my-gifts", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const { rows } = await pool.query(`
      SELECT 
        id,
        gift_code,
        patreon_link,
        duration_months,
        purchased_at,
        cost_points,
        status
      FROM patreon_gifts
      WHERE purchased_by = $1
      ORDER BY purchased_at DESC
    `, [userId]);

    res.json(rows);
  } catch (err) {
    console.error("My gifts error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/points/purchase-gift – előfizetés vásárlás ──── */
router.post("/purchase-gift", requireLogin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const userId = req.session.user.id;
    const costPoints = 100; // Fix ár

    // 1. Ellenőrzés: van-e elég pont?
    const { rows: balanceRows } = await client.query(`
      SELECT COALESCE(SUM(points), 0) as total_points
      FROM user_points
      WHERE user_id = $1 AND NOT spent
    `, [userId]);

    const availablePoints = parseInt(balanceRows[0].total_points);

    if (availablePoints < costPoints) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Nincs elég pontod! Szükséges: ${costPoints}, Jelenlegi: ${availablePoints}` 
      });
    }

    // 2. Van-e elérhető gift kód?
    const { rows: giftRows } = await client.query(`
      SELECT id, gift_code, patreon_link, duration_months
      FROM patreon_gifts
      WHERE status = 'available'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
    `);

    if (!giftRows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: "Jelenleg nincs elérhető gift kód. Kérlek próbáld később!" 
      });
    }

    const gift = giftRows[0];

    // 3. Pontok megjelölése elköltöttként (FIFO - legrégebbi pontok először)
    // Addig jelölünk meg sorokat, amíg összesen costPoints-nyi pontot el nem érünk
    let remainingCost = costPoints;
    
    const { rows: pointRows } = await client.query(`
      SELECT id, points, spent FROM user_points
      WHERE user_id = $1 AND spent = false
      ORDER BY earned_at ASC
    `, [userId]);

    const idsToSpend = [];
    for (const row of pointRows) {
      if (remainingCost <= 0) break;
      
      idsToSpend.push(row.id);
      remainingCost -= row.points;
    }

    if (idsToSpend.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Hiba a pontok levonásakor.` 
      });
    }

    await client.query(`
      UPDATE user_points
      SET spent = true
      WHERE id = ANY($1)
    `, [idsToSpend]);

    // 4. Gift kód hozzárendelése a userhez
    await client.query(`
      UPDATE patreon_gifts
      SET 
        purchased_by = $1,
        purchased_at = NOW(),
        cost_points = $2,
        status = 'purchased'
      WHERE id = $3
    `, [userId, costPoints, gift.id]);

    await client.query('COMMIT');

    // Ellenőrzés: ha ≤1 elérhető gift maradt → értesítés az összes adminnak
    try {
      const { rows: remRows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM patreon_gifts WHERE status = 'available'`
      );
      const remaining = parseInt(remRows[0].cnt);
      if (remaining <= 1) {
        const { rows: admins } = await pool.query(
          `SELECT id FROM users WHERE role = 'admin'`
        );
        const msg = remaining === 0
          ? '⚠️ Elfogytak a Patreon Gift kódok! Azonnal fel kell tölteni.'
          : '⚠️ Csak 1 Patreon Gift kód maradt! Hamarosan fel kell tölteni.';
        for (const admin of admins) {
          await pool.query(
            `INSERT INTO notifications (user_id, type, message, link)
             VALUES ($1, 'gift_low', $2, '/admin.html')`,
            [admin.id, msg]
          );
        }
      }
    } catch (notifErr) {
      console.warn('[gift] értesítés hiba:', notifErr.message);
    }

    res.json({
      success: true,
      gift: {
        id: gift.id,
        gift_code: gift.gift_code,
        patreon_link: gift.patreon_link,
        duration_months: gift.duration_months,
        cost_points: costPoints
      },
      message: `Sikeres vásárlás! ${costPoints} pont levonva.`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Gift purchase error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ── GET /api/points/leaderboard – top javítók ────────────── */
router.get("/leaderboard", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.avatar,
        COUNT(DISTINCT bf.id) as fixes_count,
        COALESCE(SUM(up.points), 0) as total_points_earned,
        MAX(bf.fixed_at) as last_fix_date
      FROM users u
      JOIN bug_fixes bf ON bf.fixed_by = u.id
      LEFT JOIN user_points up ON up.fix_id = bf.id
      WHERE bf.is_applied = true
      GROUP BY u.id, u.username, u.avatar
      ORDER BY fixes_count DESC, total_points_earned DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
