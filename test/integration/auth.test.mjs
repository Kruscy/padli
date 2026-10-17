// Belépés: fiókszintű zárolás, PadliCrome-JWT visszavonása, hibás bemenet.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("belépés", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx;
  before(async () => { app = await startApp(); fx = await createFixtures(app.pool); });
  after(async () => { await fx?.cleanup(); await app?.close(); });

  test("sikeres és sikertelen belépés", async () => {
    const c = client(app.baseUrl);
    assert.equal((await c.login(fx.users.user.username, "rossz-jelszo")).status, 401);
    assert.equal((await c.login(fx.users.user.username.toUpperCase(), PASSWORD)).status, 200, "kis-/nagybetűtől független");
    assert.equal((await c.request("/api/auth/me")).status, 200);
  });

  test("8 hibás próbálkozás után a fiók zárolva — helyes jelszóval és e-maillel is", async () => {
    const c = client(app.baseUrl);
    const name = fx.users.minor.username;
    for (let i = 0; i < 8; i++) assert.equal((await c.login(name, "rossz")).status, 401);
    assert.equal((await c.login(name, PASSWORD)).status, 429, "helyes jelszóval is zárolva");
    assert.equal((await c.login(`${name}@example.test`, PASSWORD)).status, 429, "e-maillel is");
    assert.equal((await client(app.baseUrl).login(fx.users.patron.username, PASSWORD)).status, 200, "más fiókot nem érint");
  });

  test("PadliCrome-JWT: jelszócsere után érvénytelen", async () => {
    const c = client(app.baseUrl);
    const login = await c.request("/api/padlicrome/login", { method: "POST", json: { username: fx.users.admin.username, password: PASSWORD } });
    assert.equal(login.status, 200);
    const auth = { authorization: `Bearer ${login.data.token}` };
    assert.equal((await client(app.baseUrl).request("/api/padlicrome/me", { headers: auth })).status, 200);

    await app.pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await bcrypt.hash("Uj-jelszo-456", 4), fx.users.admin.id]);
    assert.equal((await client(app.baseUrl).request("/api/padlicrome/me", { headers: auth })).status, 401);
  });

  test("elfelejtett jelszó: létező és nem létező címre ugyanaz a válasz (levélküldési hiba esetén is)", async () => {
    const c = client(app.baseUrl);
    const known = await c.request("/api/auth/forgot-password", { method: "POST", json: { email: `${fx.users.patron.username}@example.test` } });
    const unknown = await c.request("/api/auth/forgot-password", { method: "POST", json: { email: `nincs-${fx.run}@example.test` } });
    assert.deepEqual([known.status, known.data], [200, { ok: true }]);
    assert.deepEqual([unknown.status, unknown.data], [200, { ok: true }]);
  });

  test("hibás típusú bemenet 400, a szerver tovább fut", async () => {
    const c = client(app.baseUrl);
    await c.login(fx.users.patron.username, PASSWORD);
    assert.equal((await c.request("/api/chat/send", { method: "POST", json: { content: [] } })).status, 400);
    assert.equal((await c.request("/api/progress", { method: "POST", json: { slug: "x", chapter: 5 } })).status, 400);
    assert.equal((await c.request("/api/health")).status, 200);
  });
});
