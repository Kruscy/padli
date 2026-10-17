// GDPR fióktörlés: jelszóval megerősítve, minden munkamenet megszűnik.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("GDPR fióktörlés", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx;
  before(async () => { app = await startApp(); fx = await createFixtures(app.pool); });
  after(async () => { await fx?.cleanup(); await app?.close(); });

  test("jelszó nélkül / hibás jelszóval nem törölhető, helyessel igen — a másik eszköz is kilép", async () => {
    const name = fx.users.minor.username;
    const a = client(app.baseUrl), b = client(app.baseUrl);
    assert.equal((await a.login(name, PASSWORD)).status, 200);
    assert.equal((await b.login(name, PASSWORD)).status, 200);
    const del = (password) => a.request("/api/gdpr/account", { method: "DELETE", ...(password !== undefined ? { json: { password } } : {}) });

    assert.equal((await del()).status, 403);
    assert.equal((await del("rossz-jelszo")).status, 403);
    assert.equal((await b.request("/api/auth/me")).status, 200, "még nem törölt");

    assert.equal((await del(PASSWORD)).status, 200);
    const { rows } = await app.pool.query(`SELECT 1 FROM users WHERE id = $1`, [fx.users.minor.id]);
    assert.equal(rows.length, 0);
    assert.equal((await b.request("/api/auth/me")).status, 401, "a másik munkamenet azonnal megszűnt");
  });
});
