// PadliCrome: a díjmentes (kísérleti) Gemini-fordítás felhasználónként korlátozott.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("PadliCrome", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx;
  before(async () => { app = await startApp(); fx = await createFixtures(app.pool); });
  after(async () => { await fx?.cleanup(); await app?.close(); });

  const token = async (who) => {
    const r = await client(app.baseUrl).request("/api/padlicrome/login", { method: "POST", json: { username: fx.users[who].username, password: PASSWORD } });
    assert.equal(r.status, 200);
    return { authorization: `Bearer ${r.data.token}` };
  };

  test("translate-gemini: óránként legfeljebb 40 kérés felhasználónként", async () => {
    const auth = await token("user");
    const c = client(app.baseUrl);
    for (let i = 0; i < 40; i++) {
      assert.notEqual((await c.request("/api/padlicrome/translate-gemini/x", { method: "POST", headers: auth })).status, 429);
    }
    assert.equal((await c.request("/api/padlicrome/translate-gemini/x", { method: "POST", headers: auth })).status, 429);
    const other = await token("patron");
    assert.notEqual((await c.request("/api/padlicrome/translate-gemini/x", { method: "POST", headers: other })).status, 429, "más felhasználót nem érint");
  });
});
