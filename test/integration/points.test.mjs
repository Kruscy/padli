// Pontok és fizetés: párhuzamos költés, gift-vásárlás, Stripe-webhook idempotencia.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Stripe from "stripe";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("pontok és fizetés", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx, ledger;
  before(async () => {
    app = await startApp();
    fx = await createFixtures(app.pool);
    ledger = await import("../../server/lib/points-ledger.js");
  });
  after(async () => { await fx?.cleanup(); await app?.close(); });

  const credit = (userId, points) =>
    app.pool.query(`INSERT INTO user_points (user_id, points) VALUES ($1, $2)`, [userId, points]);

  test("párhuzamos levonás: nem költhető el többször ugyanaz a pont", async () => {
    const uid = fx.users.minor.id;
    await credit(uid, 3);
    const results = await Promise.all(Array.from({ length: 10 }, () => ledger.spendPoints(uid, 1)));
    assert.equal(results.filter(r => r.ok).length, 3);
    assert.equal(await ledger.getBalance(uid), 0);
  });

  test("visszatérítés: a sikertelen szolgáltatás pontja visszajár", async () => {
    const uid = fx.users.admin.id;
    await credit(uid, 1);
    const spend = await ledger.spendPoints(uid, 1);
    assert.equal(spend.ok, true);
    await ledger.refundPoints(spend.entryId);
    assert.equal(await ledger.getBalance(uid), 1);
  });

  test("gift-vásárlás: 5 párhuzamos kérés, 105 pont → 1 kód, 5 pont marad", async () => {
    const uid = fx.users.user.id;
    await credit(uid, 60); await credit(uid, 45);
    for (const n of [1, 2, 3]) {
      await app.pool.query(`INSERT INTO patreon_gifts (gift_code, patreon_link) VALUES ($1, 'https://example.test')`, [`${fx.run}-G${n}`]);
    }
    const c = client(app.baseUrl);
    assert.equal((await c.login(fx.users.user.username, PASSWORD)).status, 200);
    const res = await Promise.all(Array.from({ length: 5 }, () => c.request("/api/points/purchase-gift", { method: "POST" })));
    assert.equal(res.filter(r => r.status === 200).length, 1);
    const { rows } = await app.pool.query(`SELECT count(*)::int n FROM patreon_gifts WHERE purchased_by = $1`, [uid]);
    assert.equal(rows[0].n, 1);
    assert.equal(await ledger.getBalance(uid), 5, "a maradék nem vész el");
  });

  test("Stripe-webhook: ugyanaz az esemény 5× párhuzamosan → egy jóváírás", async () => {
    const uid = fx.users.patron.id;
    const payload = JSON.stringify({
      id: `evt_${fx.run}`, object: "event", type: "checkout.session.completed",
      data: { object: { id: `cs_${fx.run}`, payment_status: "paid", mode: "payment",
                        metadata: { type: "points", userId: String(uid), points: "50", packageId: "teszt" } } },
    });
    const signature = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const send = () => fetch(`${app.baseUrl}/api/shop/webhook`, {
      method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload,
    });
    const res = await Promise.all(Array.from({ length: 5 }, send));
    assert.ok(res.every(r => r.status === 200));
    const { rows } = await app.pool.query(`SELECT count(*)::int n FROM shop_orders WHERE stripe_session_id = $1`, [`cs_${fx.run}`]);
    assert.equal(rows[0].n, 1);
    assert.equal(await ledger.getBalance(uid), 50);

    const bad = await fetch(`${app.baseUrl}/api/shop/webhook`, {
      method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=hamis" }, body: payload,
    });
    assert.equal(bad.status, 400, "hamis aláírás elutasítva");
  });

  test("Patreon-webhook: csak érvényes aláírással, titok nélkül sehogy", async () => {
    const body = JSON.stringify({ data: {} });
    const send = (sig) => fetch(`${app.baseUrl}/api/patreon/webhook`, {
      method: "POST", body,
      headers: { "content-type": "application/json", "x-patreon-event": "teszt:nem-releváns", ...(sig ? { "x-patreon-signature": sig } : {}) },
    });
    const prev = process.env.PATREON_WEBHOOK_SECRET;
    try {
      process.env.PATREON_WEBHOOK_SECRET = "teszt-patreon-titok";
      const good = crypto.createHmac("md5", "teszt-patreon-titok").update(body).digest("hex");
      assert.equal((await send(good)).status, 200);
      assert.equal((await send("0".repeat(32))).status, 401);
      assert.equal((await send("é")).status, 401, "több bájtos aláírás sem dob hibát");
      assert.equal((await send(null)).status, 401);
      delete process.env.PATREON_WEBHOOK_SECRET;
      assert.equal((await send(good)).status, 503, "titok nélkül nem fogad el semmit");
    } finally {
      if (prev === undefined) delete process.env.PATREON_WEBHOOK_SECRET; else process.env.PATREON_WEBHOOK_SECRET = prev;
    }
  });
});
