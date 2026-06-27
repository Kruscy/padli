import express from "express";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { pool } from "../db.js";
import { r2, BUCKET, localPathToR2Key } from "../r2.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import OpenAI from "openai";

const router = express.Router();

const MANGA_ID = 491242;
const LIBRARY_ID = 1;
const MANGA_FOLDER = "FansubÉlet";
const LIBRARY_PATH = "/mnt/manga/Kavita/Ascyra";

// Karakterek + setting szöveg a prompt elejére (rövidítve, hogy ne nyomja el a scene leírást)
const CHAR_STYLE = `Full-color Korean webtoon / manhwa style illustration. Vibrant colors, clean cel-shading, sharp lineart, highly expressive anime faces. All characters are male anime style.`;

function requireAdmin(req, res, next) {
  if (req.session?.user?.role !== "admin")
    return res.status(403).json({ error: "Csak admin" });
  next();
}

router.use(requireAdmin);

/* ── GET /characters ─────────────────────────────────────── */
router.get("/characters", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, visual_description, active FROM fansub_characters ORDER BY id`
  );
  res.json(rows);
});

/* ── POST /characters ────────────────────────────────────── */
router.post("/characters", express.json(), async (req, res) => {
  const { name, visual_description } = req.body;
  if (!name || !visual_description)
    return res.status(400).json({ error: "name és visual_description kötelező" });
  const { rows } = await pool.query(
    `INSERT INTO fansub_characters (name, visual_description) VALUES ($1, $2) RETURNING *`,
    [name.trim(), visual_description.trim()]
  );
  res.json(rows[0]);
});

/* ── PUT /characters/:id ─────────────────────────────────── */
router.put("/characters/:id", express.json(), async (req, res) => {
  const { name, visual_description, active } = req.body;
  const { rows } = await pool.query(
    `UPDATE fansub_characters SET name=COALESCE($1,name), visual_description=COALESCE($2,visual_description), active=COALESCE($3,active)
     WHERE id=$4 RETURNING *`,
    [name?.trim() || null, visual_description?.trim() || null, active ?? null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Nem található" });
  res.json(rows[0]);
});

/* ── DELETE /characters/:id ──────────────────────────────── */
router.delete("/characters/:id", async (req, res) => {
  await pool.query(`UPDATE fansub_characters SET active=false WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

/* ── GET /setting ────────────────────────────────────────── */
router.get("/setting", async (req, res) => {
  const { rows } = await pool.query(`SELECT description FROM fansub_setting WHERE id=1`);
  res.json({ description: rows[0]?.description || "" });
});

/* ── PUT /setting ────────────────────────────────────────── */
router.put("/setting", express.json(), async (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: "description kötelező" });
  await pool.query(
    `INSERT INTO fansub_setting (id, description, updated_at) VALUES (1,$1,NOW())
     ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, updated_at=NOW()`,
    [description.trim()]
  );
  res.json({ ok: true });
});

/* ── Karakterek + setting lekérése ───────────────────────── */
async function getCharAndSetting() {
  const { rows: chars } = await pool.query(
    `SELECT name, visual_description FROM fansub_characters WHERE active=true ORDER BY id`
  );
  const { rows: settingRows } = await pool.query(`SELECT description FROM fansub_setting WHERE id=1`);
  const setting = settingRows[0]?.description || "";
  const charList = chars.map(c => `${c.name}: ${c.visual_description}`).join("; ");
  return { charList, setting };
}

/* ── Panel prompt összerakása ────────────────────────────── */
function buildPanelPrompt({ scene, style, charList, setting, isFirst, isLast }) {
  const titleNote = isFirst ? `\nFirst panel: title banner "FANSUB ÉLET - 7. RÉSZ" at the top.` : "";
  const endNote = isLast ? `\nLast panel: "FOLYTATJUK..." text in the corner.` : "";
  return `${CHAR_STYLE}${style ? ` Art style for THIS panel: ${style}.` : ""}

SETTING: ${setting}

CHARACTERS (show name label above each character): ${charList}

SCENE: ${scene}${titleNote}${endNote}

Speech bubbles and sticky notes with Hungarian text. Neon purple "FANSUB ÉLET" sign in background. Energy drinks, manga pages, anime figurines visible. Chaotic fun fansub office mood.`.trim();
}

/* ── Egy panel generálása ────────────────────────────────── */
async function generatePanel(openai, prompt) {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "high",
  });
  const b64 = response.data[0].b64_json;
  if (!b64) throw new Error("Üres válasz az API-tól");
  return Buffer.from(b64, "base64");
}

/* ── Panelek függőleges összefűzése sharp-pal ────────────── */
async function stitchPanels(buffers) {
  const WIDTH = 1024;
  // Minden panelt azonos szélességre méretezünk, magasság arányos
  const resized = await Promise.all(
    buffers.map(buf =>
      sharp(buf).resize({ width: WIDTH, withoutEnlargement: false }).png().toBuffer()
        .then(b => sharp(b).metadata().then(m => ({ buf: b, h: m.height })))
    )
  );
  const totalHeight = resized.reduce((sum, r) => sum + r.h, 0);
  // Összerakjuk vertikálisan
  const composite = [];
  let y = 0;
  for (const r of resized) {
    composite.push({ input: r.buf, top: y, left: 0 });
    y += r.h;
  }
  return sharp({
    create: { width: WIDTH, height: totalHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composite)
    .png()
    .toBuffer();
}

/* ── POST /generate ──────────────────────────────────────── */
router.post("/generate", express.json(), async (req, res) => {
  if (!process.env.OPENAI_API_KEY)
    return res.status(503).json({ error: "OPENAI_API_KEY nincs beállítva a .env-ben" });

  const { chapter_name, pages } = req.body;
  if (!chapter_name || !Array.isArray(pages) || pages.length === 0)
    return res.status(400).json({ error: "chapter_name és pages[] kötelező" });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { charList, setting } = await getCharAndSetting();

  const chapterPath = path.join(LIBRARY_PATH, MANGA_FOLDER, chapter_name);
  fs.mkdirSync(chapterPath, { recursive: true });

  const panelBuffers = [];
  const errors = [];

  // Minden panel külön API hívás
  for (let i = 0; i < pages.length; i++) {
    const { prompt: scene, style } = pages[i];
    const prompt = buildPanelPrompt({
      scene: scene || "",
      style: style || "",
      charList,
      setting,
      isFirst: i === 0,
      isLast: i === pages.length - 1,
    });
    try {
      console.log(`[fansub] Panel ${i + 1}/${pages.length} generálása...`);
      const buf = await generatePanel(openai, prompt);
      panelBuffers.push(buf);
      // Ideiglenes panel mentése (debug)
      fs.writeFileSync(path.join(chapterPath, `panel_${String(i+1).padStart(2,"0")}.png`), buf);
    } catch (err) {
      console.error(`[fansub] Panel ${i + 1} hiba:`, err.message);
      errors.push({ page: i + 1, error: err.message });
    }
  }

  if (panelBuffers.length === 0) {
    return res.json({ ok: false, chapter: chapter_name, generated: 0, errors, pages: [] });
  }

  // Panelek összefűzése egy tall képpé
  let finalBuffer;
  if (panelBuffers.length === 1) {
    finalBuffer = panelBuffers[0];
  } else {
    console.log(`[fansub] ${panelBuffers.length} panel összefűzése...`);
    finalBuffer = await stitchPanels(panelBuffers);
  }

  // Végső fájl mentése
  const finalFilename = "001.png";
  const finalPath = path.join(chapterPath, finalFilename);
  fs.writeFileSync(finalPath, finalBuffer);

  // R2 feltöltés (csak a végső összefűzött kép)
  const r2Key = localPathToR2Key(finalPath);
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: r2Key, Body: finalBuffer, ContentType: "image/png",
  }));
  console.log(`[fansub] R2-re feltöltve: ${r2Key}`);

  // Ideiglenes panel fájlok törlése
  for (let i = 0; i < pages.length; i++) {
    const tmp = path.join(chapterPath, `panel_${String(i+1).padStart(2,"0")}.png`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }

  // DB chapter rekord
  await pool.query(
    `INSERT INTO chapter (manga_id, title, folder, library_id, scanned_at)
     VALUES ($1, $2, $2, $3, NOW())
     ON CONFLICT (manga_id, folder) DO NOTHING`,
    [MANGA_ID, chapter_name, LIBRARY_ID]
  );

  res.json({
    ok: errors.length === 0,
    chapter: chapter_name,
    generated: panelBuffers.length,
    stitched: panelBuffers.length > 1,
    errors,
    pages: [{ page: 1, filename: finalFilename, r2Key }],
    r2PublicUrl: process.env.R2_PUBLIC_URL || "",
  });
});

export default router;
