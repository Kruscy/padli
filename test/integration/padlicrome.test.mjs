// PadliCrome: Gemini-teszt korlátja, a projekt nem vész el sikertelen indításnál.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
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

  test("project/start: sikertelen scrape nem törli a meglévő projektet", async () => {
    const auth = await token("minor");
    const c = client(app.baseUrl);
    const jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer();
    const form = new FormData();
    form.append("images", new Blob([jpeg], { type: "image/jpeg" }), "a.jpg");
    try {
      assert.equal((await c.request("/api/padlicrome/upload", { method: "POST", headers: auth, body: form })).status, 200);
      const start = await c.request("/api/padlicrome/project/start", { method: "POST", headers: auth, json: { url: "http://127.0.0.1:9/fejezet" } });
      assert.equal(start.status, 422);
      const project = await c.request("/api/padlicrome/project", { headers: auth });
      assert.equal(project.data?.images?.length, 1, "a feltöltött kép megmaradt");
    } finally {
      await c.request("/api/padlicrome/project", { method: "DELETE", headers: auth });
    }
  });
});
