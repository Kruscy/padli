import sharp from "sharp";

/* ── Fejezetoldalak tömörítése feltöltéskor ───────────────────
   JPEG → JPEG (mozjpeg), a fájlnév és a formátum NEM változik: a
   hibajegyek (bug_reports/bug_fixes.image_file) fájlnévre hivatkoznak,
   a PadliCrome a kiterjesztésből dönti el a MIME-t, az olvasó a
   fájlnév szerint rendez. WebP azért nem, mert nem tömörít jobban
   (mintán −60% vs −61%), és max. 16 383 px magas lehet — nálunk van
   43 000 px-es webtoon-csík is.

   Csak akkor cseréljük az eredetit, ha legalább MIN_SAVING-gel kisebb
   lett: a már jól tömörített kép újrakódolása csak rontana rajta.
   Bármilyen hiba esetén az eredeti marad — a feltöltés sosem bukhat
   el a tömörítés miatt. ── */

const QUALITY = 82;
const MAX_WIDTH = 1600;     // az olvasó max. 900 CSS px-en mutatja, retinán ~1800
const MIN_BYTES = 150 * 1024;
const MIN_SAVING = 0.15;
const MAX_PIXELS = 150_000_000;
const MAX_CONCURRENT = 2;   // 2 magos gép: a párhuzamos feltöltések ne fojtsák meg
// Ha ennyi kép már vár, a következő tömörítetlenül megy fel: a kliens 45 mp
// válasz nélkül megszakítja a kérést (uploader.js STALL_MS), a kimaradtakat
// a visszamenőleges tömörítés úgyis pótolja.
const MAX_WAITING = 8;

let active = 0;
const waiting = [];

// A felszabaduló helyet közvetlenül a következő várakozó kapja meg, így egy
// közben érkező új kérés nem előzheti meg (és nem fut MAX_CONCURRENT-nél több).
async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

const stats = { compressed: 0, kept: 0, before: 0, after: 0 };

function logStats() {
  const mb = n => (n / 1024 / 1024).toFixed(1);
  console.log(`[képtömörítés] ${stats.compressed} tömörítve (${mb(stats.before)} → ${mb(stats.after)} MB), ${stats.kept} változatlan`);
}

/**
 * @param {Buffer} buffer - a feltöltött kép
 * @param {string} filename - a cél fájlneve (a kiterjesztés dönt)
 * @returns {Promise<{ buffer: Buffer, changed: boolean, reason?: string }>}
 */
export async function compressPageImage(buffer, filename) {
  if (!/\.jpe?g$/i.test(filename)) return { buffer, changed: false, reason: "nem JPEG" };
  if (buffer.length < MIN_BYTES) return { buffer, changed: false, reason: "kicsi" };
  if (waiting.length >= MAX_WAITING) return { buffer, changed: false, reason: "túlterhelt" };

  try {
    return await withSlot(async () => {
      const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
      // .jpg névvel feltöltött PNG/WebP: nem nyúlunk hozzá
      if (meta.format !== "jpeg") return { buffer, changed: false, reason: `tartalom: ${meta.format}` };
      if (meta.width * meta.height > MAX_PIXELS) return { buffer, changed: false, reason: "túl nagy felbontás" };

      // EXIF-forgatás: a kimenetből a metaadat kimarad, ezért előtte alkalmazzuk
      const rotated = (meta.orientation || 1) >= 5;
      const srcWidth = rotated ? meta.height : meta.width;
      const srcHeight = rotated ? meta.width : meta.height;
      const width = Math.min(srcWidth, MAX_WIDTH);
      const height = Math.round(srcHeight * (width / srcWidth));

      let img = sharp(buffer, { limitInputPixels: false }).rotate();
      if (srcWidth > MAX_WIDTH) img = img.resize({ width: MAX_WIDTH });
      const out = await img.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();

      // Ellenőrzés: olvasható, a várt méretű, és tényleg kisebb
      const check = await sharp(out, { limitInputPixels: false }).metadata();
      if (check.format !== "jpeg" || check.width !== width || Math.abs(check.height - height) > 1) {
        return { buffer, changed: false, reason: "ellenőrzés sikertelen" };
      }
      if (out.length > buffer.length * (1 - MIN_SAVING)) {
        stats.kept++;
        return { buffer, changed: false, reason: "nem lett elég kisebb" };
      }

      stats.compressed++;
      stats.before += buffer.length;
      stats.after += out.length;
      if (stats.compressed % 50 === 0) logStats();
      return { buffer: out, changed: true };
    });
  } catch (err) {
    console.warn("[képtömörítés] hiba, az eredeti marad:", filename, err.message);
    return { buffer, changed: false, reason: "hiba" };
  }
}
