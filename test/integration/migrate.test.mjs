// Migrációfuttató: üres adatbázisra a teljes séma + minden migráció,
// másodszorra semmi; a nyilvántartás pontos.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import pg from "pg";
import { hasDb } from "../helpers/server.mjs";
import { runMigrations, MIGRATIONS_DIR } from "../../server/lib/migrate.js";

describe("migrációk", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  const dbName = `padli_mig_${Date.now().toString(36)}`;
  let admin, pool;
  before(async () => {
    admin = new pg.Client();
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    pool = new pg.Pool({ database: dbName, max: 2 });
  });
  after(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  test("üres adatbázis: séma + minden migráció, újrafuttatva semmi", async () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
    const quiet = () => {};
    const first = await runMigrations(pool, { log: quiet });
    assert.equal(first.fresh, true);
    assert.deepEqual(first.applied, files);
    const { rows } = await pool.query(`SELECT to_regclass('users') AS u, to_regclass('security_events') AS s, to_regclass('site_settings') AS st`);
    assert.ok(rows[0].u && rows[0].s && rows[0].st);

    const second = await runMigrations(pool, { log: quiet });
    assert.deepEqual(second, { fresh: false, applied: [] });
  });

  test("meglévő (nyilvántartás nélküli) adatbázison a migrációk ismételten futtathatók", async () => {
    await pool.query(`DROP TABLE schema_migrations`);
    const again = await runMigrations(pool, { log: () => {} });
    assert.equal(again.fresh, false);
    assert.equal(again.applied.length, fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).length);
  });
});
