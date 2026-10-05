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
