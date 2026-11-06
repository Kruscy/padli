import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db.js";

/* ── Session middleware ───────────────────────────────────────
   Külön modulban, mert a webszerver (index.js) mellett a chat
   WebSocket-szervere (discord-bot.js) is ezzel azonosítja a kapcsolódó
   felhasználót. ── */
const PgSession = connectPgSimple(session);
const isProd = process.env.NODE_ENV === "production";

// Éles módban nem indulunk el session-kulcs nélkül: a korábbi csendes
// alapérték ("dev-secret-change-me") nyilvános, azzal bárki hamisíthatott
// volna session-sütit.
if (!process.env.SESSION_SECRET) {
  if (isProd) {
    console.error("❌ SESSION_SECRET nincs beállítva — a szerver nem indul el.");
    process.exit(1);
  }
  console.warn("⚠️  SESSION_SECRET nincs beállítva — fejlesztői alapérték használatban.");
} else if (process.env.SESSION_SECRET.length < 32) {
  console.warn("⚠️  SESSION_SECRET rövid (32 karakternél rövidebb) — érdemes hosszabb, véletlenszerű értékre cserélni.");
}

export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 1 hét

export const sessionMiddleware = session({
  store: new PgSession({
    // Közös pool az alkalmazással (külön conString-gel egy második,
    // hibakezelő nélküli pool jött létre)
    pool,
    tableName: "session",
    pruneSessionInterval: 60 * 60,
    // A "touch" minden kérésnél (képenként is) egy UPDATE volt: csak a DB-beli
    // lejáratot tolta ki, a süti lejárata viszont (rolling nélkül) a
    // belépéskor rögzül — a felhasználónak semmit nem adott.
    disableTouch: true,
  }),
  name: "padlizsan.sid",
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE, // 1 hét; használatkor naponta meghosszabbodik (sessionRenewal)
  },
});

/* ── Bejelentkezés meghosszabbítása használatkor (2026-11-06) ───────
   A süti lejárata a belépéskor rögzült (30 nap, rolling nélkül), így aki
   rendszeresen használta az oldalt, annak is pontosan 30 nap után lejárt —
   SKYPRO-nak épp feltöltés közben (99 kép „Bejelentkezés szükséges”).
   Itt a bejelentkezett felhasználó munkamenetét naponta legfeljebb egyszer
   újabb 1 hétre hosszabbítjuk (a user kérésére 30 nap helyett 1 hét: aki
   használja az oldalt, úgyis folyamatosan meghosszabbodik): a session módosul → a store elmenti (az
   adatbázisbeli lejáratot is), és új sütit kap. Kérésenkénti „touch” helyett
   napi egy írás, mert az oldalak képenként is kérnek (lásd disableTouch). */
const RENEW_EVERY = 24 * 60 * 60 * 1000;

export function sessionRenewal(req, _res, next) {
  const s = req.session;
  if (s?.user) {
    const now = Date.now();
    if (!s.renewedAt || now - s.renewedAt > RENEW_EVERY) {
      s.renewedAt = now;
      s.cookie.maxAge = SESSION_MAX_AGE;
    }
  }
  next();
}
