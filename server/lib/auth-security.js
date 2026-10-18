import bcrypt from "bcrypt";
import { createHash } from "crypto";
import { pool } from "../db.js";

/* ── Belépés-biztonsági segédfüggvények ─────────────────────── */

export const MIN_PASSWORD_LENGTH = 8;

// Hibaüzenet (string) vagy null, ha a jelszó elfogadható. A bcrypt csak az
// első 72 bájtot veszi figyelembe — ennél hosszabbat nem tiltunk, de a
// felső korlát a túl nagy (szándékosan lassító) bemenetek ellen van.
export function validatePassword(pw) {
  if (typeof pw !== "string" || !pw.trim()) return "A jelszó megadása kötelező.";
  if (pw.length < MIN_PASSWORD_LENGTH) return `A jelszó legalább ${MIN_PASSWORD_LENGTH} karakter legyen.`;
  if (pw.length > 200) return "A jelszó túl hosszú (legfeljebb 200 karakter).";
  return null;
}

// Felhasználónév: 3–32 karakter, HTML-/URL-jelölő és vezérlőkarakter
// nélkül, szóközzel nem kezdődhet/végződhet (sok helyen megjelenítjük)
export function validateUsername(username) {
  if (typeof username !== "string") return "Érvénytelen adatok";
  if (username.length < 3) return "A felhasználónév túl rövid";
  if (username.length > 32) return "A felhasználónév legfeljebb 32 karakter lehet";
  if (/[<>"'`&\\/]|\p{C}/u.test(username) || username !== username.trim()) {
    return "A felhasználónév nem tartalmazhat < > \" ' ` & / \\ karaktert, és nem kezdődhet/végződhet szóközzel";
  }
  return null;
}

// Időzítés-kiegyenlítés: nem létező felhasználónál is lefut egy bcrypt
// összehasonlítás, így a válaszidőből nem derül ki, létezik-e a fiók.
const DUMMY_HASH = bcrypt.hashSync("padli-dummy-password-for-timing", 12);
export async function comparePasswordSafe(password, hash) {
  const ok = await bcrypt.compare(String(password ?? ""), hash || DUMMY_HASH);
  return !!hash && ok;
}

// A jelszó-visszaállító tokent csak hash-elve tároljuk (ahogy az e-mail-
// megerősítőt is) — adatbázis-szivárgásnál a tárolt érték nem használható.
export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

// Felhasználó keresése belépési névvel (felhasználónév VAGY e-mail).
// Előbb pontos egyezés; ha nincs, kis-/nagybetűtől függetlenül — de csak
// akkor, ha egyetlen fiók felel meg (van 10 felhasználónév és 4 e-mail,
// ami csak kis-/nagybetűben tér el, pl. Zoli/zoli: ott marad a pontos
// egyezés kötelező). 2026-10-16: a „nincs ilyen felhasználó” hibák közel
// fele csak a kis-/nagybetű miatt volt (mobilon nagybetűvel kezd a billentyűzet).
// columns: a SELECT oszloplistája (megbízható, kódból jön).
export async function findUserByLogin(login, columns = "*") {
  const key = String(login ?? "").trim();
  if (!key) return null;
  const exact = await pool.query(
    `SELECT ${columns} FROM users WHERE email = $1 OR username = $1 LIMIT 1`, [key]
  );
  if (exact.rows.length) return exact.rows[0];
  const ci = await pool.query(
    `SELECT ${columns} FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1) LIMIT 2`, [key]
  );
  return ci.rows.length === 1 ? ci.rows[0] : null;
}

// Ugyanez csak e-mail-címre (jelszó-visszaállítás, megerősítő újraküldése):
// a tárolt e-mail-címet adja vissza, vagy null-t.
export async function resolveStoredEmail(email) {
  const key = String(email ?? "").trim();
  if (!key) return null;
  const exact = await pool.query(`SELECT email FROM users WHERE email = $1 LIMIT 1`, [key]);
  if (exact.rows.length) return exact.rows[0].email;
  const ci = await pool.query(`SELECT email FROM users WHERE lower(email) = lower($1) LIMIT 2`, [key]);
  return ci.rows.length === 1 ? ci.rows[0].email : null;
}

// A user összes (vagy egy kivételével minden) munkamenetének törlése —
// jelszócsere / -visszaállítás után a régi (esetleg ellopott) belépések
// így érvénytelenné válnak. A munkamenetek a "session" táblában vannak
// (connect-pg-simple), a sess JSON-ban a user.id-vel.
export async function destroyUserSessions(userId, exceptSid = null) {
  const { rowCount } = await pool.query(
    `DELETE FROM session
     WHERE (sess->'user'->>'id') = $1::text
       AND ($2::text IS NULL OR sid <> $2::text)`,
    [String(userId), exceptSid]
  );
  return rowCount;
}

/* ── Fiókszintű brute-force védelem ───────────────────────────
   Az IP-alapú korlát (index.js) sok IP-ről elosztott próbálkozás ellen nem
   véd. Itt belépési névenként (kisbetűsítve) számoljuk a sikertelen
   próbálkozásokat: LOGIN_MAX_FAILS hiba LOGIN_WINDOW_MS-en belül után a
   fiókra LOGIN_LOCK_MS-ig 429-et adunk — helyes jelszóval is, különben a
   zárolás alatt is lehetne találgatni. A sikeres belépés törli a
   számlálót. Memóriában tárolt (egy folyamat), újraindításkor nullázódik. */
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 15 * 60e3;
const LOGIN_LOCK_MS = 15 * 60e3;
const loginFails = new Map(); // kulcs → { first, count, lockedUntil }

const loginKeyOf = login => String(login ?? "").trim().toLowerCase().slice(0, 200);

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFails) {
    if (now - v.first > LOGIN_WINDOW_MS && now > v.lockedUntil) loginFails.delete(k);
  }
}, 60e3).unref();

// Hány másodperc van még hátra a zárolásból (0 = nincs zárolva)
export function loginLockRemaining(login) {
  const e = loginFails.get(loginKeyOf(login));
  if (!e || Date.now() >= e.lockedUntil) return 0;
  return Math.ceil((e.lockedUntil - Date.now()) / 1000);
}

// true, ha ezzel a hibával a fiók zárolásba került
export function registerLoginFailure(login) {
  const key = loginKeyOf(login);
  if (!key) return false;
  const now = Date.now();
  let e = loginFails.get(key);
  if (!e || now - e.first > LOGIN_WINDOW_MS) e = { first: now, count: 0, lockedUntil: 0 };
  e.count++;
  let locked = false;
  if (e.count >= LOGIN_MAX_FAILS) {
    e.lockedUntil = now + LOGIN_LOCK_MS;
    e.first = now;
    e.count = 0;
    locked = true;
  }
  loginFails.set(key, e);
  return locked;
}

export function clearLoginFailures(login) {
  loginFails.delete(loginKeyOf(login));
}
