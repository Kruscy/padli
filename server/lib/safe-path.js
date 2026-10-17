import path from "path";
import sharp from "sharp";
import { pool } from "../db.js";

/* ── Biztonságos fájlútvonalak ────────────────────────────────
   A bugfix- és PadliCrome-folyamatban a manga-slug, fejezet- és fájlnév
   kliensből (kérés törzséből / URL-ből) érkezett, és ellenőrzés nélkül
   került path.join()-ba — "../" részekkel a szerver bármely fájlját
   felül lehetett írni vagy törölni. Minden ilyen művelet ezeken a
   függvényeken megy át. ── */

// A bugfix-javítások átmeneti (jóváhagyásra váró) mappája
export const BUGFIX_STAGING_DIR = path.join(process.cwd(), "uploads", "bugs", "javitott");
const BUGFIX_URL_PREFIX = "/uploads/bugs/javitott/";

// Egyetlen útvonal-szegmens (mappa- vagy fájlnév) — nincs benne elválasztó,
// nem "." / "..", nincs NUL-bájt, észszerű hosszú.
export function isSafeName(name) {
  return typeof name === "string"
    && name.length > 0 && name.length <= 255
    && name !== "." && name !== ".."
    && !/[\/\\\0]/.test(name);
}

// A base mappán BELÜLI abszolút útvonal, vagy null, ha a szegmensek
// kivezetnének belőle (vagy valamelyik nem string).
export function resolveInside(base, ...segments) {
  if (segments.some(s => typeof s !== "string")) return null;
  const root = path.resolve(base);
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

// Egy bug_fixes.fixed_image_url ("/uploads/bugs/javitott/<slug>/<fejezet>/<fájl>")
// lemezen lévő helye — csak ha tényleg az átmeneti mappán belül van.
export function stagedFixPath(fixedImageUrl) {
  if (typeof fixedImageUrl !== "string" || !fixedImageUrl.startsWith(BUGFIX_URL_PREFIX)) return null;
  const parts = fixedImageUrl.slice(BUGFIX_URL_PREFIX.length).split("/");
  if (parts.length !== 3 || !parts.every(isSafeName)) return null;
  return resolveInside(BUGFIX_STAGING_DIR, ...parts);
}

// Létező manga + fejezet a DB-ben (slug + fejezetmappa) — a hozzá tartozó
// fizikai mappával, vagy null. A nevek ellenőrzése is itt történik.
export async function findChapter(mangaSlug, chapter) {
  if (!isSafeName(mangaSlug) || !isSafeName(chapter)) return null;
  const { rows } = await pool.query(
    `SELECT l.path AS library_path, l.name AS library_name, m.folder AS manga_folder
     FROM manga m
     JOIN chapter c ON c.manga_id = m.id AND c.folder = $2
     JOIN library l ON l.id = c.library_id
     WHERE m.slug = $1
     LIMIT 1`,
    [mangaSlug, chapter]
  );
  if (!rows.length) return null;
  const { library_path, library_name, manga_folder } = rows[0];
  const dir = resolveInside(library_path, manga_folder, chapter);
  if (!dir) return null;
  return { library_path, library_name, manga_folder, dir };
}

// A feltöltött bájtok tényleg kép-e (a kliens által küldött mimetype-ra
// nem hagyatkozunk).
const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif"]);
export async function isImageBuffer(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return IMAGE_FORMATS.has(meta.format);
  } catch {
    return false;
  }
}
