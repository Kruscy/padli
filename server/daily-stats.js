// server/daily-stats.js
// Reggel 6-kor futtatandó: node server/daily-stats.js
// Crontab: 0 6 * * * cd /opt/padli && node server/daily-stats.js

import { pool } from "./db.js";
import dotenv from "dotenv";
dotenv.config();

async function buildDailyStats() {
  // Tegnapi dátum
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const statDate = yesterday.toISOString().slice(0, 10);

  console.log(`📊 Building daily stats for ${statDate}...`);

  try {
    // Aggregáljuk a tegnapi olvasásokat manga+chapter szinten
    const { rows } = await pool.query(`
      SELECT
        manga_id,
        chapter,
        COUNT(*)::int AS read_count,
        COUNT(DISTINCT user_id)::int AS unique_readers
      FROM chapter_reads
      WHERE read_at >= $1::date
        AND read_at < ($1::date + interval '1 day')
      GROUP BY manga_id, chapter
    `, [statDate]);

    if (!rows.length) {
      console.log("ℹ️ Nincs adat tegnap");
      return;
    }

    // Upsert a daily_stats táblába
    for (const row of rows) {
      await pool.query(`
        INSERT INTO daily_stats (stat_date, manga_id, chapter, read_count, unique_readers)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (stat_date, manga_id, chapter)
        DO UPDATE SET
          read_count = EXCLUDED.read_count,
          unique_readers = EXCLUDED.unique_readers
      `, [statDate, row.manga_id, row.chapter, row.read_count, row.unique_readers]);
    }

    console.log(`✅ ${rows.length} sor mentve (${statDate})`);

    // Opcionális: régi chapter_reads törlése (30 napnál régebbi)
    const deleted = await pool.query(`
      DELETE FROM chapter_reads
      WHERE read_at < NOW() - interval '30 days'
    `);
    console.log(`🗑️ ${deleted.rowCount} régi log törölve`);

  } catch (err) {
    console.error("❌ Daily stats hiba:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

buildDailyStats();
