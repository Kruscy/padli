import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* A „legújabb mangák” cache-t a scan.js külön folyamatként építi fel, ezért
   memóriában nem érné el a webszervert — JSON-fájlon keresztül adjuk át
   (server/cache/new-manga.json, git-ignorált). A webszerver a fájl
   módosítási ideje alapján csak változáskor olvassa újra. */
const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "new-manga.json");

let memo = { mtimeMs: 0, data: null };

export function getNewMangaCache() {
  try {
    const { mtimeMs } = fs.statSync(CACHE_FILE);
    if (mtimeMs !== memo.mtimeMs) {
      memo = { mtimeMs, data: JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) };
    }
    return memo.data;
  } catch {
    return memo.data; // nincs még fájl vagy olvasási hiba → a legutóbbi ismert adat
  }
}

export function setNewMangaCache(data) {
  // Atomikus csere: a webszerver soha ne lásson félig kiírt fájlt
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, CACHE_FILE);
  memo = { mtimeMs: fs.statSync(CACHE_FILE).mtimeMs, data };
}
