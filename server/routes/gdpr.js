import express from "express";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

router.get("/export", requireLogin, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const [profile, progress, reads, ratings, favorites, wishlist, wantToRead, orders, points] =
      await Promise.all([
        pool.query(
          `SELECT username, email, created_at, birth_date FROM users WHERE id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT m.title, rp.chapter, rp.page, rp.updated_at
           FROM reading_progress rp JOIN manga m ON m.id = rp.manga_id
           WHERE rp.user_id = $1 ORDER BY rp.updated_at DESC`,
          [userId]
        ),
        pool.query(
          `SELECT m.title, COUNT(*) AS fejezetek_olvasva
           FROM chapter_reads cr
           JOIN manga m ON m.id = cr.manga_id
           WHERE cr.user_id = $1 GROUP BY m.title ORDER BY m.title`,
          [userId]
        ),
        pool.query(
          `SELECT m.title, mr.rating, mr.updated_at
           FROM manga_rating mr JOIN manga m ON m.id = mr.manga_id
           WHERE mr.user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT m.title FROM favorites f JOIN manga m ON m.id = f.manga_id WHERE f.user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT title, created_at FROM wishlist WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId]
        ),
        pool.query(
          `SELECT m.title FROM want_to_read wtr JOIN manga m ON m.id = wtr.manga_id WHERE wtr.user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT package_id, points, amount_huf, created_at FROM shop_orders WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId]
        ),
        pool.query(
          `SELECT points, spent, earned_at FROM user_points WHERE user_id = $1 ORDER BY earned_at DESC LIMIT 200`,
          [userId]
        ),
      ]);

    const data = {
      profil: profile.rows[0],
      olvasasi_elorehaladas: progress.rows,
      fejezetek_szama_mangankent: reads.rows,
      ertekelesek: ratings.rows,
      kedvencek: favorites.rows,
      kivansaglista: wishlist.rows,
      olvasni_kivan: wantToRead.rows,
      rendelesek: orders.rows,
      pontok_tortenete: points.rows,
      exportalva: new Date().toISOString(),
    };

    res
      .setHeader("Content-Disposition", `attachment; filename="padlizsan-adatom.json"`)
      .setHeader("Content-Type", "application/json")
      .send(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("GDPR export hiba:", err);
    res.status(500).json({ error: "Hiba az adatok lekérésekor." });
  }
});

router.delete("/account", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM reading_progress   WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM chapter_reads       WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM notifications       WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM favorites           WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM manga_rating        WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM patreon_status      WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM poll_votes          WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM want_to_read        WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM wishlist_claims     WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM wishlist_likes      WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM wishlist_planned    WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM wishlist            WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_points         WHERE user_id = $1`, [userId]);
    // auth_accounts és bug_fix_votes: ON DELETE CASCADE, automatikusan törlődnek
    // Rendelések anonymizálása (számviteli megőrzési kötelezettség)
    await client.query(`UPDATE shop_orders      SET user_id = NULL WHERE user_id = $1`, [userId]);
    // Közösségi tartalmak szerzőjének törlése
    await client.query(`UPDATE announcements    SET created_by = NULL WHERE created_by = $1`, [userId]);
    await client.query(`UPDATE polls            SET created_by = NULL WHERE created_by = $1`, [userId]);
    await client.query(`UPDATE bug_report_comments SET user_id = NULL WHERE user_id = $1`, [userId]);
    await client.query(`UPDATE bug_reports      SET user_id = NULL WHERE user_id = $1`, [userId]);

    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await client.query("COMMIT");

    req.session.destroy(() => res.json({ success: true }));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("GDPR fiók törlés hiba:", err);
    res.status(500).json({ error: "Hiba történt a fiók törlése során." });
  } finally {
    client.release();
  }
});

export default router;
