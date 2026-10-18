/* ── Telepítésfüggő mappák ─────────────────────────────────────
   Az eredeti telepítés útvonalai az alapértékek; más telepítésen
   környezeti változóval állíthatók (lásd .env.example). ── */
import path from "path";

// A feltöltők mappáinak gyökere (uploader_root relatív útvonalai ehhez képest)
export const UPLOADER_BASE_DIR = path.resolve(process.env.UPLOADER_BASE_DIR || "/mnt/manga/Kavita");

// Ha nincs libraries.json (vagy egyik könyvtára sem létezik), a scan ezt az
// egy könyvtárat olvassa: MANGA_ROOT alatt mangánként egy mappa
export const DEFAULT_LIBRARY = {
  id: "default",
  name: process.env.LIBRARY_NAME || "Manga",
  path: path.resolve(process.env.LIBRARY_DIR || process.env.MANGA_ROOT || "/mnt/manga"),
  enabled: true,
};
