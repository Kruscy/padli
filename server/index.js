import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import routes from "./routes.js";
import userRoutes from "./routes/user.js";
import { activityTracker } from "./middleware/activity.js";
import "./discord-bot.js";

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);
/* ===== ES MODULE __dirname FIX ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== BODY PARSER ===== */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: false }));
/* ===== settings ===== */
/* ===== SESSION (AUTH) ===== */
app.use(
  session({
    name: "padlizsan.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    },
  })
);

/* ===== STATIC FRONTEND ===== */
app.use('/downloads', express.static(path.join(__dirname, '../public/downloads')));
app.use(express.static(path.join(__dirname, "../public")));
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
