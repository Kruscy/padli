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
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
});
