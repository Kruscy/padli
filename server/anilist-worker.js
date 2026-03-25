import dotenv from "dotenv";
dotenv.config();
import { pool } from "./db.js";
import { syncToAniList } from "./routes/anilist.js";

async function processQueue() {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM anilist_queue
      WHERE processed = false
      ORDER BY created_at ASC
      LIMIT 5
    `);

    for (const job of rows) {
      try {
        await syncToAniList(
          job.user_id,
          job.anilist_id,
          job.progress
        );

        await pool.query(`
          UPDATE anilist_queue
          SET processed = true
          WHERE id = $1
        `, [job.id]);

      } catch (err) {
        console.error("QUEUE JOB ERROR:", err);
      }
    }

  } catch (err) {
    console.error("QUEUE ERROR:", err);
  }
}

// 🔥 1 request / sec
setInterval(processQueue, 2000);

console.log("AniList worker running...");
