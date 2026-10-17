import { pool } from "../db.js";

/* ── Pontkönyvelés ──────────────────────────────────────────────
   Az egyenleg: SUM(points) WHERE spent = false (a jóváírások pozitív, a
   levonások negatív sorok). Minden egyenleg-ellenőrzés + levonás egy
   tranzakcióban, a felhasználóra vett tranzakciós zár (advisory lock)
   alatt fut — korábban az ellenőrzés és a levonás között (pl. egy 180 mp-es
   fordítás alatt) párhuzamos kérésekkel többször el lehetett költeni
   ugyanazt a pontot, és az egyenleg negatívba ment.

   A régi, "spent = true"-ra jelölt sorok érvényesek maradnak (azok már
   nem számítanak az egyenlegbe), újakat nem jelölünk így: a teljes
   sorok elköltöttre jelölése a maradékot is elvitte (pl. 5 pontos sorból
   3 kellett, mind az 5 elveszett). ── */

const POINTS_LOCK_NS = 7301; // advisory lock névtér (pg_advisory_xact_lock(int, int))

async function lockUser(client, userId) {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [POINTS_LOCK_NS, userId]);
}

async function balanceOf(client, userId) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(points), 0)::int AS points FROM user_points WHERE user_id = $1 AND NOT spent",
    [userId]
  );
  return rows[0].points;
}

export async function getBalance(userId) {
  return balanceOf(pool, userId);
}

/* Egyenleg-ellenőrzés + levonás egy lépésben, a hívó saját tranzakciós
   munkájával együtt (work(client) — pl. gift-kód lefoglalása). Ha nincs
   elég pont, vagy a work null-t ad, minden visszagörgetődik.
   → { ok: true, entryId, balance, result } | { ok: false, reason, balance } */
export async function spendPoints(userId, amount, work = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockUser(client, userId);
    const balance = await balanceOf(client, userId);
    if (balance < amount) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient", balance };
    }
    let result = null;
    if (work) {
      result = await work(client);
      if (result == null) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "work_failed", balance };
      }
    }
    const { rows } = await client.query(
      `INSERT INTO user_points (user_id, fix_id, points, approved_by, earned_at, spent)
       VALUES ($1, NULL, $2, NULL, NOW(), false) RETURNING id`,
      [userId, -amount]
    );
    await client.query("COMMIT");
    return { ok: true, entryId: rows[0].id, balance: balance - amount, result };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Egy lefoglalt (levont) pont visszaadása, ha a szolgáltatás (pl. fordítás)
// végül nem sikerült.
export async function refundPoints(entryId) {
  await pool.query("DELETE FROM user_points WHERE id = $1 AND points < 0 AND fix_id IS NULL", [entryId]);
}
