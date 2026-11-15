// Manga-poszter kézzel (2026-11-15)
//   node server/scripts/manga-poster.js [slug] [--out=/útvonal/poszter.jpg]   → csak elkészíti, nem posztol
//   node server/scripts/manga-poster.js [slug] --post                         → ki is teszi a Facebookra
// slug nélkül a heti választó dönt (nem 18+, még nem volt).
import "dotenv/config";
import fs from "fs";
import { pool } from "../db.js";
import { runWeeklyPoster } from "../lib/manga-poster.js";

const args = process.argv.slice(2);
const post = args.includes("--post");
const slug = args.find(a => !a.startsWith("--")) || null;
const outArg = args.find(a => a.startsWith("--out="));

try {
  const res = await runWeeklyPoster({ post, slug });
  const out = outArg ? outArg.slice(6) : `/tmp/poster-${res.manga.slug}.jpg`;
  fs.writeFileSync(out, res.image);
  console.log("Mű:", res.title);
  console.log("Kockák:", res.panels.join(" | "), `(${res.totalPanels} kockából)`);
  console.log("Kép:", out);
  console.log("Facebook:", res.fbId || "(nem posztolva — --post kapcsolóval megy ki)");
  console.log("--- szöveg ---\n" + res.caption);
  await pool.end();
  process.exit(0);
} catch (e) {
  console.error("Hiba:", e.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
