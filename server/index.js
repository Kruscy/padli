import express from "express";
import { errorHandler } from "./lib/async-errors.js";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import { sessionMiddleware } from "./session.js";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import routes from "./routes.js";
import { securityMonitor } from "./middleware/security-monitor.js";
import { getClientIp, isInternalIp } from "./lib/client-ip.js";
import { logSecurityEvent } from "./lib/security-log.js";
import userRoutes from "./routes/user.js";
import { activityTracker } from "./middleware/activity.js";
import { sessionRefresh } from "./middleware/session-refresh.js";
import { billingAddressGate } from "./middleware/billingAddressGate.js";
import "./discord-bot.js";
import cron from "node-cron";
import { generateBlogPost } from "./scripts/blog-auto-generator.js";
import { generateSitemap } from "./sitemap-generator.js";

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";
// Az X-Forwarded-* fejléceket csak akkor fogadjuk el, ha a közvetlen
// kapcsolat belső hálózatról (a fordított proxytól / Docker-hálózatból)
// jön. A korábbi "1" bárkinek elhitte: egy proxy nélkül, közvetlenül
// csatlakozó kliens tetszőleges IP-t adhatott meg magának, és ezzel
// kijátszhatta a belépési kéréskorlátot.
app.set("trust proxy", (addr, hop) => hop === 0 && isInternalIp(addr));
/* ===== ES MODULE __dirname FIX ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== HTTP → HTTPS redirect (közvetlen, nem Cloudflare-en átmenő kérések) ===== */
if (isProd) {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] === "http") {
      return res.redirect(301, "https://" + req.headers.host + req.url);
    }
    next();
  });
}

/* ===== BIZTONSÁGI FIGYELŐ (tiltólista, scanner, áradat, spam) ===== */
app.use(securityMonitor);

/* ===== SECURITY HEADERS ===== */
const cspDirectives = {
  defaultSrc:      ["'self'"],
  scriptSrc:       ["'self'",
                    "'sha256-KbDJwwq2mVzpJQquothLjsd2EGAi2C42lhXRTSlCHJ8='",
                    "'sha256-uWTbFw+oMWAOmFt0aWbGK/DHjclUg7piNA/N+aXguMg='",
                    "'sha256-SN6gRQ39qgoFcepC8OZB+rrT0j5FXFctW1bmQUQqC/I='",
                    "https://mamato.csimota.duckdns.org",
                    ...(process.env.PADLI_API_ORIGIN ? [process.env.PADLI_API_ORIGIN] : [])],
  scriptSrcAttr:   ["'unsafe-inline'"],
  styleSrc:        ["'self'", "'unsafe-inline'",
                    "https://fonts.googleapis.com",
                    "https://cdn.jsdelivr.net"],
  fontSrc:         ["'self'", "https://fonts.gstatic.com"],
  imgSrc:          ["'self'", "data:", "blob:", "https:"],
  connectSrc:      ["'self'",
                    (process.env.SITE_URL || "").replace(/^https?/, "wss"),
                    process.env.SITE_URL || "",
                    ...(process.env.PADLI_API_ORIGIN ? [process.env.PADLI_API_ORIGIN] : [])].filter(Boolean),
  mediaSrc:        ["'self'", "https:"],
  frameSrc:        ["'none'"],
  objectSrc:       ["'none'"],
  upgradeInsecureRequests: [],
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
  hsts: false, // Cloudflare kezeli, kettős header elkerülése
  crossOriginOpenerPolicy: isProd ? { policy: "same-origin" } : false,
  originAgentCluster: isProd,
}));

/* ── CSP Report-Only: az inline eseménykezelők (onclick= stb.) felmérése ──
   Az éles CSP még engedi őket (script-src-attr 'unsafe-inline'), mert a
   szerkesztő- és adminfelületeken sok van. Ez a második, csak jelentő
   fejléc ugyanazzal a szabályzattal, de inline kezelők nélkül: a böngésző
   minden még meglévő inline kezelőt jelent a /api/csp-report-ra (semmit
   nem tilt le). Ha a jelentések elfogynak, az éles szabályban is
   'none'-ra állítható. */
app.use(helmet.contentSecurityPolicy({
  directives: { ...cspDirectives, scriptSrcAttr: ["'none'"], reportUri: ["/api/csp-report"],
                // Report-Only fejlécben nem értelmezett → kihagyjuk
                upgradeInsecureRequests: null },
  reportOnly: true,
}));

app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=()"
  );
  next();
});

/* ===== RATE LIMITING ===== */
// A kulcs a valódi kliens-IP (Cloudflare CF-Connecting-IP, lásd
// lib/client-ip.js) — a req.ip a proxy mögött a proxy/Cloudflare címét
// adhatta, így a korlát sok felhasználó között oszlott meg.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  handler: (req, res, _next, options) => {
    logSecurityEvent({ req, type: "auth_rate_limited", severity: "warn" });
    res.status(options.statusCode).json({ error: "Túl sok próbálkozás, kérjük várj 15 percet." });
  },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
// A PadliCrome-bővítmény saját belépése ugyanazokkal a fiókokkal működik —
// korlát nélkül ezen át meg lehetett kerülni a fő belépés védelmét.
app.use("/api/padlicrome/login", authLimiter);

// Megerősítő e-mail újraküldése: tetszőleges címre küld levelet, ezért
// szigorúbb korlát (e-mail-bombázás és a levélküldő hírnevének védelme).
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  handler: (req, res, _next, options) => {
    logSecurityEvent({ req, type: "auth_rate_limited", severity: "warn", details: { endpoint: "resend-verification" } });
    res.status(options.statusCode).json({ error: "Túl sok kérés, próbáld újra később." });
  },
});
app.use("/api/auth/resend-verification", resendLimiter);

/* ===== WEBHOOK ENDPOINTOK - raw body kell, ezért json() ELÉ ===== */
app.use("/api/shop/webhook", express.raw({ type: "application/json" }));
app.use("/api/patreon/webhook", express.raw({ type: "application/json" }));
/* ===== BODY PARSER ===== */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: false }));
/* ===== SESSION (AUTH) — lásd server/session.js ===== */
app.use(sessionMiddleware);

/* ===== BUILD VERSION (cache busting) ===== */
import { readFileSync, statSync } from "fs";
import { resolveInside } from "./lib/safe-path.js";
const BUILD_VER = Date.now().toString(36);
const PUBLIC_DIR = path.join(__dirname, "../public");

function injectVersion(html) {
  return html.replace(/(href|src)="(\/(?:css|js)\/[^"]+)"/g, (_, attr, url) =>
    `${attr}="${url}${url.includes("?") ? "&" : "?"}v=${BUILD_VER}"`
  );
}

/* ===== STATIC FRONTEND ===== */
app.use('/downloads', express.static(path.join(PUBLIC_DIR, 'downloads')));

// Minden .html kérést verzióval szolgálunk ki. A verziózott HTML-t
// memóriában tartjuk (a fájl módosítási ideje alapján frissül), nem
// olvassuk és alakítjuk át minden oldalbetöltésnél.
const htmlCache = new Map(); // fájl → { mtimeMs, html }
app.use((req, res, next) => {
  if (!req.path.endsWith(".html")) return next();
  let rel;
  try { rel = decodeURIComponent(req.path); } catch { return next(); }
  const filePath = resolveInside(PUBLIC_DIR, "." + rel);
  if (!filePath) return next();
  try {
    const { mtimeMs } = statSync(filePath);
    let hit = htmlCache.get(filePath);
    if (!hit || hit.mtimeMs !== mtimeMs) {
      hit = { mtimeMs, html: injectVersion(readFileSync(filePath, "utf8")) };
      htmlCache.set(filePath, hit);
    }
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(hit.html);
  } catch { next(); }
});

// Verziózott CSS/JS: a tartalom egy verzión belül nem változik, a
// böngésző és a Cloudflare egy évig tárolhatja (eddig max-age=0 → minden
// oldalbetöltésnél újraellenőrzés). CSAK az injectVersion által beírt,
// újraindításonként változó BUILD_VER-re: a JS-fájlokba kézzel írt ?v=
// értékek (pl. layout-loader.js → chat.js?v=…) nem változnak a tartalommal
// együtt, azokra egy éves tárolás a régi fájlt ragasztaná a böngészőkbe.
// Verzió nélkül / kézi verzióval marad az ETag-alapú újraellenőrzés.
app.use((req, res, next) => {
  if ([].concat(req.query.v || []).includes(BUILD_VER) && /^\/(css|js)\//.test(req.path)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else if (req.path.startsWith("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=86400");
  }
  next();
});

app.use(express.static(PUBLIC_DIR));
app.use(activityTracker);

/* ===== API ROUTES ===== */
app.use("/api", sessionRefresh);
app.use("/api", billingAddressGate);
app.use("/api", routes);
app.use("/api/user", userRoutes);
app.use("/uploads", express.static("uploads"));
// R2-fallback: ha a fájl nincs meg helyben (pl. a migrate-to-r2.js már
// feltöltötte és törölte a helyi másolatát), az express.static next()-tel
// idáig enged — ilyenkor R2-ről proxyzzuk ugyanazt a relatív útvonalat
// (uploads/<path> kulcs alatt, lásd server/r2.js localPathToR2Key).
app.get("/uploads/*", async (req, res) => {
  // req.params[0] a "*" által elfogott RELATÍV rész (pl. "avatars/1.png"),
  // NEM req.path — az a teljes "/uploads/avatars/1.png"-t adná vissza,
  // ami duplázott "uploads/uploads/..." R2-kulcsot eredményezne.
  const rel = req.params[0] || "";
  if (rel.includes("..")) return res.status(400).end();
  const R2_PUBLIC = process.env.R2_PUBLIC_URL;
  const key = `uploads/${rel}`;
  try {
    const r2Res = await fetch(`${R2_PUBLIC}/${key}`);
    if (!r2Res.ok) return res.status(404).end();
    res.setHeader("Content-Type", r2Res.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    Readable.fromWeb(r2Res.body).pipe(res);
  } catch {
    res.status(404).end();
  }
});

/* ===== SPA FALLBACK ===== */
// Blog statikus oldalak – NE irányítsa át az index.html-re
app.get("/blog", (req, res) => {
  res.redirect(301, "/blog/");
});
app.get("/blog/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/blog/index.html"));
});
app.get("/blog/:slug", (req, res) => {
  const file = path.join(__dirname, "../public/blog", req.params.slug + ".html");
  res.sendFile(file, err => {
    if (err) res.status(404).sendFile(path.join(__dirname, "../public/index.html"));
  });
});
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

/* ===== HIBAKEZELŐ (mindig a route-ok után) ===== */
app.use(errorHandler);

/* ===== BLOG AUTO-GENERÁTOR CRON (H/Sze/P 10:00) ===== */
// Heti 3 poszt: hétfő, szerda, péntek reggel 10-kor
cron.schedule("0 10 * * 1,3,5", async () => {
  console.log("[BlogCron] Automatikus blog poszt generálás indítása...");
  try {
    const post = await generateBlogPost();
    if (post) {
      console.log(`[BlogCron] Létrehozva: ${post.slug}`);
      await generateSitemap();
    } else console.log("[BlogCron] Nincs új téma a listában.");
  } catch (err) {
    console.error("[BlogCron] Hiba:", err.message);
  }
}, { timezone: "Europe/Budapest" });

/* ===== START SERVER ===== */
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🍆 PadlizsanFanSub running on port ${PORT}`);
  try { await generateSitemap(); } catch (e) { console.error("[Sitemap] Indulási hiba:", e.message); }
});
