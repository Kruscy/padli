// Oldal beállításai: admin olvashatja, csak a tulajdonos módosíthatja.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("oldal beállításai (admin)", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx, owner, other;
  before(async () => {
    app = await startApp();
    fx = await createFixtures(app.pool);
    // második admin, aki nem tulajdonos
    await app.pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [fx.users.patron.id]);
    process.env.OWNER_USER_ID = String(fx.users.admin.id);
    owner = client(app.baseUrl); other = client(app.baseUrl);
    assert.equal((await owner.login(fx.users.admin.username, PASSWORD)).status, 200);
    assert.equal((await other.login(fx.users.patron.username, PASSWORD)).status, 200);
  });
  after(async () => {
    delete process.env.OWNER_USER_ID;
    await app?.pool.query(`DELETE FROM site_settings WHERE key IN ('name', 'url', 'patreonUrl', 'description')`);
    await fx?.cleanup(); await app?.close();
  });

  test("nem admin: 403; admin olvas, de csak a tulajdonos ír", async () => {
    const user = client(app.baseUrl);
    await user.login(fx.users.user.username, PASSWORD);
    assert.equal((await user.request("/api/admin/site")).status, 403);
    const r = await other.request("/api/admin/site");
    assert.equal(r.status, 200);
    assert.equal(r.data.canEdit, false);
    assert.equal((await other.request("/api/admin/site", { method: "PUT", json: { name: "X" } })).status, 403);
  });

  test("a tulajdonos menti, az oldalakon azonnal megjelenik", async () => {
    assert.equal((await owner.request("/api/admin/site", { method: "PUT", json: { url: "javascript:alert(1)" } })).status, 400);
    const r = await owner.request("/api/admin/site", { method: "PUT", json: { name: "Mentett Fansub", url: "https://mentett.example/x", patreonUrl: "" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.site.url, "https://mentett.example");
    const html = await (await fetch(app.baseUrl + "/login.html")).text();
    assert.match(html, /Mentett Fansub/);
    assert.doesNotMatch(html, /padlizs/i);
  });
});
