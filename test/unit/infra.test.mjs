// Infrastruktúra: async hibakezelés és a TTL-cache — adatbázis nélkül.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { errorHandler } from "../../server/lib/async-errors.js";
import { createTtlCache } from "../../server/lib/ttl-cache.js";

describe("async-errors", () => {
  test("az async handler hibája 500-as JSON lesz, a folyamat nem áll le", async () => {
    const app = express();
    app.get("/api/boom", async () => { throw new Error("titkos belső részlet"); });
    app.get("/api/type", async (req) => { req.body.content.trim(); }); // TypeError
    app.get("/api/ok", (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const p of ["/api/boom", "/api/type"]) {
        const res = await fetch(base + p);
        assert.equal(res.status, 500, p);
        const body = await res.json();
        assert.equal(body.error, "Szerver hiba");
        assert.ok(!JSON.stringify(body).includes("titkos"), "a belső hibaüzenet nem kerül ki");
      }
      assert.equal((await fetch(base + "/api/ok")).status, 200, "utána is kiszolgál");
    } finally {
      server.close();
    }
  });
});

describe("ttl-cache", () => {
  test("lejárat és méretkorlát", async () => {
    const c = createTtlCache({ ttlMs: 30, maxEntries: 2 });
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    assert.equal(c.get("a"), undefined, "a legrégebbi kiesett");
    assert.equal(c.get("c"), 3);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(c.get("c"), undefined, "lejárt");
  });

  test("wrap: az egyidejű kérések egyetlen betöltést várnak meg", async () => {
    const c = createTtlCache({ ttlMs: 1000 });
    let calls = 0;
    const loader = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return "érték"; };
    const results = await Promise.all(Array.from({ length: 5 }, () => c.wrap("k", loader)));
    assert.deepEqual(results, Array(5).fill("érték"));
    assert.equal(calls, 1);
  });

  test("wrap: a betöltési hiba nem kerül a cache-be", async () => {
    const c = createTtlCache({ ttlMs: 1000 });
    await assert.rejects(c.wrap("k", async () => { throw new Error("x"); }));
    assert.equal(await c.wrap("k", async () => "ok"), "ok");
  });
});
