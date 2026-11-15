/* ── Heti manga-poszter (2026-11-15) ─────────────────────────────
   Egy fent lévő mű első fejezeteiből képregény-szerű ajánló-posztert
   készít (1080×1350, Facebook 4:5), és kiteszi a Facebook-oldalra.

   1. Az első 4 (szabadon olvasható) fejezet oldalait képkockákra vágja
      (a kockák közti egyszínű sávok mentén).
   2. Előszűr (élesség, részletgazdagság, arány), a legjobb 48-ból egy
      számozott áttekintőt készít, és abból AI (gpt-4o) választ 5-öt —
      vízjeles / stáblistás / szöveges / kihívó kockák nélkül.
   3. Cím (Luckiest Guy), kockák arány szerint elosztva, kabala + felirat.
   A nyilvántartás a manga_posters táblában van (egy mű csak egyszer
   kerül sorra, amíg van még ki nem rakott mű). ── */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { pool } from "../db.js";
import { listFiles, r2Fetch, localPathToR2Key } from "../r2.js";
import { ADULT_GENRE_EXISTS_SQL } from "./age.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");
const MASCOT = path.join(ASSETS, "poster-mascot.png");
const FONT_FILE = path.join(ASSETS, "fonts", "LuckiestGuy-Regular.ttf");
const FONT = "Luckiest Guy";
const SITE = "https://padlizsanfansub.hu";
const GRAPH = "https://graph.facebook.com/v21.0";
const W = 1080, H = 1350, BORDER = 5, GAP = 16, PICKS = 5;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* A cím betűtípusa: a librsvg a fontconfigból tölti, ezért telepítjük, ha hiányzik. */
function ensureFont() {
  try {
    if (execFileSync("fc-list", [FONT], { encoding: "utf8" }).trim()) return;
    const dir = path.join(os.homedir(), ".local/share/fonts");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(FONT_FILE, path.join(dir, path.basename(FONT_FILE)));
    execFileSync("fc-cache", ["-f", dir]);
    console.log("[poster] betűtípus telepítve:", dir);
  } catch (e) {
    console.warn("[poster] betűtípus-ellenőrzés sikertelen:", e.message);
  }
}

/* ── Mű kiválasztása: nem 18+, van borító, ≥5 fejezet, még nem volt ── */
export async function pickManga(exclude = []) {
  const { rows } = await pool.query(`
    SELECT m.id, m.slug, m.title
      FROM manga m
     WHERE NOT ${ADULT_GENRE_EXISTS_SQL}
       AND m.cover_url IS NOT NULL
       AND (SELECT count(*) FROM chapter c WHERE c.manga_id = m.id) >= 5
       AND m.slug <> ALL($1::text[])
       -- 30 napon belül sikertelen próba → most kihagyjuk
       AND NOT EXISTS (SELECT 1 FROM manga_posters p WHERE p.manga_id = m.id AND p.error IS NOT NULL
                          AND p.created_at > now() - interval '30 days')
     ORDER BY (SELECT max(created_at) FROM manga_posters p WHERE p.manga_id = m.id AND p.fb_post_id IS NOT NULL) NULLS FIRST,
              random()
     LIMIT 1`, [exclude]);
  return rows[0] || null;
}

/* ── 1. Képkockák ─────────────────────────────────────────── */
function splitRows(grey, w, h) {
  const out = []; let start = null;
  for (let y = 0; y <= h; y++) {
    let empty = true;
    if (y < h) {
      let min = 255, max = 0;
      for (let x = 0; x < w; x += 2) { const v = grey[y * w + x]; if (v < min) min = v; if (v > max) max = v; }
      empty = max - min < 18;
    }
    if (!empty && start === null) start = y;
    if (empty && start !== null) { out.push([start, y]); start = null; }
  }
  return out;
}

async function loadChapters(slug, nChap) {
  const { rows } = await pool.query(`
    SELECT m.title, m.description, m.cover_url, m.folder AS mf, m.r2_migrated, l.path AS lp, c.folder
      FROM manga m JOIN chapter c ON c.manga_id = m.id JOIN library l ON l.id = c.library_id
     WHERE m.slug = $1 AND (c.unlocks_at IS NULL OR c.unlocks_at <= now())`, [slug]);
  const num = s => parseFloat((String(s).match(/(\d+(?:\.\d+)?)/) || [0, 1e9])[1]);
  const all = rows.sort((a, b) => num(a.folder) - num(b.folder));
  // Szétszórva a mű első ~60%-ából (2026-11-15): az első pár fejezetben a főszereplő
  // gyakran még gyerek / más alakban van (pl. The Beginning After The End), a vége spoileres.
  let idx = [...new Set([0, 0.2, 0.4, 0.6].slice(0, nChap).map(f => Math.round(f * (all.length - 1))))];
  for (let i = 0; idx.length < Math.min(nChap, all.length) && i < all.length; i++) if (!idx.includes(i)) idx.push(i);
  idx.sort((a, b) => a - b);
  return { manga: rows[0], chapters: idx.map(i => all[i]) };
}

/* A borító kicsiben, referenciának: rajta van a főszereplő. */
async function coverRef(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return await sharp(Buffer.from(await r.arrayBuffer())).resize(480, 480, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  } catch { return null; }
}

async function chapterFiles(ch) {
  const dir = path.join(ch.lp, ch.mf, ch.folder);
  let files = [];
  if (ch.r2_migrated) {
    const prefix = localPathToR2Key(`${ch.lp}/${ch.mf}/${ch.folder}/`.replace(/\/+/g, "/"));
    files = (await listFiles(prefix)).map(f => path.basename(f));
  }
  if (!files.length && fs.existsSync(dir)) files = fs.readdirSync(dir);
  return files.filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function loadPage(ch, file) {
  const local = path.join(ch.lp, ch.mf, ch.folder, file);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const r = await r2Fetch(localPathToR2Key(local));
  if (!r.ok) throw new Error(`R2 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function extractPanels(chapters, tmp) {
  const panels = [];
  for (const ch of chapters) {
    for (const f of await chapterFiles(ch)) {
      let buf;
      try { buf = await loadPage(ch, f); } catch { continue; }
      const meta = await sharp(buf).metadata().catch(() => null);
      if (!meta?.width || !meta?.height) continue;
      const { width: PW, height: PH } = meta;
      const sw = 200, sh = Math.max(1, Math.round(PH * sw / PW));
      const grey = await sharp(buf).resize(sw, sh, { fit: "fill" }).greyscale().raw().toBuffer();
      for (const [y0, y1] of splitRows(grey, sw, sh)) {
        const top = Math.round(y0 * PH / sh);
        const height = Math.min(Math.round((y1 - y0) * PH / sh), PH - top);
        if (height < PW * 0.35) continue;
        const crop = await sharp(buf).extract({ left: 0, top, width: PW, height }).toBuffer();
        const trimmed = await sharp(crop).trim({ threshold: 18 }).toBuffer().catch(() => crop);
        const m = await sharp(trimmed).metadata();
        if (m.width < PW * 0.45 || m.height < 220) continue;
        const st = await sharp(trimmed).stats();
        const file = path.join(tmp, `p${String(panels.length).padStart(4, "0")}.jpg`);
        await sharp(trimmed).jpeg({ quality: 90 }).toFile(file);
        panels.push({ file, chapter: ch.folder, page: f, w: m.width, h: m.height, entropy: st.entropy, sharpness: st.sharpness });
      }
    }
  }
  return panels;
}

/* ── 2. Előszűrés + AI-válogatás ─────────────────────────── */
async function contactSheet(cands) {
  const cols = 8, cw = 220, chh = 260, layers = [];
  for (let i = 0; i < cands.length; i++) {
    const tile = await sharp(cands[i].file).resize(cw - 8, chh - 34, { fit: "contain", background: "#ffffff" }).toBuffer();
    const label = Buffer.from(`<svg width="${cw}" height="30"><rect width="${cw}" height="30" fill="#111"/><text x="${cw / 2}" y="22" font-size="20" font-family="DejaVu Sans" font-weight="bold" fill="#ff0" text-anchor="middle">${i + 1}</text></svg>`);
    const x = (i % cols) * cw, y = Math.floor(i / cols) * chh;
    layers.push({ input: label, left: x, top: y }, { input: tile, left: x + 4, top: y + 32 });
  }
  return sharp({ create: { width: cols * cw, height: Math.ceil(cands.length / cols) * chh, channels: 3, background: "#ffffff" } })
    .composite(layers).jpeg({ quality: 82 }).toBuffer();
}

async function openaiJson(model, content, maxTokens = 600) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, temperature: 0.3, max_tokens: maxTokens,
      messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(120000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `OpenAI HTTP ${r.status}`);
  const raw = d.choices?.[0]?.message?.content;
  let out = null;
  try { out = JSON.parse(raw); } catch {}
  if (!out || typeof out !== "object") throw new Error(`AI-válasz nem értelmezhető (${d.choices?.[0]?.finish_reason}): ${String(raw ?? d.choices?.[0]?.message?.refusal).slice(0, 200)}`);
  return out;
}

async function aiPick(cands, { cover = null, description = "" } = {}) {
  const sheet = await contactSheet(cands);
  const prompt = `Ez egy manhwa több fejezetéből kivágott, sorszámozott képkockák áttekintője. Egy Facebook-ajánló poszterhez válogass képkockákat: add meg a legjobb 8 MEGFELELŐ kockát rangsorolva (a legjobb elöl; ebből az első ${PICKS} kerül a poszterre, ezért az első ${PICKS} együtt is legyen változatos).
SZIGORÚAN KIZÁRVA:
- bármilyen vízjel, weboldal-cím vagy logó a kockán (pl. "VORTEXSCANS.COM", "...scans", ".com", ".org"), akár kicsi is a sarokban;
- stáblista, fordítócsapat-hirdetés, toborzó vagy "támogass minket" oldalak;
- SZÖVEGBUBORÉKOS kockák: ha a kockán beszédbuborék vagy narrációs doboz van, NE válaszd (kivétel: egy egészen kicsi buborék a sarokban). A plakáton a kockákat körbevágjuk, így a buborékok csonkán jelennének meg. Kis hangutánzó effekt (pl. "HUFF") belefér;
- üres, elmosódott, szinte egyszínű kockák, absztrakt háttér-textúrák, sebesség- vagy effektcsíkok, amelyeken nincs felismerhető tárgy vagy szereplő;
- szexualizált, kihívó, félmeztelen vagy véres-brutális kockák.
- ugyanarról a jelenetről/oldalról csak egy kocka.
FŐSZEREPLŐ: ${cover ? "A MÁSODIK kép a mű borítója — a rajta kiemelt szereplő(k) a főszereplő(k). " : ""}${description ? "A mű leírása: " + description.slice(0, 700) + " " : ""}Keresd meg a kockák között a főszereplőt (ugyanaz a frizura, hajszín, ruha, arc, mint a borítón / a leírásban). Az első ${PICKS} kockából LEGALÁBB 2-n a FŐSZEREPLŐ legyen jól felismerhetően (ha egyáltalán szerepel), lehetőleg az arca. A "main" listába írd az ÖSSZES kockát, amelyen a főszereplő biztosan látszik. A főszereplős kockákra is ugyanúgy vonatkozik minden kizárás (buborék, felirat, vízjel)!
VÁLOGATÁS: legyen változatos — 1 hangulatos helyszín, LEGALÁBB 3 kocka, amelyen jól felismerhető szereplő-ARC látszik (lehetőleg a főszereplők, különböző szereplők), 1 akció vagy feszült pillanat. Ha a sztoriban állat vagy különleges lény a főszereplő, az is szerepeljen. Látványos, éles, színes kockák, amelyek kíváncsivá tesznek.
Ha nincs 8 megfelelő, add vissza azt, amennyi van — rossz kockát ne tegyél be csak a szám kedvéért.
Válasz CSAK JSON: {"picks":[szám,...],"main":[szám,...],"rejected_watermark":[szám,...]}`;
  const ask = () => openaiJson("gpt-4o", [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + sheet.toString("base64"), detail: "high" } },
    ...(cover ? [{ type: "image_url", image_url: { url: "data:image/jpeg;base64," + cover.toString("base64"), detail: "low" } }] : []),
  ]);
  let out;
  try { out = await ask(); }
  catch (e) { console.warn("[poster] válogatás, újrapróba:", e.message); out = await ask(); }
  const bad = new Set((out.rejected_watermark || []).map(Number));
  const ok = n => Number.isInteger(n) && n >= 1 && n <= cands.length && !bad.has(n);
  const ranked = [...new Set((out.picks || []).map(Number))].filter(ok);
  const main = [...new Set((out.main || []).map(Number))].filter(ok);
  // Legalább 2 főszereplős kocka az első PICKS között (ha van ilyen)
  const need = Math.min(2, main.length);
  const front = ranked.slice(0, PICKS);
  for (const m of ranked.slice(PICKS)) {   // csak szabályos (rangsorolt) kocka cserélhető be
    if (front.filter(n => main.includes(n)).length >= need) break;
    if (!main.includes(m) || front.includes(m)) continue;
    const drop = [...front].reverse().find(n => !main.includes(n));
    if (drop === undefined) break;
    front[front.indexOf(drop)] = m;
  }
  const order = [...front, ...ranked.filter(n => !front.includes(n))];
  const picks = order.map(n => ({ ...cands[n - 1], main: main.includes(n) }));
  return { picks, sheet, mainCount: main.length };
}

/* A kocka fő témájának helye (arc / fő alak) az AI szerint, 0–1 arányokban. */
async function aiFocus(file) {
  const img = await sharp(file).resize(512, 512, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  const out = await openaiJson("gpt-4o", [
    { type: "text", text: `Ez egy manhwa-képkocka. Add meg annak a téglalapnak a helyét, amelyben a kép LÉNYEGE van: ha van szereplő, az ARCA (homlok–áll, a szemekkel együtt) és közvetlen környezete; ha nincs szereplő, a fő látványelem. A szövegbuborékokat hagyd ki belőle. Arányokban (0 = bal/felső szél, 1 = jobb/alsó szél) válaszolj, CSAK JSON: {"x0":0.1,"y0":0.2,"x1":0.6,"y1":0.5}` },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + img.toString("base64"), detail: "low" } },
  ], 100);
  const v = ["x0", "y0", "x1", "y1"].map(k => Math.min(1, Math.max(0, Number(out[k]))));
  if (v.some(n => !Number.isFinite(n)) || v[2] <= v[0] || v[3] <= v[1]) return null;
  return { x0: v[0], y0: v[1], x1: v[2], y1: v[3] };
}

/* ── 3. Összeállítás ──────────────────────────────────────── */
async function textImg(svgInner, maxW, maxH, canvasW = 4000) {
  const big = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="400">${svgInner}</svg>`);
  const t = await sharp(big).trim().png().toBuffer();
  const m = await sharp(t).metadata();
  const s = Math.min(maxW / m.width, maxH / m.height, 1);
  return sharp(t).resize(Math.round(m.width * s), Math.round(m.height * s)).png().toBuffer({ resolveWithObject: true });
}

/* Cím sorokra: ≤18 karakter 1 sor, ≤40 két sor, felette három — kiegyensúlyozott tördelés */
function titleLines(title) {
  const T = title.toUpperCase().replace(/\s+/g, " ").trim();
  const words = T.split(" ");
  const n = T.length <= 18 || words.length < 2 ? 1 : (T.length <= 40 || words.length < 3 ? 2 : 3);
  if (n === 1) return [T];
  let best = null;
  const tryCut = (cuts) => {
    const parts = []; let prev = 0;
    for (const c of [...cuts, words.length]) { parts.push(words.slice(prev, c).join(" ")); prev = c; }
    const worst = Math.max(...parts.map(p => p.length));
    if (!best || worst < best.worst) best = { worst, parts };
  };
  for (let i = 1; i < words.length; i++) {
    if (n === 2) tryCut([i]);
    else for (let j = i + 1; j < words.length; j++) tryCut([i, j]);
  }
  return best.parts;
}

/* Kivágási ablak: a mozgatható irányban azt választjuk, amelyikben a
   legkevesebb a tiszta fehér (szövegbuborék), enyhe előnnyel a felső
   harmad (arc) / közép felé. */
async function bestCrop(p, aspect) {
  let cw = p.w, ch = Math.round(p.w / aspect);
  const vertical = ch <= p.h;
  if (!vertical) { ch = p.h; cw = Math.round(p.h * aspect); }
  const span = vertical ? p.h - ch : p.w - cw;
  if (span < 8) return { cx: 0, cy: 0, cw, ch };
  // AI-fókusz: a lényeg (arc) közepére igazítunk, a doboz teteje lehetőleg látszódjon
  if (p.focus) {
    const f = p.focus;
    if (vertical) {
      const top = f.y0 * p.h, bot = f.y1 * p.h, mid = (top + bot) / 2;
      let off = bot - top <= ch ? mid - ch / 2 : top - ch * 0.08;
      off = Math.max(0, Math.min(span, Math.round(off)));
      return { cx: 0, cy: off, cw, ch };
    } else {
      const mid = (f.x0 + f.x1) / 2 * p.w;
      const off = Math.max(0, Math.min(span, Math.round(mid - cw / 2)));
      return { cx: off, cy: 0, cw, ch };
    }
  }
  const sw = 120, sh = Math.max(1, Math.round(p.h * sw / p.w));
  const g = await sharp(p.file).resize(sw, sh, { fit: "fill" }).greyscale().raw().toBuffer();
  const white = new Float64Array(vertical ? sh : sw);   // soronként / oszloponként a fehér arány
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (g[y * sw + x] >= 245) white[vertical ? y : x] += 1 / (vertical ? sw : sh);
  }
  // A sharp „attention” kivágása (arc, bőrtónus, kontraszt) adja a fő célpontot
  let pref = vertical ? 0.3 : 0.5;
  try {
    const { info } = await sharp(p.file).resize(cw, ch, { fit: "cover", position: sharp.strategy.attention })
      .toBuffer({ resolveWithObject: true });
    const off = vertical ? -(info.cropOffsetTop ?? 0) : -(info.cropOffsetLeft ?? 0);
    if (Number.isFinite(off) && off >= 0 && off <= span) pref = off / span;
  } catch {}
  const scale = vertical ? sh / p.h : sw / p.w;
  const win = Math.max(1, Math.round((vertical ? ch : cw) * scale));
  let best = { off: Math.round(span * pref), score: Infinity };
  for (let k = 0; k <= 20; k++) {
    const off = Math.round(span * k / 20);
    const a = Math.round(off * scale);
    let wsum = 0;
    for (let i = a; i < Math.min(white.length, a + win); i++) wsum += white[i];
    const score = wsum / win + 0.45 * Math.abs(k / 20 - pref);
    if (score < best.score) best = { off, score };
  }
  return vertical ? { cx: 0, cy: best.off, cw, ch } : { cx: best.off, cy: 0, cw, ch };
}

export async function composePoster(title, picks) {
  ensureFont();
  const lines = titleLines(title);
  const titleParts = [];
  for (const l of lines) {
    titleParts.push(await textImg(`<text x="20" y="300" font-family="${FONT}" font-size="260" fill="#151515">${esc(l)}</text>`,
      W - 140, lines.length === 1 ? 120 : lines.length === 2 ? 82 : 62, Math.max(4000, l.length * 240)));
  }
  const top = 60 + titleParts.reduce((s, p) => s + p.info.height + 8, 0) + 18;
  const bottom = 1175, L = 70, R = W - 70, mid = Math.round(L + (R - L) * 0.47);
  const leftH = Math.floor((bottom - top - 2 * GAP) / 3);
  const tallH = Math.round((bottom - top - GAP) * 0.62);
  const colW = mid - L - GAP / 2, rightW = R - mid - GAP / 2, areaH = bottom - top;
  const slots = picks.length === 4 ? [
    // 4 kocka: két oszlop, ellentétes magas/alacsony párokkal
    { x: L, y: top, w: colW, h: Math.round((areaH - GAP) * 0.58) },
    { x: L, y: top + Math.round((areaH - GAP) * 0.58) + GAP, w: colW, h: areaH - GAP - Math.round((areaH - GAP) * 0.58) },
    { x: mid + GAP / 2, y: top, w: rightW, h: Math.round((areaH - GAP) * 0.42) },
    { x: mid + GAP / 2, y: top + Math.round((areaH - GAP) * 0.42) + GAP, w: rightW, h: areaH - GAP - Math.round((areaH - GAP) * 0.42) },
  ] : [
    { x: mid + GAP / 2, y: top, w: R - mid - GAP / 2, h: tallH },
    { x: L, y: top, w: mid - L - GAP / 2, h: leftH },
    { x: L, y: top + leftH + GAP, w: mid - L - GAP / 2, h: leftH },
    { x: L, y: top + 2 * (leftH + GAP), w: mid - L - GAP / 2, h: bottom - top - 2 * (leftH + GAP) },
    { x: mid + GAP / 2, y: top + tallH + GAP, w: R - mid - GAP / 2, h: bottom - top - tallH - GAP },
  ].slice(0, picks.length);
  // Arány szerinti párosítás (álló kocka → magas hely)
  const slotOrder = slots.map((s, i) => ({ i, a: s.h / s.w })).sort((x, y) => y.a - x.a);
  const panOrder = [...picks].sort((a, b) => b.h / b.w - a.h / a.w);
  const assign = [];
  slotOrder.forEach((so, k) => { assign[so.i] = panOrder[k]; });

  const layers = [];
  slots.forEach((s, i) => { s.x = Math.round(s.x); s.y = Math.round(s.y); s.w = Math.round(s.w); s.h = Math.round(s.h); });
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i], p = assign[i];
    const tw = s.w - 2 * BORDER, th = s.h - 2 * BORDER;
    const { cx, cy, cw, ch } = await bestCrop(p, tw / th);
    const img = await sharp(p.file).extract({ left: cx, top: cy, width: cw, height: ch }).resize(tw, th).toBuffer();
    layers.push({ input: { create: { width: s.w, height: s.h, channels: 3, background: "#111" } }, left: s.x, top: s.y });
    layers.push({ input: img, left: s.x + BORDER, top: s.y + BORDER });
  }
  let ty = 48;
  for (const p of titleParts) { layers.push({ input: p.data, left: Math.round((W - p.info.width) / 2), top: ty }); ty += p.info.height + 8; }
  const mas = await sharp(MASCOT).resize({ height: 330 }).png().toBuffer({ resolveWithObject: true });
  layers.push({ input: mas.data, left: 38, top: H - mas.info.height - 12 });
  const site = await textImg(`<text x="20" y="300" font-family="${FONT}" font-size="200"><tspan fill="#6d28a8">PADLIZSAN</tspan><tspan fill="#151515">FANSUB.HU</tspan></text>`, 560, 64);
  layers.push({ input: site.data, left: 38 + mas.info.width + 26, top: H - 70 - Math.round(site.info.height / 2) });

  return sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/* ── Facebook-szöveg ──────────────────────────────────────── */
function cleanDescription(d) {
  return String(d || "")
    .replace(/ford\.?\s*megj\.?:[^\n]*(\n|<br\s*\/?>)*/gi, "")   // fordítói megjegyzés
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\*\*/g, "")
    .replace(/\s+/g, " ").trim();
}

export async function buildCaption(manga) {
  const url = `${SITE}/chapters.html?slug=${encodeURIComponent(manga.slug)}`;
  const desc = cleanDescription(manga.description).slice(0, 1500);
  let hook = "";
  if (desc && process.env.OPENAI_API_KEY) {
    try {
      const out = await openaiJson("gpt-4o-mini", [{ type: "text", text:
        `Írj magyarul 2 rövid, figyelemfelkeltő mondatot egy Facebook-ajánlóhoz erről a manhwáról, KIZÁRÓLAG az alábbi leírás alapján (ne találj ki semmit, ne spoilerezz, ne használj hashtaget).\nCím: ${manga.title}\nLeírás: ${desc}\nVálasz JSON: {"hook":"..."}` }], 300);
      hook = String(out.hook || "").trim();
    } catch (e) { console.warn("[poster] ajánló-szöveg:", e.message); }
  }
  if (!hook && desc) hook = desc.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return `📚 Heti ajánló: ${manga.title}\n\n${hook}\n\n👉 Olvasd nálunk magyarul: ${url}\n\n#manhwa #manga #heti_ajánló #PadlizsanFanSub`;
}

/* ── Teljes folyamat ──────────────────────────────────────── */
export async function generatePoster(slug, { nChap = 4 } = {}) {
  const { manga, chapters } = await loadChapters(slug, nChap);
  if (!manga || !chapters.length) throw new Error("nincs olvasható fejezet");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "padli-poster-"));
  try {
    const panels = await extractPanels(chapters, tmp);
    const cands = panels
      .filter(p => p.h / p.w >= 0.45 && p.h / p.w <= 2.2 && p.entropy > 5.2)
      .map(p => ({ ...p, score: p.entropy * Math.log(1 + p.sharpness) }))
      .sort((a, b) => b.score - a.score).slice(0, 64)
      .sort((a, b) => a.file.localeCompare(b.file));
    if (cands.length < PICKS * 2) throw new Error(`kevés használható képkocka (${cands.length})`);
    const { picks, mainCount } = await aiPick(cands, { cover: await coverRef(manga.cover_url), description: cleanDescription(manga.description) });
    if (picks.length < 4) throw new Error(`az AI csak ${picks.length} megfelelő kockát talált`);
    const chosen = picks.slice(0, PICKS);
    await Promise.all(chosen.map(async p => {
      try { p.focus = await aiFocus(p.file); } catch (e) { console.warn("[poster] fókusz:", e.message); }
    }));
    const image = await composePoster(manga.title, chosen);
    return { image, title: manga.title, description: manga.description, slug,
      panels: picks.slice(0, PICKS).map(p => `${p.chapter}/${p.page}`), totalPanels: panels.length,
      mainInPoster: chosen.filter(p => p.main).length, mainCount };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function postPhotoToFacebook(image, caption) {
  if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_TOKEN) throw new Error("Facebook nincs beállítva");
  const form = new FormData();
  form.append("source", new Blob([image], { type: "image/jpeg" }), "poster.jpg");
  form.append("caption", caption);
  form.append("access_token", process.env.FB_PAGE_TOKEN);
  const r = await fetch(`${GRAPH}/${process.env.FB_PAGE_ID}/photos`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !(d.post_id || d.id)) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return d.post_id || d.id;
}

/* Poszter + szöveg elkészítése: legfeljebb 3 művel próbálkozik.
   logErrors: a sikertelen műveket naplózza (30 napig kimaradnak). */
export async function buildWeeklyPoster({ slug = null, exclude = [], logErrors = true } = {}) {
  const tried = [...exclude];
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = slug ? (await pool.query("SELECT id, slug, title FROM manga WHERE slug = $1 ORDER BY id DESC LIMIT 1", [slug])).rows[0]
                   : await pickManga(tried);
    if (!m) throw new Error("nincs választható mű");
    tried.push(m.slug);
    try {
      const res = await generatePoster(m.slug);
      const caption = await buildCaption({ ...m, description: res.description });
      return { ...res, caption, manga: m };
    } catch (e) {
      console.warn(`[poster] ${m.slug} kihagyva: ${e.message}`);
      if (logErrors) await pool.query(`INSERT INTO manga_posters (manga_id, fb_post_id, error, status) VALUES ($1, NULL, $2, 'failed')`, [m.id, e.message.slice(0, 500)]).catch(() => {});
      if (slug) throw e;
    }
  }
  throw new Error("3 próbálkozás után sem sikerült: " + tried.slice(exclude.length).join(", "));
}

/* Elkészít és (post=true esetén) azonnal kitesz — kézi futtatáshoz. */
export async function runWeeklyPoster({ post = true, slug = null } = {}) {
  const res = await buildWeeklyPoster({ slug, logErrors: post });
  let fbId = null;
  if (post) {
    fbId = await postPhotoToFacebook(res.image, res.caption);
    await pool.query(
      `INSERT INTO manga_posters (manga_id, fb_post_id, panels, caption, status) VALUES ($1, $2, $3, $4, 'posted')`,
      [res.manga.id, fbId, res.panels, res.caption]);
  }
  console.log(`[poster] ${post ? "kiposztolva" : "elkészült"}: ${res.manga.slug}${fbId ? " → " + fbId : ""}`);
  return { ...res, fbId };
}
