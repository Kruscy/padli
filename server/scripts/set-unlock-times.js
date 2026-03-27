import { pool } from "../db.js";
import dotenv from "dotenv";
dotenv.config();

const lockHours = parseInt(process.env.LOCK_HOURS || "24", 10);

async function setUnlockTimes() {
  console.log("⏰ Setting unlock times...");

  const mangaRes = await pool.query(`SELECT id, slug FROM manga`);

  for (const manga of mangaRes.rows) {
    const chapters = await pool.query(
      `SELECT id, scanned_at FROM chapter
       WHERE manga_id = $1
       ORDER BY scanned_at ASC`,
      [manga.id]
    );

    if (!chapters.rows.length) continue;

    // Csoportosítás: ha két fejezet scanned_at-je kevesebb mint LOCK_HOURS különbség
    // akkor ugyanabban a "batch"-ben vannak
    const batches = [];
    let currentBatch = [chapters.rows[0]];

    for (let i = 1; i < chapters.rows.length; i++) {
      const prev = new Date(chapters.rows[i - 1].scanned_at);
      const curr = new Date(chapters.rows[i].scanned_at);
      const diffHours = (curr - prev) / 3600000;

      if (diffHours < lockHours) {
        // ugyanabba a batch-be kerül
        currentBatch.push(chapters.rows[i]);
      } else {
        batches.push(currentBatch);
        currentBatch = [chapters.rows[i]];
      }
    }
    batches.push(currentBatch);

    // minden batch-ben sorban növekvő unlock idő
    for (const batch of batches) {
      for (let i = 0; i < batch.length; i++) {
        const ch = batch[i];
        const batchStart = new Date(batch[0].scanned_at);
        const unlocksAt = new Date(
          batchStart.getTime() + lockHours * (i + 1) * 3600000
        );
        await pool.query(
          `UPDATE chapter SET unlocks_at = $1 WHERE id = $2`,
          [unlocksAt, ch.id]
        );
      }
    }

    console.log(`✅ ${manga.slug} – ${chapters.rows.length} fejezet, ${batches.length} batch`);
  }

  console.log("✅ Unlock times set!");
}
setUnlockTimes().catch(console.error);
