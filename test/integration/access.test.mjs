// Hozzáférés-védelem: zárolt (Patreon) és 18+ fejezetek, AI-proxyk, health.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("hozzáférés-védelem", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx;
  const c = {};
  before(async () => {
    app = await startApp();
    fx = await createFixtures(app.pool);
    c.anon = client(app.baseUrl);
    for (const k of ["user", "admin", "minor", "patron"]) {
      c[k] = client(app.baseUrl);
      const r = await c[k].login(fx.users[k].username, PASSWORD);
      assert.equal(r.status, 200, `belépés: ${k}`);
    }
  });
  after(async () => { await fx?.cleanup(); await app?.close(); });

  const img = (who, mangaKey, chapter) =>
    c[who].request(`/api/image/${encodeURIComponent(fx.libName)}/${fx.manga[mangaKey].slug}/${chapter}/001.jpg`);

  test("képek: jogosultsági mátrix", async () => {
    const expected = {
      //          szabad  zárolt  18+
      anon:   [401, 401, 401],
      user:   [200, 403, 200],
      patron: [200, 200, 200],
      minor:  [200, 403, 403],
      admin:  [200, 200, 200],
    };
    for (const [who, [free, locked, adult]] of Object.entries(expected)) {
      assert.equal((await img(who, "free", "Ch01")).status, free, `${who} szabad`);
      assert.equal((await img(who, "free", "Ch02")).status, locked, `${who} zárolt`);
      assert.equal((await img(who, "adult", "Ch01")).status, adult, `${who} 18+`);
    }
  });

  test("képek: a zárolt / 18+ válasz nem kerülhet nyilvános cache-be", async () => {
    assert.match((await img("patron", "free", "Ch02")).headers.get("cache-control"), /^private/);
    assert.match((await img("user", "adult", "Ch01")).headers.get("cache-control"), /^private/);
    assert.match((await img("user", "free", "Ch01")).headers.get("cache-control"), /^public/);
  });

  test("képvégpont: nem képfájl nem szolgálható ki (saját originről futó HTML)", async () => {
    fs.writeFileSync(path.join(fx.libDir, fx.manga.free.folder, "Ch01", "x.html"), "<script>alert(1)</script>");
    const r = await c.admin.request(`/api/image/${encodeURIComponent(fx.libName)}/${fx.manga.free.slug}/Ch01/x.html`);
    assert.equal(r.status, 404);
  });

  test("oldallista: zárolás és korhatár", async () => {
    const pages = (who, m, ch) => c[who].request(`/api/pages/${fx.manga[m].slug}/${ch}`);
    assert.equal((await pages("user", "free", "Ch01")).status, 200);
    const locked = await pages("user", "free", "Ch02");
    assert.equal(locked.status, 403); assert.equal(locked.data.error, "locked");
    const age = await pages("minor", "adult", "Ch01");
    assert.equal(age.status, 403); assert.equal(age.data.error, "age_restricted");
    assert.equal((await pages("patron", "free", "Ch02")).status, 200);
  });

  test("PadliCrome-import: zárolt fejezet nem importálható", async () => {
    const r = await c.user.request("/api/padlicrome/import-chapter", {
      method: "POST", json: { mangaSlug: fx.manga.free.slug, chapter: "Ch02" },
    });
    assert.equal(r.status, 403);
  });

  test("AI-proxyk bejelentkezés nélkül nem hívhatók", async () => {
    for (const p of ["/api/ocr", "/api/translate", "/api/inpaint"]) {
      assert.equal((await c.anon.request(p, { method: "POST", json: { text: "x", imageBase64: "x", maskBase64: "x" } })).status, 401, p);
    }
  });

  test("törzsméret: 2 MB fölött 413, kivéve az OCR / inpaint képes kéréseit", async () => {
    const big = JSON.stringify({ content: "x".repeat(3 * 1024 * 1024) });
    const post = (p, who = "anon") => c[who].request(p, { method: "POST", body: big, headers: { "content-type": "application/json" } });
    assert.equal((await post("/api/auth/login")).status, 413);
    assert.equal((await post("/api/chat/send", "user")).status, 413);
    assert.notEqual((await post("/api/ocr", "user")).status, 413, "OCR: nagy kép elfogadva");
  });

  test("health: a szerver és a DB elérhető", async () => {
    const r = await c.anon.request("/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
  });
});
