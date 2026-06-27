import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import routes from "./routes.js";
import userRoutes from "./routes/user.js";
import { activityTracker } from "./middleware/activity.js";
import "./discord-bot.js";

const PgSession = connectPgSimple(session);

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";
app.set("trust proxy", 1);
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

/* ===== SECURITY HEADERS ===== */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'sha256-KbDJwwq2mVzpJQquothLjsd2EGAi2C42lhXRTSlCHJ8='",
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
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: false, // Cloudflare kezeli, kettős header elkerülése
  crossOriginOpenerPolicy: isProd ? { policy: "same-origin" } : false,
  originAgentCluster: isProd,
}));

app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=()"
  );
  next();
});

/* ===== RATE LIMITING ===== */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Túl sok próbálkozás, kérjük várj 15 percet." },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);

/* ===== WEBHOOK ENDPOINTOK - raw body kell, ezért json() ELÉ ===== */
app.use("/api/shop/webhook", express.raw({ type: "application/json" }));
app.use("/api/patreon/webhook", express.raw({ type: "application/json" }));
/* ===== BODY PARSER ===== */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: false }));
/* ===== SESSION (AUTH) ===== */
app.use(
  session({
    store: new PgSession({
      conString: `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE}`,
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
  })
);

/* ===== BUILD VERSION (cache busting) ===== */
import { readFileSync, existsSync } from "fs";
const BUILD_VER = Date.now().toString(36);
const PUBLIC_DIR = path.join(__dirname, "../public");

function injectVersion(html) {
  return html.replace(/(href|src)="(\/(?:css|js)\/[^"]+)"/g, (_, attr, url) =>
    `${attr}="${url}${url.includes("?") ? "&" : "?"}v=${BUILD_VER}"`
  );
}

/* ===== STATIC FRONTEND ===== */
app.use('/downloads', express.static(path.join(PUBLIC_DIR, 'downloads')));

// Minden .html kérést verzióval szolgálunk ki
app.use((req, res, next) => {
  if (!req.path.endsWith(".html")) return next();
  const filePath = path.join(PUBLIC_DIR, req.path);
  if (!existsSync(filePath)) return next();
  try {
    const html = injectVersion(readFileSync(filePath, "utf8"));
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch { next(); }
});

app.use(express.static(PUBLIC_DIR));
app.use(activityTracker);

/* ===== API ROUTES ===== */
app.use("/api", routes);
app.use("/api/user", userRoutes);
app.use("/uploads", express.static("uploads"));

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

/* ===== START SERVER ===== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🍆 PadlizsanFanSub running on port ${PORT}`);
});
