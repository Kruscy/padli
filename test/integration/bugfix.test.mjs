// Bugfix-feltöltés: csak létező fejezetre, ellenőrzött névvel, valódi képpel.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("bugfix-feltöltés", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx, c, jpeg;
  before(async () => {
    app = await startApp();
    fx = await createFixtures(app.pool);
    c = client(app.baseUrl);
    assert.equal((await c.login(fx.users.user.username, PASSWORD)).status, 200);
    jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } } }).jpeg().toBuffer();
    for (const idx of [0, 1]) {
      await app.pool.query(
        `INSERT INTO bug_reports (provider, manga_slug, chapter, image_file, image_index, image_url, user_id, username, description, report_count)
         VALUES ($1, $2, 'Ch01', '001.jpg', $3, 'x', $4, 'teszt', 'teszt', 1)`,
        [fx.libName, fx.manga.free.slug, idx, fx.users.user.id]);
    }
  });
  after(async () => {
    await app?.pool.query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [Object.values(fx.users).map(u => u.id)]).catch(() => {});
    await app?.pool.query(`DELETE FROM bug_reports WHERE manga_slug = $1`, [fx?.manga.free.slug]);
    await fx?.cleanup(); await app?.close();
  });

  const upload = (fields, file = jpeg, name = "fix.jpg") => {
    const form = new FormData();
    form.append("image", new Blob([file]), name);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return c.request("/api/bug-reports/fix/upload", { method: "POST", body: form });
  };

  test("létező fejezetre a javítás az átmeneti mappába kerül", async () => {
    const r = await upload({ manga_slug: fx.manga.free.slug, chapter: "Ch01", image_index: "0" });
    assert.equal(r.status, 200);
    const file = path.join(process.cwd(), r.data.url);
    assert.ok(file.startsWith(path.join(process.cwd(), "uploads", "bugs", "javitott") + path.sep));
    assert.ok(fs.existsSync(file));
  });

  test("jóváhagyáskor a javítás az eredeti oldalt cseréli, nem új oldalt hoz létre", async () => {
    const up = await upload({ manga_slug: fx.manga.free.slug, chapter: "Ch01", image_index: "0" });
    assert.equal(up.status, 200);
    assert.equal(up.data.fix.image_file, "001.jpg");
    // a hibajegy-adminság a Patreon "Admin" szintjéhez kötött
    await app.pool.query(`INSERT INTO patreon_status (patreon_user_id, user_id, tier, active) VALUES ($1, $2, 'Admin', true)`,
      [`${fx.run}_adm`, fx.users.admin.id]);
    const admin = client(app.baseUrl);
    assert.equal((await admin.login(fx.users.admin.username, PASSWORD)).status, 200);
    assert.equal((await admin.request(`/api/bug-reports/fix/${up.data.fix.id}/apply`, { method: "POST" })).status, 200);
    const dir = path.join(fx.libDir, fx.manga.free.folder, "Ch01");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["001.jpg"]);
    assert.ok(fs.readFileSync(path.join(dir, "001.jpg")).equals(jpeg));
  });

  test("hibajegy nélküli képre nem tölthető fel javítás", async () => {
    assert.equal((await upload({ manga_slug: fx.manga.free.slug, chapter: "Ch01", image_index: "7" })).status, 404);
  });

  test("nem létező fejezet, hibás név vagy index elutasítva", async () => {
    assert.equal((await upload({ manga_slug: fx.manga.free.slug, chapter: "Nincs", image_index: "0" })).status, 404);
    assert.equal((await upload({ manga_slug: "nincs-ilyen", chapter: "Ch01", image_index: "0" })).status, 404);
    assert.equal((await upload({ manga_slug: fx.manga.free.slug, chapter: "Ch01", image_index: "x" })).status, 400);
    assert.equal((await upload({ manga_slug: fx.manga.free.slug, chapter: "a/b", image_index: "0" })).status, 404);
  });

  test("nem képfájl elutasítva", async () => {
    const r = await upload({ manga_slug: fx.manga.free.slug, chapter: "Ch01", image_index: "1" }, Buffer.from("nem kép"), "x.jpg");
    assert.equal(r.status, 400);
  });

  test("a kliens által küldött fixed_image_url-t mentő régi végpont megszűnt", async () => {
    assert.equal((await c.request("/api/bug-reports/fix", { method: "POST", json: {} })).status, 404);
  });
});
