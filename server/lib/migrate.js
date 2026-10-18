/* ── Adatbázis-séma és migrációk automatikus alkalmazása ───────
   Induláskor (és `npm run migrate`-tel):
   1. üres adatbázisnál (nincs users tábla) a schema.sql betöltése;
   2. a server/scripts/migrations/*.sql közül a még nem alkalmazottak
      lefuttatása név szerinti sorrendben, a schema_migrations táblában
      nyilvántartva.
   Az utasításokat egyenként, tranzakció nélkül futtatjuk (a CREATE INDEX
   CONCURRENTLY tranzakcióban nem futhat), ezért a migrációknak
   ismételten futtathatónak kell lenniük (IF NOT EXISTS stb.) — egy
   félbeszakadt migráció a következő indításkor elölről fut. Több
   példány egyidejű indításakor advisory lock sorosít. ── */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SCHEMA_FILE = path.join(ROOT, "schema.sql");
export const MIGRATIONS_DIR = path.join(ROOT, "server/scripts/migrations");
const LOCK_KEY = [7302, 1];

// SQL-szöveg utasításokra bontása: a ;-t nem bontja idézőjelben,
// $tag$…$tag$ blokkban (függvénytörzs) és megjegyzésben
export function splitSql(sql) {
  const out = [];
  let cur = "", i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], next = sql[i + 1];
    if (c === "-" && next === "-") {                       // sor-megjegyzés
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      cur += "\n";
      continue;
    }
    if (c === "/" && next === "*") {                       // blokk-megjegyzés
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      cur += " ";
      continue;
    }
    if (c === "'" || c === '"') {                          // idézőjeles szakasz
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {                                       // $tag$ … $tag$
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        const stop = end === -1 ? n : end + m[0].length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function runFile(client, file) {
  for (const stmt of splitSql(fs.readFileSync(file, "utf8"))) {
    try {
      await client.query(stmt);
    } catch (err) {
      err.message = `${path.basename(file)}: ${err.message}\n  → ${stmt.slice(0, 200)}`;
      throw err;
    }
  }
}

export async function runMigrations(pool, { log = console.log, schemaFile = SCHEMA_FILE, migrationsDir = MIGRATIONS_DIR } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", LOCK_KEY);

    const { rows: [{ fresh }] } = await client.query(`SELECT to_regclass('public.users') IS NULL AS fresh`);
    if (fresh) {
      log("[migrate] üres adatbázis — a schema.sql betöltése");
      await runFile(client, schemaFile);
    }

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query(`SELECT name FROM schema_migrations`);
    const done = new Set(rows.map(r => r.name));

    const files = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()
      : [];
    for (const name of files) {
      if (done.has(name)) continue;
      log(`[migrate] ${name}`);
      await runFile(client, path.join(migrationsDir, name));
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);
      applied.push(name);
    }
    if (!applied.length && !fresh) log("[migrate] az adatbázis naprakész");
    return { fresh, applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", LOCK_KEY).catch(() => {});
    client.release();
  }
}
