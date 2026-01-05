import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";

// ES module kompatibilitás (__dirname pótlása)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---------- MIDDLEWARE ----------

// JSON body (később jól jön)
app.use(express.json());

// ---------- STATIC FILES ----------

// Manga képek
app.use(
  "/images",
  express.static(path.join(__dirname, "../images"), {
    maxAge: "1y",
    immutable: true
  })
);

// Frontend (HTML, JS)
app.use(
  express.static(path.join(__dirname, "../public"))
);

// ---------- API ROUTES ----------
app.use("/api", routes);

// ---------- FALLBACK ----------
// Ha nem API és nem statikus fájl → index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
