import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ES module dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static frontend
app.use(express.static(path.join(__dirname, "../public")));

// API routes
app.use("/api", routes);

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 PadlizsanFanSub running on port ${PORT}`);
});
