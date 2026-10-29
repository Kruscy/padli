// Olvasó-beállítások: fiókhoz mentve, eszközönként, szerveroldalon ellenőrizve.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("olvasó-beállítások", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx;
  before(async () => { app = await startApp(); fx = await createFixtures(app.pool); });
  after(async () => { await fx?.cleanup(); await app?.close(); });

  test("belépés nélkül 401, ismeretlen eszköz 400", async () => {
    const anon = client(app.baseUrl);
    assert.equal((await anon.request("/api/reader-prefs")).status, 401);
    const c = client(app.baseUrl);
    await c.login(fx.users.user.username, PASSWORD);
    assert.equal((await c.request("/api/reader-prefs/tv", { method: "PUT", json: {} })).status, 400);
  });

  test("mentés eszközönként, a hibás értékek kiszűrve; más felhasználó nem látja", async () => {
    const c = client(app.baseUrl);
    await c.login(fx.users.user.username, PASSWORD);
    assert.deepEqual((await c.request("/api/reader-prefs")).data, { mobile: null, desktop: null });

    const put = await c.request("/api/reader-prefs/mobile", { method: "PUT",
      json: { mode: "book", direction: "rtl", scaling: "height", widthPct: 999, splitWide: "split", autoWebtoon: false, admin: true } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.data, { mode: "book", direction: "rtl", scaling: "height", widthPct: 100, splitWide: "split", autoWebtoon: false });

    const got = (await c.request("/api/reader-prefs")).data;
    assert.equal(got.desktop, null);
    assert.deepEqual(got.mobile, put.data);

    const other = client(app.baseUrl);
    await other.login(fx.users.patron.username, PASSWORD);
    assert.deepEqual((await other.request("/api/reader-prefs")).data, { mobile: null, desktop: null });
  });
});
