/* ── Borítókép-feldolgozás (2026-11-08) ───────────────────────
   A feltöltött borítók eddig változatlanul (PNG, átlag 1,6 MB, max 2,9 MB)
   kerültek az uploads/-ba, és a szerverünkön keresztül mentek ki — a
   kezdőlap „Új mangák” sora így ~45 MB volt. Most WebP-re alakítjuk
   (max 460×690, az arány megmarad), és az R2-re töltjük: a böngésző
   közvetlenül onnan kapja, nem rajtunk keresztül.
   Az R2-kulcs egyedi (időbélyeg), mert az R2-objektumok egy évig
   gyorsítótárazhatók — azonos néven a régi kép ragadna be. ── */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET } from "../r2.js";

const MAX_W = 460, MAX_H = 690, QUALITY = 82;

export async function coverToWebp(input) {
  return sharp(input, { failOn: "none" })
    .rotate() // EXIF-forgatás
    .resize({ width: MAX_W, height: MAX_H, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();
}

const safeName = s => String(s || "cover").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "cover";

/* Buffer → R2 (covers/<slug>-<ts>.webp). Visszaad: publikus URL.
   Ha az R2 nem elérhető: helyi uploads/cover-<ts>.webp (a régi útvonal). */
export async function storeCover(buffer, slug) {
  const webp = await coverToWebp(buffer);
  const key = `covers/${safeName(slug)}-${Date.now()}.webp`;
  const publicBase = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
  try {
    if (!publicBase || !BUCKET) throw new Error("R2 nincs beállítva");
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: webp,
      ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable",
    }));
    return { url: `${publicBase}/${key}`, bytes: webp.length };
  } catch (err) {
    console.warn(`[cover] R2-feltöltés sikertelen, helyi mentés: ${err.message}`);
    const name = `cover-${Date.now()}.webp`;
    fs.writeFileSync(path.join("uploads", name), webp);
    return { url: `/uploads/${name}`, bytes: webp.length };
  }
}

/* multer által lementett fájl feldolgozása; az eredeti ideiglenes fájl törlődik. */
export async function processUploadedCover(file, slug) {
  try {
    const buf = fs.readFileSync(file.path);
    return await storeCover(buf, slug);
  } finally {
    fs.promises.unlink(file.path).catch(() => {});
  }
}

/* Blog-borító: a képgenerátor 1536×1024-es PNG-t ad (~3 MB). JPEG-be
   alakítjuk 1200 px szélesre (a Facebook/Discord előnézet is ezt szereti,
   a WebP-t nem mindenhol jeleníti meg), és R2-re töltjük. */
export async function storeBlogCover(buffer, slug) {
  const jpg = await sharp(buffer, { failOn: "none" })
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  const key = `blog-covers/${safeName(slug)}-${Date.now()}.jpg`;
  const publicBase = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
  try {
    if (!publicBase || !BUCKET) throw new Error("R2 nincs beállítva");
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: jpg,
      ContentType: "image/jpeg", CacheControl: "public, max-age=31536000, immutable",
    }));
    return { url: `${publicBase}/${key}`, bytes: jpg.length };
  } catch (err) {
    console.warn(`[cover] blog-borító R2-feltöltés sikertelen, helyi mentés: ${err.message}`);
    fs.mkdirSync(path.join("uploads", "blog-covers"), { recursive: true });
    const name = `${safeName(slug)}.jpg`;
    fs.writeFileSync(path.join("uploads", "blog-covers", name), jpg);
    return { url: `/uploads/blog-covers/${name}`, bytes: jpg.length };
  }
}
