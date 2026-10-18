// Verzió-összehasonlítás és frissítés-ellenőrzés — hálózat nélkül.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION, checkForUpdate, compareVersions, resetUpdateCache } from "../../server/lib/update-check.js";

test("verziók összehasonlítása", () => {
  assert.equal(compareVersions("1.10.0", "1.9.3"), 1);
  assert.equal(compareVersions("v2.0.0", "2.0.0"), 0);
  assert.equal(compareVersions("1.2", "1.2.1"), -1);
  assert.equal(compareVersions("1.3.0-beta", "1.3.0"), 0);
});

test("új kiadás jelzése, hiba esetén csendes", async () => {
  const prev = process.env.UPDATE_CHECK;
  delete process.env.UPDATE_CHECK;
  try {
    resetUpdateCache();
    const newer = await checkForUpdate({ fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: "v999.0.0", html_url: "https://x/rel" }) }) });
    assert.deepEqual(newer, { current: APP_VERSION, latest: "999.0.0", updateAvailable: true, releaseUrl: "https://x/rel" });
    resetUpdateCache();
    const failed = await checkForUpdate({ fetchImpl: async () => { throw new Error("nincs hálózat"); } });
    assert.equal(failed.updateAvailable, false);
    assert.equal(failed.latest, null);
    process.env.UPDATE_CHECK = "false";
    assert.equal((await checkForUpdate()).disabled, true);
  } finally {
    if (prev === undefined) delete process.env.UPDATE_CHECK; else process.env.UPDATE_CHECK = prev;
  }
});
