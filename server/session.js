import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db.js";

/* ── Session middleware ───────────────────────────────────────
   Külön modulban, mert a webszerver (index.js) mellett a chat
   WebSocket-szervere (discord-bot.js) is ezzel azonosítja a kapcsolódó
   felhasználót. ── */
const PgSession = connectPgSimple(session);
const isProd = process.env.NODE_ENV === "production";

export const sessionMiddleware = session({
  store: new PgSession({
    // Közös pool az alkalmazással (külön conString-gel egy második,
    // hibakezelő nélküli pool jött létre)
    pool,
    tableName: "session",
    pruneSessionInterval: 60 * 60,
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
