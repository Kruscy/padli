// Oldal-beállítások és márkacsere (white-label) — adatbázis nélkül.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { brand, getSite, isOwner } from "../../server/lib/site-config.js";

const ENV_KEYS = ["SITE_NAME", "SITE_URL", "BASE_URL", "PATREON_URL", "OWNER_USER_ID"];
const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const setEnv = (vals) => { for (const k of ENV_KEYS) delete process.env[k]; Object.assign(process.env, vals); };

describe("site-config", () => {
  const sample = `<title>Padlizsán Fansub – PadlizsanFanSub</title><link rel="canonical" href="https://padlizsanfansub.hu/x.html">
<a href="https://patreon.com/Padlizsanfansub">Patreon</a> PadlizsanFanSub.hu · padlizsanfansub.hu`;

  test("alapbeállítással a szöveg változatlan (az eredeti oldal)", () => {
    setEnv({});
    assert.equal(brand(sample), sample);
  });

  test("beállított névvel és címmel minden változat cserélődik, HTML-escape-elve", () => {
    setEnv({ SITE_NAME: `Teszt <"Fan">`, SITE_URL: "https://pelda.hu/", PATREON_URL: "https://patreon.com/pelda" });
    const out = brand(sample);
    assert.doesNotMatch(out, /padlizs/i);
    assert.match(out, /Teszt &lt;&quot;Fan&quot;&gt; – Teszt &lt;&quot;Fan&quot;&gt;/);
    assert.match(out, /href="https:\/\/pelda\.hu\/x\.html"/);
    assert.match(out, /href="https:\/\/patreon\.com\/pelda"/);
    assert.equal(brand("PadlizsanFanSub", { html: false }), `Teszt <"Fan">`);
    assert.equal(getSite().host, "pelda.hu");
  });

  test("tulajdonos: alapértelmezés nélkül senki, beállítva csak ő", () => {
    setEnv({});
    assert.equal(isOwner(5), false);
    setEnv({ OWNER_USER_ID: "7" });
    assert.equal(isOwner(7), true);
    assert.equal(isOwner(5), false);
  });
});

test("új telepítésen (más címmel) nem az eredeti oldal Patreonja jelenik meg", () => {
  setEnv({ SITE_URL: "https://pelda.hu" });
  assert.equal(getSite().patreonUrl, "");
  setEnv({});
  assert.equal(getSite().patreonUrl, "https://patreon.com/Padlizsanfansub");
});
