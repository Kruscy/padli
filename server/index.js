xpress from "express";
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
app.use(
  "/images",
  express.static(MANGA_ROOT, {
    maxAge: "1y",
    immutable: true
  })
);

app.use(express.static(path.join(__dirname, "../public")));

// ---------- API ----------
app.use("/api", routes);

<<<<<<< HEAD
// ---------- FALLBACK ----------
=======
// ---------- FALLBACK (FIXED) ----------
>>>>>>> 455b577 (Initial PadlizsanFanSub manga reader)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("=================================");
  console.log(` ^|^e Server running at http://localhost:${PORT}`);
  console.log(` ^=^s^a Manga root: ${MANGA_ROOT}`);
  console.log("=================================");
