// Szavazás: csak a szavazás saját opciójára, csak nyitott szavazásnál.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hasDb, startApp, client } from "../helpers/server.mjs";
import { createFixtures, PASSWORD } from "../helpers/fixtures.mjs";

describe("szavazás", { skip: !hasDb && "nincs teszt-adatbázis (PG* környezeti változók)" }, () => {
  let app, fx, c;
  const poll = {};
  before(async () => {
    app = await startApp();
    fx = await createFixtures(app.pool);
    const q = (s, p) => app.pool.query(s, p).then(r => r.rows[0].id);
    for (const [key, ends] of [["open", "1 day"], ["closed", "-1 day"], ["other", "1 day"]]) {
      poll[key] = await q(`INSERT INTO polls (title, created_by, ends_at) VALUES ($1, $2, now() + $3::interval) RETURNING id`,
        [`${fx.run} ${key}`, fx.users.admin.id, ends]);
      poll[`${key}Opt`] = await q(`INSERT INTO poll_options (poll_id, title) VALUES ($1, 'A') RETURNING id`, [poll[key]]);
    }
    c = client(app.baseUrl);
    assert.equal((await c.login(fx.users.user.username, PASSWORD)).status, 200);
  });
  after(async () => {
    await app?.pool.query(`DELETE FROM polls WHERE id = ANY($1)`, [[poll.open, poll.closed, poll.other]]);
    await fx?.cleanup(); await app?.close();
  });

  const vote = (pollId, optionId, changeVote = false) =>
    c.request(`/api/polls/${pollId}/vote`, { method: "POST", json: { optionId, changeVote } });

  test("más szavazás opciójára, lezárt szavazásra, hibás azonosítóra nem lehet szavazni", async () => {
    assert.equal((await vote(poll.open, poll.otherOpt)).status, 400);
    assert.equal((await vote(poll.closed, poll.closedOpt)).status, 400);
    assert.equal((await vote(poll.open, "x")).status, 400);
  });

  test("érvényes szavazat és csere a saját opcióra", async () => {
    assert.equal((await vote(poll.open, poll.openOpt)).status, 200);
    assert.equal((await vote(poll.open, poll.openOpt)).status, 400, "kétszer nem");
    assert.equal((await vote(poll.open, poll.otherOpt, true)).status, 400, "cserével sem idegen opcióra");
    const { rows } = await app.pool.query(`SELECT option_id FROM poll_votes WHERE poll_id = $1`, [poll.open]);
    assert.deepEqual(rows.map(r => r.option_id), [poll.openOpt]);
  });
});
