/* ── Telepítésfüggő mappák ─────────────────────────────────────
   Az eredeti telepítés útvonalai az alapértékek; más telepítésen
   környezeti változóval állíthatók (lásd .env.example). ── */
import path from "path";
import { fileURLToPath } from "url";

// A projekt gyökere (az eredeti telepítésen /opt/padli, Dockerben /app)
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LOGS_DIR = path.resolve(process.env.LOGS_DIR || path.join(APP_ROOT, "logs"));

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
