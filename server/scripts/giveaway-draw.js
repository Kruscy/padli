/**
 * Lejárt nyereményjátékok sorsolása: véletlen nyertes a jelentkezők közül,
 * értesítés a nyertesnek (type='patreon_won' — a notification-badge.js ezt
 * már ismeri, új lapon nyitja a linket).
 * Futtatás: node server/scripts/giveaway-draw.js
 */
import "dotenv/config";
import { pool } from "../db.js";

async function run() {
  const { rows: due } = await pool.query(`
    SELECT id, title, prize_link FROM giveaways
    WHERE ends_at <= now() AND winner_user_id IS NULL
  `);

  if (!due.length) {
    console.log("Nincs lejárt, sorsolásra váró nyereményjáték.");
    await pool.end();
    return;
  }

  for (const g of due) {
    const { rows: entries } = await pool.query(
      `SELECT user_id FROM giveaway_entries WHERE giveaway_id = $1`,
      [g.id]
    );

    if (!entries.length) {
      await pool.query(`UPDATE giveaways SET drawn_at = now() WHERE id = $1`, [g.id]);
      console.log(`"${g.title}" — nem volt jelentkező, lezárva nyertes nélkül.`);
      continue;
    }

    const winner = entries[Math.floor(Math.random() * entries.length)];

    await pool.query(
      `UPDATE giveaways SET winner_user_id = $1, drawn_at = now() WHERE id = $2`,
      [winner.user_id, g.id]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link)
       VALUES ($1, 'patreon_won', $2, $3)`,
      [winner.user_id, `🎉 Nyertél! Te lettél a kisorsolt nyertese: "${g.title}"`, g.prize_link]
    );

    console.log(`"${g.title}" — nyertes: user_id=${winner.user_id} (${entries.length} jelentkező közül)`);
  }

  await pool.end();
}

run();
