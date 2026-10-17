// Tesztadatok egy integrációs tesztfájlhoz: felhasználók (sima, admin,
// kiskorú, támogató), egy ideiglenes könyvtár képekkel, és mangák
// szabad / zárolt / 18+ fejezettel. Minden név egyedi (run id), a
// cleanup() mindent töröl, amit létrehozott.
import bcrypt from "bcrypt";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

export const PASSWORD = "Teszt-jelszo-123";

export async function createFixtures(pool) {
  const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const users = {};
  for (const [key, role, birth] of [
    ["user", "user", "1990-01-01"], ["admin", "admin", "1990-01-01"],
    ["minor", "user", "2015-01-01"], ["patron", "user", "1990-01-01"],
  ]) {
    const name = `${run}_${key}`;
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, email_verified, birth_date, role)
       VALUES ($1, $2, $3, true, $4, $5) RETURNING id`,
      [name, `${name}@example.test`, hash, birth, role]
    );
    users[key] = { id: rows[0].id, username: name };
  }
  await pool.query(
    `INSERT INTO patreon_status (patreon_user_id, user_id, tier, active) VALUES ($1, $2, 'Tier1', true)`,
    [`${run}_pat`, users.patron.id]
  );

  // Könyvtár + képek egy ideiglenes mappában
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), `padli-${run}-`));
  const libName = `${run}_LIB`;
  const { rows: lib } = await pool.query(`INSERT INTO library (name, path) VALUES ($1, $2) RETURNING id`, [libName, libDir]);
  const libraryId = lib[0].id;

  const manga = {};
  for (const [key, adult] of [["free", false], ["adult", true]]) {
    const slug = `${run}-${key}`;
    const folder = `${run} ${key}`;
    const { rows } = await pool.query(
      `INSERT INTO manga (title, slug, library_id, folder) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`Teszt ${key}`, slug, libraryId, folder]
    );
    manga[key] = { id: rows[0].id, slug, folder };
    if (adult) {
      const { rows: g } = await pool.query(
        `INSERT INTO genre (name) VALUES ('Hentai') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`
      );
      await pool.query(`INSERT INTO manga_genre (manga_id, genre_id) VALUES ($1, $2)`, [rows[0].id, g[0].id]);
    }
  }
  // Fejezetek: free/Ch01 szabad, free/Ch02 zárolt (7 nap), adult/Ch01 18+
  const chapters = [
    [manga.free, "Ch01", null], [manga.free, "Ch02", "7 days"], [manga.adult, "Ch01", null],
  ];
  for (const [m, folder, lockFor] of chapters) {
    await pool.query(
      `INSERT INTO chapter (manga_id, library_id, folder, unlocks_at)
       VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() + $4::interval END)`,
      [m.id, libraryId, folder, lockFor]
    );
    const dir = path.join(libDir, m.folder, folder);
    fs.mkdirSync(dir, { recursive: true });
    const img = await sharp({ create: { width: 20, height: 30, channels: 3, background: { r: 200, g: 0, b: 0 } } }).jpeg().toBuffer();
    fs.writeFileSync(path.join(dir, "001.jpg"), img);
  }

  async function cleanup() {
    const ids = Object.values(users).map(u => u.id);
    const q = (sql, p) => pool.query(sql, p).catch(() => {});
    await q(`DELETE FROM security_events WHERE user_id = ANY($1)`, [ids]);
    await q(`DELETE FROM user_points WHERE user_id = ANY($1)`, [ids]);
    await q(`DELETE FROM shop_orders WHERE user_id = ANY($1)`, [ids]);
    await q(`DELETE FROM patreon_gifts WHERE gift_code LIKE $1`, [`${run}%`]);
    await q(`DELETE FROM bug_fixes WHERE fixed_by = ANY($1)`, [ids]);
    await q(`DELETE FROM patreon_status WHERE user_id = ANY($1)`, [ids]);
    await q(`DELETE FROM session WHERE (sess->'user'->>'id')::int = ANY($1)`, [ids]);
    await q(`DELETE FROM manga_genre WHERE manga_id = ANY($1)`, [Object.values(manga).map(m => m.id)]);
    await q(`DELETE FROM library WHERE id = $1`, [libraryId]); // manga + chapter: ON DELETE CASCADE
    await q(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
    fs.rmSync(libDir, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), "uploads", "bugs", "javitott", manga.free.slug), { recursive: true, force: true });
  }

  return { run, users, manga, libName, libDir, cleanup };
}
