// Telepítő varázsló: friss (admin nélküli) adatbázison. Saját, eldobható
// adatbázist hoz létre, hogy a többi teszt adataitól független legyen.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { runMigrations } from "../../server/lib/migrate.js";

describe("telepítő varázsló", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  const dbName = `padli_setup_${Date.now().toString(36)}`;
  let admin, app;
  before(async () => {
    admin = new pg.Client();
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const pool = new pg.Pool({ database: dbName, max: 1 });
    await runMigrations(pool, { log: () => {} });
    await pool.end();
    process.env.PGDATABASE = dbName; // az app ezen az üres adatbázison indul
    process.env.SETUP_TOKEN = "teszt-telepito-kod";
    app = await startApp();
  });
  after(async () => {
    await app?.close();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  const form = (over = {}) => ({
    token: "teszt-telepito-kod", siteName: "Próba <Fansub>", siteUrl: "https://proba.example/akarmi",
    username: "Tulaj", email: "tulaj@example.test", password: "Teszt-jelszo-123", birthDate: "1990-01-01", ...over,
  });

  test("admin nélkül minden oldal a varázslóra irányít, az API nem", async () => {
    for (const p of ["/", "/index.html", "/valami/oldal"]) {
      const r = await fetch(app.baseUrl + p, { redirect: "manual" });
      assert.equal(r.status, 302, p);
      assert.equal(r.headers.get("location"), "/setup.html");
    }
    assert.equal((await fetch(app.baseUrl + "/setup.html", { redirect: "manual" })).status, 200);
    assert.deepEqual(await (await fetch(app.baseUrl + "/api/setup/status")).json(), { needsSetup: true });
  });

  test("hibás telepítőkóddal / hibás adatokkal elutasítva", async () => {
    const c = client(app.baseUrl);
    assert.equal((await c.request("/api/setup", { method: "POST", json: form({ token: "rossz" }) })).status, 403);
    assert.equal((await c.request("/api/setup", { method: "POST", json: form({ siteUrl: "ftp://x" }) })).status, 400);
    assert.equal((await c.request("/api/setup", { method: "POST", json: form({ username: "<b>x</b>" }) })).status, 400);
    assert.equal((await c.request("/api/setup", { method: "POST", json: form({ password: "rovid" }) })).status, 400);
  });

  test("sikeres telepítés: admin + tulajdonos + oldalnév, utána lezárva", async () => {
    const c = client(app.baseUrl);
    const r = await c.request("/api/setup", { method: "POST", json: form() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const me = await c.request("/api/auth/me");
    assert.equal(me.data.role, "admin");
    assert.equal(me.data.can_scan, true, "az első admin a tulajdonos");

    const home = await fetch(app.baseUrl + "/", { redirect: "manual" });
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Próba &lt;Fansub&gt;/);
    assert.doesNotMatch(html, /padlizs/i);

    const again = await client(app.baseUrl).request("/api/setup", { method: "POST", json: form({ username: "Masik", email: "m@example.test" }) });
    assert.equal(again.status, 409);
    const { rows } = await app.pool.query(`SELECT key, value FROM site_settings ORDER BY key`);
    assert.deepEqual(Object.fromEntries(rows.map(r => [r.key, r.value])),
      { name: "Próba <Fansub>", ownerUserId: String(me.data.id), patreonUrl: "", url: "https://proba.example" });
  });
});
