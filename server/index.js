import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---------- CONFIG ----------
const MANGA_ROOT = "/mnt/manga/teszt";

// ---------- MIDDLEWARE ----------
app.use(express.json());

// ---------- STATIC FILES ----------
// Manga képek kiszolgálása
app.use(
  "/images",
  express.static(MANGA_ROOT, {
    maxAge: "1y",
    immutable: true
  })
);

// Frontend
app.use(express.static(path.join(__dirname, "../public")));

// ---------- API ----------
app.use("/api", routes);

// ---------- FALLBACK ----------
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("=================================");
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Manga root: ${MANGA_ROOT}`);
  console.log("=================================");
});

