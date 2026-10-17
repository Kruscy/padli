// Regisztráció: a felhasználónév ellenőrzése. Külön fájl (külön folyamat):
// a belépési tesztek már közel járnak az IP-nkénti auth-korláthoz.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures } from "../helpers/fixtures.mjs";

describe("regisztráció", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx;
  before(async () => { app = await startApp(); fx = await createFixtures(app.pool); });
  after(async () => { await fx?.cleanup(); await app?.close(); });

  test("regisztráció: jelölőkarakteres, túl hosszú vagy nem szöveg felhasználónév elutasítva", async () => {
    const c = client(app.baseUrl);
    const reg = (username) => c.request("/api/auth/register", { method: "POST",
      json: { username, email: `reg-${fx.run}@example.test`, password: "Teszt-jelszo-123", birthDate: "2000-01-01" } });
    for (const u of ["<b>xx</b>", "a\"b'c", " szokoz", "x".repeat(33), "tab\tnev", ["abc"]]) {
      assert.equal((await reg(u)).status, 400, JSON.stringify(u));
    }
  });
});
