/* ── Instagram lapozós történetrészlet (2026-11-15) ──
   Egy mű 1. fejezetéből 3–4 EGYMÁST KÖVETŐ képkocka, mindegyik külön 4:5-ös diára
   szépen körbevágva (elmosott háttér a kocka színeiből), az elején a cím, a végén
   „Folytasd az olvasást” dia a borítóval és a kabalával.
   NE importáld olyan modult, ami a discord-bot.js-t húzza be (parancssorból is fut). */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { pool } from "../db.js";
import { ADULT_GENRE_EXISTS_SQL } from "./age.js";
import { chapterFiles, openaiJson, contactSheet, textImg, ensureFont, cleanDescription } from "./manga-poster.js";
import { r2Fetch, localPathToR2Key } from "../r2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASCOT = path.join(__dirname, "..", "assets", "poster-mascot.png");
const FONT = "Luckiest Guy";
const W = 1080, H = 1350, PW = 1080;   // dia mérete; a lapokat erre a szélességre hozzuk
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ── Mű és fejezet ── */
export async function pickSnippetManga(exclude = []) {
  const { rows } = await pool.query(`
    SELECT m.id, m.slug, m.title
      FROM manga m
     WHERE NOT ${ADULT_GENRE_EXISTS_SQL}
       AND m.cover_url IS NOT NULL
       AND (SELECT count(*) FROM chapter c WHERE c.manga_id = m.id) >= 5
       AND m.slug <> ALL($1::text[])
       AND NOT EXISTS (SELECT 1 FROM ig_snippets s WHERE s.manga_id = m.id AND s.error IS NOT NULL
                          AND s.created_at > now() - interval '30 days')
     ORDER BY (SELECT max(created_at) FROM ig_snippets s WHERE s.manga_id = m.id AND s.ig_media_id IS NOT NULL) NULLS FIRST,
              random()
     LIMIT 1`, [exclude]);
  return rows[0] || null;
}

async function loadFirstChapters(slug, n = 2) {
  const { rows } = await pool.query(`
    SELECT m.id AS manga_id, m.title, m.description, m.cover_url, m.folder AS mf, m.r2_migrated, l.path AS lp, c.folder
      FROM manga m JOIN chapter c ON c.manga_id = m.id JOIN library l ON l.id = c.library_id
     WHERE m.slug = $1 AND (c.unlocks_at IS NULL OR c.unlocks_at <= now())`, [slug]);
  const num = s => parseFloat((String(s).match(/(\d+(?:\.\d+)?)/) || [0, 1e9])[1]);
  return { manga: rows[0], chapters: rows.sort((a, b) => num(a.folder) - num(b.folder)).slice(0, n) };
}

async function loadPage(ch, file) {
  const local = path.join(ch.lp, ch.mf, ch.folder, file);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const r = await r2Fetch(localPathToR2Key(local));
  if (!r.ok) throw new Error(`R2 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ── Képkockák OLVASÁSI SORRENDBEN, laphatáron átnyúló kockák összefűzésével ──
   A lapokat 1080 px szélesre hozzuk és egy folyamatos „csíkba” fűzzük; kockahatár az
   a legalább GAP soros sáv, ahol a sor egyszínű (fehér/fekete köz). */
async function extractSequence(chapters, tmp, maxPanels = 72) {
  const GAP = 14, MAXACC = 7000;
  const panels = [];
  for (const ch of chapters) {
    let acc = Buffer.alloc(0), rowsIn = 0;              // még le nem zárt rész (RGB)
    const flush = async (buf, h) => {
      if (h < 160) return;
      const raw = sharp(buf, { raw: { width: PW, height: h, channels: 3 } });
      let img = await raw.png().toBuffer();
      img = await sharp(img).trim({ threshold: 14 }).toBuffer().catch(() => img);
      const m = await sharp(img).metadata();
      if (m.height < 160 || m.width < PW * 0.4) return;
      const st = await sharp(img).stats();
      if (st.entropy < 3.5) return;                     // szinte üres
      const file = path.join(tmp, `s${String(panels.length).padStart(4, "0")}.jpg`);
      await sharp(img).jpeg({ quality: 92 }).toFile(file);
      panels.push({ file, chapter: ch.folder, w: m.width, h: m.height });
    };
    for (const f of await chapterFiles(ch)) {
      if (panels.length >= maxPanels) break;
      let buf;
      try { buf = await loadPage(ch, f); } catch { continue; }
      const page = await sharp(buf).resize({ width: PW }).removeAlpha().raw().toBuffer({ resolveWithObject: true }).catch(() => null);
      if (!page || page.info.channels !== 3) continue;
      acc = Buffer.concat([acc, page.data]); rowsIn += page.info.height;
      // sorok egyszínűsége
      const empty = new Uint8Array(rowsIn);
      for (let y = 0; y < rowsIn; y++) {
        let mn = 255, mx = 0;
        for (let x = 0; x < PW; x += 4) {
          const i = (y * PW + x) * 3, g = (acc[i] * 3 + acc[i + 1] * 6 + acc[i + 2]) / 10;
          if (g < mn) mn = g; if (g > mx) mx = g;
          if (mx - mn > 14) break;
        }
        empty[y] = mx - mn <= 14 ? 1 : 0;
      }
      // lezárt kockák: nem-üres szakasz (a kis, < GAP közök belül maradnak), amit ≥ GAP üres sor követ
      let y = 0;
      while (y < rowsIn && empty[y]) y++;
      let cut = y, s = y;
      while (y < rowsIn) {
        while (y < rowsIn && !empty[y]) y++;
        const e = y;
        let g = 0; while (y < rowsIn && empty[y]) { y++; g++; }
        if (y >= rowsIn) {                              // a csík végére értünk
          if (g >= GAP) { await flush(acc.subarray(s * PW * 3, e * PW * 3), e - s); cut = rowsIn; }
          break;                                        // különben nyitott → átvisszük (cut = s)
        }
        if (g >= GAP) { await flush(acc.subarray(s * PW * 3, e * PW * 3), e - s); s = y; cut = y; }
      }
      acc = Buffer.from(acc.subarray(cut * PW * 3)); rowsIn -= cut;
      if (rowsIn > MAXACC) { await flush(acc, rowsIn); acc = Buffer.alloc(0); rowsIn = 0; }
    }
    if (rowsIn > 0) await flush(acc, rowsIn);
    if (panels.length >= 12) break;                    // elég az 1. fejezet, ha van benne bőven
  }
  return panels;
}

/* ── AI: 3–4 egymást követő kocka kiválasztása ── */
async function aiChooseSequence(panels, manga) {
  const sheet = await contactSheet(panels);
  const desc = cleanDescription(manga.description).slice(0, 600);
  const out = await openaiJson("gpt-4o", [
    { type: "text", text: `Ez egy manhwa első fejezetének kockái OLVASÁSI SORRENDBEN, sorszámozva (balról jobbra, sorról sorra). Mű: ${manga.title}. Leírás: ${desc}
Egy Instagram lapozós (carousel) poszthoz keress 3 vagy 4 EGYMÁST KÖVETŐ kockát (pl. 12,13,14), amelyek együtt egy kis, önmagában is érthető jelenetet adnak, és kíváncsivá teszik az olvasót (feszült pillanat, poén, rejtélyes fordulat, látványos belépő). Az utolsó kocka legyen „cliffhanger”-szerű, ha lehet.
KIZÁRVA: stáblista/fordítói oldal, vízjel vagy weboldal-cím, üres vagy szinte üres kocka, szexualizált/félmeztelen vagy véres-brutális kocka, nagyon kicsi vagy olvashatatlan kocka.
Adj 3 lehetőséget rangsorolva.
Válasz CSAK JSON: {"options":[{"panels":[szám,...],"why":"rövid indok"}]}` },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + sheet.toString("base64"), detail: "high" } },
  ], 500);
  return (out.options || []).map(o => (o.panels || []).map(Number))
    .filter(a => a.length >= 3 && a.length <= 4 && a.every((n, i) => Number.isInteger(n) && n >= 1 && n <= panels.length && (i === 0 || n === a[i - 1] + 1)));
}

/* Közelről ellenőrzi a kiválasztott sort, és megírja a szöveget. */
async function aiVerify(seq, manga) {
  const imgs = await Promise.all(seq.map(p => sharp(p.file).resize(720, 900, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer()));
  const desc = cleanDescription(manga.description).slice(0, 600);
  const out = await openaiJson("gpt-4o", [
    { type: "text", text: `Ezek egy manhwa (${manga.title}) egymást követő kockái, egy Instagram lapozós poszthoz. Leírás: ${desc}
1) Megfelelő-e: összefüggő, érthető kis jelenet; nincs vízjel, stáblista, szexualizált vagy véres-brutális tartalom; a kockák élesek, a szövegek olvashatók?
2) Ha igen, írj magyarul egy rövid Instagram-szöveget: 1–2 figyelemfelkeltő mondat erről a jelenetről és a műről (ne spoilerezz a jeleneten túl, ne találj ki nem látható dolgot), a végén egy kérdés a követőkhöz. Hashtaget NE írj.
Válasz CSAK JSON: {"ok":true/false,"reason":"...","caption":"..."}` },
    ...imgs.map(b => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + b.toString("base64"), detail: "low" } })),
  ], 500);
  return out;
}

/* ── Diák ── */
async function blurredBg(input) {
  return sharp(input).resize(W, H, { fit: "cover" }).blur(40).modulate({ brightness: 0.45, saturation: 1.1 }).toBuffer();
}

async function panelSlide(p, idx, total, title) {
  ensureFont();
  const top = title ? 190 : 60, bottom = 90;
  const maxW = W - 80, maxH = H - top - bottom;
  const fg = await sharp(p.file).resize(maxW, maxH, { fit: "inside" }).toBuffer({ resolveWithObject: true });
  const fw = fg.info.width, fh = fg.info.height;
  const x = Math.round((W - fw) / 2), y = Math.round(top + (maxH - fh) / 2);
  const layers = [
    { input: { create: { width: fw + 12, height: fh + 12, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }, left: x - 6, top: y - 6 },
    { input: fg.data, left: x, top: y },
  ];
  if (title) {
    const t = await textImg(`<text x="20" y="300" font-family="${FONT}" font-size="230" fill="#ffffff" stroke="#000" stroke-width="10" paint-order="stroke">${esc(title.toUpperCase())}</text>`, W - 120, 120, Math.max(4000, title.length * 240));
    layers.push({ input: t.data, left: Math.round((W - t.info.width) / 2), top: Math.round((top - 30 - t.info.height) / 2) + 10 });
  }
  const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="54"><rect width="120" height="54" rx="27" fill="#000" fill-opacity="0.55"/><text x="60" y="37" font-family="DejaVu Sans" font-weight="bold" font-size="26" fill="#fff" text-anchor="middle">${idx}/${total}</text></svg>`);
  layers.push({ input: pill, left: W - 140, top: H - 72 });
  const site = await textImg(`<text x="20" y="300" font-family="${FONT}" font-size="200"><tspan fill="#c084fc">PADLIZSAN</tspan><tspan fill="#ffffff">FANSUB.HU</tspan></text>`, 420, 40);
  layers.push({ input: site.data, left: 30, top: H - 66 });
  return sharp(await blurredBg(p.file)).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

async function fetchCover(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch {}
  return null;
}

export async function ctaSlide(manga, fallbackFile) {
  ensureFont();
  const cover = (await fetchCover(manga.cover_url)) || fs.readFileSync(fallbackFile);
  const cv = await sharp(cover).resize(560, 760, { fit: "cover" }).toBuffer();
  const layers = [
    { input: { create: { width: 572, height: 772, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }, left: Math.round((W - 572) / 2), top: 200 },
    { input: cv, left: Math.round((W - 560) / 2), top: 206 },
  ];
  const head = await textImg(`<text x="20" y="300" font-family="${FONT}" font-size="230" fill="#ffffff" stroke="#000" stroke-width="10" paint-order="stroke">HOGYAN TOVÁBB?</text>`, W - 160, 110);
  layers.push({ input: head.data, left: Math.round((W - head.info.width) / 2), top: 60 });
  const t = await textImg(`<text x="20" y="300" font-family="${FONT}" font-size="230" fill="#ffffff">${esc(manga.title.toUpperCase())}</text>`, W - 160, 80, Math.max(4000, manga.title.length * 240));
  layers.push({ input: t.data, left: Math.round((W - t.info.width) / 2), top: 1000 });
  const sub = await textImg(`<text x="120" y="300" xml:space="preserve" font-family="${FONT}" font-size="200"><tspan fill="#ffffff">OLVASD MAGYARUL: </tspan><tspan fill="#c084fc">PADLIZSAN</tspan><tspan fill="#ffffff">FANSUB.HU</tspan></text>`, W - 380, 52, 6000);
  const mas = await sharp(MASCOT).resize({ height: 230 }).png().toBuffer({ resolveWithObject: true });
  layers.push({ input: mas.data, left: 40, top: H - mas.info.height - 20 });
  layers.push({ input: sub.data, left: 40 + mas.info.width + 36, top: 1120 });
  const link = await textImg(`<text x="20" y="300" font-family="DejaVu Sans" font-weight="bold" font-size="160" fill="#ffffff">🔗 link a bióban</text>`, 420, 46);
  layers.push({ input: link.data, left: 40 + mas.info.width + 36, top: 1200 });
  return sharp(await blurredBg(cover)).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/* ── Teljes folyamat: diák + szöveg ── */
export async function generateSnippet(slug, { avoid = [] } = {}) {
  const { manga, chapters } = await loadFirstChapters(slug);
  if (!manga || !chapters.length) throw new Error("nincs olvasható fejezet");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "padli-snippet-"));
  try {
    const panels = await extractSequence(chapters, tmp);
    if (panels.length < 8) throw new Error(`kevés képkocka (${panels.length})`);
    // Újragenerálásnál a korábban használt kockák kerülendők
    const avoidIdx = new Set(avoid.map(a => parseInt(String(a).match(/s(\d{4})\.jpg$/)?.[1] ?? "-1", 10) + 1));
    const options = (await aiChooseSequence(panels, manga)).filter(o => !o.some(n => avoidIdx.has(n)));
    if (!options.length) throw new Error("az AI nem talált megfelelő jelenetet");
    let seq = null, verdict = null;
    for (const opt of options) {
      const cand = opt.map(n => panels[n - 1]);
      verdict = await aiVerify(cand, manga);
      if (verdict.ok && verdict.caption) { seq = cand; break; }
      console.warn("[ig-snippet] elvetve:", opt.join(","), verdict.reason);
    }
    if (!seq) throw new Error("egyik jelenet sem ment át az ellenőrzésen");
    const total = seq.length + 1;
    const slides = [];
    for (let i = 0; i < seq.length; i++) slides.push(await panelSlide(seq[i], i + 1, total, i === 0 ? manga.title : null));
    slides.push(await ctaSlide(manga, seq[0].file));
    const caption = `📖 ${manga.title}\n\n${String(verdict.caption).trim()}\n\n👉 Lapozz! A folytatás magyarul a padlizsanfansub.hu-n — link a bióban.\n\n#manhwa #manga #webtoon #magyarmanga #mangamagyarul #PadlizsanFanSub`;
    return { manga: { ...manga, id: manga.manga_id, slug }, slides, caption, panels: seq.map(p => `${p.chapter}#${path.basename(p.file)}`), totalPanels: panels.length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* Több próbával (más művel), a sikertelen próbák naplózva. */
export async function buildSnippet({ slug = null, exclude = [], avoid = [] } = {}) {
  const tried = [...exclude];
  let lastErr;
  for (let i = 0; i < (slug ? 1 : 3); i++) {
    const m = slug ? { slug } : await pickSnippetManga(tried);
    if (!m) break;
    try { return await generateSnippet(m.slug, { avoid }); }
    catch (e) {
      lastErr = e; tried.push(m.slug);
      console.warn(`[ig-snippet] ${m.slug}: ${e.message}`);
      if (m.id) await pool.query("INSERT INTO ig_snippets (manga_id, status, error) VALUES ($1, 'failed', $2)", [m.id, e.message.slice(0, 500)]).catch(() => {});
    }
  }
  throw lastErr || new Error("nincs megfelelő mű");
}
