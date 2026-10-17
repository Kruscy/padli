// Biztonsági segédfüggvények — adatbázis nélkül futnak.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import "../helpers/server.mjs"; // tesztkörnyezeti alapértékek

const { isSafeName, resolveInside, stagedFixPath, BUGFIX_STAGING_DIR } = await import("../../server/lib/safe-path.js");
const { isBlockedAddress, safeFetch } = await import("../../server/lib/safe-fetch.js");
const { issueOAuthState, consumeOAuthState } = await import("../../server/lib/oauth-state.js");
const { loginLockRemaining, registerLoginFailure, clearLoginFailures } = await import("../../server/lib/auth-security.js");
const { isAdultVerified } = await import("../../server/lib/age.js");
const { flagsFromRows } = await import("../../server/lib/chapter-access.js");

describe("safe-path", () => {
  test("isSafeName: csak egyetlen, szabályos útvonal-szegmens", () => {
    for (const ok of ["001.jpg", "Ch 01", "fejezet.1"]) assert.equal(isSafeName(ok), true, ok);
    for (const bad of ["", ".", "..", "a/b", "a\\b", "x\0y", 5, null, "x".repeat(256)]) assert.equal(isSafeName(bad), false, String(bad));
  });

  test("resolveInside: a base mappán belül marad, különben null", () => {
    assert.equal(resolveInside("/base", "a", "b.jpg"), "/base/a/b.jpg");
    assert.equal(resolveInside("/base", "..", "etc"), null);
    assert.equal(resolveInside("/base", "a/../../x"), null);
    assert.equal(resolveInside("/base", 5), null);
  });

  test("stagedFixPath: csak a javítások átmeneti mappáján belüli URL", () => {
    assert.equal(stagedFixPath("/uploads/bugs/javitott/s/c/f.jpg"), `${BUGFIX_STAGING_DIR}/s/c/f.jpg`);
    for (const bad of ["/server/index.js", "/uploads/bugs/javitott/s/../../x", "/uploads/bugs/javitott/s/c", null]) {
      assert.equal(stagedFixPath(bad), null, String(bad));
    }
  });
});

describe("safe-fetch (SSRF)", () => {
  test("belső és speciális címek tiltva, nyilvános engedve", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.20", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    for (const ip of ["93.184.215.14", "1.1.1.1", "2606:4700::1111"]) assert.equal(isBlockedAddress(ip), false, ip);
  });

  test("safeFetch hálózati kérés nélkül elutasítja a belső / nem http címeket", async () => {
    for (const url of ["http://127.0.0.1:1/", "http://[::1]/", "http://10.0.0.1/", "file:///etc/hostname", "http://user:pw@example.com/", "nem-url"]) {
      await assert.rejects(safeFetch(url), url);
    }
  });
});

describe("OAuth state", () => {
  test("egyszer felhasználható, más értékkel nem fogadja el", () => {
    const req = { session: {} };
    const state = issueOAuthState(req, "anilist");
    assert.equal(consumeOAuthState(req, "anilist", "rossz"), false);
    const s2 = issueOAuthState(req, "anilist");
    assert.notEqual(s2, state);
    assert.equal(consumeOAuthState(req, "anilist", s2), true);
    assert.equal(consumeOAuthState(req, "anilist", s2), false, "második felhasználás");
    assert.equal(consumeOAuthState(req, "patreon", undefined), false);
  });
});

describe("fiókszintű belépési zárolás", () => {
  test("8 hiba után zárol, sikeres belépés törli", () => {
    const key = `user:test-${Math.random()}`;
    for (let i = 1; i < 8; i++) assert.equal(registerLoginFailure(key), false);
    assert.equal(loginLockRemaining(key), 0);
    assert.equal(registerLoginFailure(key), true, "8. hiba → zárolás");
    assert.ok(loginLockRemaining(key) > 0);
    clearLoginFailures(key);
    assert.equal(loginLockRemaining(key), 0);
  });
});

describe("korhatár és fejezet-zárolás", () => {
  test("isAdultVerified: hiányzó / jövőbeli / irreális dátum → nem felnőtt", () => {
    assert.equal(isAdultVerified("1990-01-01"), true);
    for (const d of [null, "", "nem dátum", "2999-01-01", "1800-01-01", new Date().toISOString()]) {
      assert.equal(isAdultVerified(d), false, String(d));
    }
  });

  test("flagsFromRows: csak akkor zárt, ha minden jelölt zárt", () => {
    const future = new Date(Date.now() + 86400e3), past = new Date(Date.now() - 1000);
    assert.deepEqual(flagsFromRows([]), { exists: false, locked: false, adult: false });
    assert.equal(flagsFromRows([{ unlocks_at: future }]).locked, true);
    assert.equal(flagsFromRows([{ unlocks_at: future }, { unlocks_at: past }]).locked, false);
    assert.equal(flagsFromRows([{ unlocks_at: null, is_adult: true }]).adult, true);
  });
});
