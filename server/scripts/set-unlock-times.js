import { pool } from "../db.js";
import dotenv from "dotenv";
dotenv.config();

const lockHours = parseInt(process.env.LOCK_HOURS || "24", 10);
async function setUnlockTimes() {
  console.log("⏰ Setting unlock times...");

  const mangaRes = await pool.query(`SELECT id, slug FROM manga`);

  for (const manga of mangaRes.rows) {
    // összes fejezet scanned_at szerint sorban
    const chapters = await pool.query(
      `SELECT id, scanned_at FROM chapter
       WHERE manga_id = $1
       ORDER BY scanned_at ASC`,
      [manga.id]
    );

    if (!chapters.rows.length) continue;

    // csak azok amiknek nincs még unlocks_at-je
    const unsetChapters = chapters.rows.filter(ch => !ch.unlocks_at);
    if (!unsetChapters.length) continue;

    // friss vs régi szétválasztás
    const freshChapters = unsetChapters.filter(ch =>
      (Date.now() - new Date(ch.scanned_at)) / 3600000 < lockHours
    );
    const oldChapters = unsetChapters.filter(ch =>
      (Date.now() - new Date(ch.scanned_at)) / 3600000 >= lockHours
    );

    // régi fejezetek: azonnal szabad (unlocks_at = scanned_at)
    if (oldChapters.length) {
      const oldIds = oldChapters.map(ch => ch.id).join(",");
      await pool.query(
        `UPDATE chapter SET unlocks_at = scanned_at WHERE id IN (${oldIds})`
      );
    }

    // friss fejezetek: sorban zárolás
    if (freshChapters.length) {
      const lastSet = await pool.query(
        `SELECT unlocks_at FROM chapter
         WHERE manga_id = $1
           AND unlocks_at IS NOT NULL
           AND unlocks_at > now()
         ORDER BY unlocks_at DESC
         LIMIT 1`,
        [manga.id]
      );

      let lastUnlocksAt = lastSet.rows.length
        ? new Date(lastSet.rows[0].unlocks_at)
        : null;

      const updates = [];

      for (const ch of freshChapters) {
        let unlocksAt;
        if (!lastUnlocksAt || lastUnlocksAt < new Date()) {
          unlocksAt = new Date(Date.now() + lockHours * 3600000);
        } else {
          unlocksAt = new Date(lastUnlocksAt.getTime() + lockHours * 3600000);
        }
        lastUnlocksAt = unlocksAt;
        updates.push(`(${ch.id}, '${unlocksAt.toISOString()}')`);
      }

      if (updates.length) {
        await pool.query(`
          UPDATE chapter AS c
          SET unlocks_at = v.unlocks_at::timestamptz
          FROM (VALUES ${updates.join(",")}) AS v(id, unlocks_at)
          WHERE c.id = v.id::int
        `);
      }
    }

    console.log(`✅ ${manga.slug} – ${oldChapters.length} régi szabad, ${freshChapters.length} friss zárolt`);
  }

  console.log("✅ Unlock times set!");
}

setUnlockTimes().catch(console.error);
