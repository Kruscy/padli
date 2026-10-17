// CSP-jelentések: belépés nélkül hívható végpont, egy IP nem töltheti be a naplót.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "timers/promises";
import { hasDb, startApp } from "../helpers/server.mjs";

describe("CSP-jelentések", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app;
  const run = `csp${Date.now().toString(36)}`;
  before(async () => { app = await startApp(); });
  after(async () => {
    await app?.pool.query(`DELETE FROM security_events WHERE type = 'csp_violation' AND details->>'page' LIKE $1`, [`/${run}%`]);
    await app?.close();
  });

  test("egy IP-ről legfeljebb 20 különböző jelentés kerül a naplóba", async () => {
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`${app.baseUrl}/api/csp-report`, {
        method: "POST", headers: { "content-type": "application/csp-report" },
        body: JSON.stringify({ "csp-report": { "document-uri": `http://x/${run}-${i}.html`, "effective-directive": "script-src-attr", "script-sample": "x" } }),
      });
      assert.equal(r.status, 204);
    }
    await sleep(500);
    const { rows } = await app.pool.query(
      `SELECT count(*)::int n FROM security_events WHERE type = 'csp_violation' AND details->>'page' LIKE $1`, [`/${run}%`]);
    assert.equal(rows[0].n, 20);
  });
});
