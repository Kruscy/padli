/* ============================================================
 reader-core.js — az olvasó DOM-független logikája
 (beállítások, lapozási irány, széles képek felezése, webtoon-
 felismerés). ES-modul: a böngészőben a reader.js, a szerveren a
 beállítások ellenőrzése (routes/reader-prefs.js) és a tesztek is
 ezt használják.
 ============================================================ */
// Az olvasó beállításai. Eszközönként (telefon / gép) külön tároljuk.
export const DEFAULT_PREFS = Object.freeze({
  mode: "scroll",        // scroll | book
  direction: "ltr",      // ltr (balról jobbra) | rtl (jobbról balra, japán manga)
  scaling: "auto",       // auto | width | height | original
  widthPct: 100,         // görgetős mód: a kép szélessége a sáv %-ában (40–100)
  splitWide: "fit",      // fit (egész kép) | split (széles kép két félre bontva)
  autoWebtoon: true,     // hosszú (webtoon) képeknél automatikusan görgetős mód
});
export const CHOICES = {
  mode: ["scroll", "book"],
  direction: ["ltr", "rtl"],
  scaling: ["auto", "width", "height", "original"],
  splitWide: ["fit", "split"],
};
export const DEVICES = ["mobile", "desktop"];

// Ismeretlen kulcsok és értékek kiszűrése, hiányzók alapértékre
export function normalizePrefs(input) {
  const p = input && typeof input === "object" ? input : {};
  const out = { ...DEFAULT_PREFS };
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (allowed.includes(p[key])) out[key] = p[key];
  }
  const w = Number(p.widthPct);
  if (Number.isFinite(w)) out.widthPct = Math.min(100, Math.max(40, Math.round(w)));
  if (typeof p.autoWebtoon === "boolean") out.autoWebtoon = p.autoWebtoon;
  return out;
}

export function deviceKind(width) {
  return width <= 768 ? "mobile" : "desktop";
}

/* ── Lapozás iránya ─────────────────────────────────────── */
// Jobbról balra olvasásnál a bal oldal visz előre
export function keyAction(key, direction) {
  const left = key === "ArrowLeft" || key === "a" || key === "A";
  const right = key === "ArrowRight" || key === "d" || key === "D";
  if (!left && !right) return null;
  const forward = direction === "rtl" ? left : right;
  return forward ? "next" : "prev";
}

// Koppintás a képernyő szélén (xRatio: 0 = bal szél, 1 = jobb szél)
export function tapAction(xRatio, direction) {
  if (xRatio < 0.25) return direction === "rtl" ? "next" : "prev";
  if (xRatio > 0.75) return direction === "rtl" ? "prev" : "next";
  return null;
}

// Csúsztatás: dx < 0 = balra húzás (a tartalom balra megy)
export function swipeAction(dx, direction, threshold = 40) {
  if (Math.abs(dx) < threshold) return null;
  const leftSwipe = dx < 0;
  return (direction === "rtl" ? !leftSwipe : leftSwipe) ? "next" : "prev";
}

// Képernyőn lévő nyíl (bal / jobb) jelentése
export function arrowAction(side, direction) {
  return (side === "left") === (direction === "rtl") ? "next" : "prev";
}

/* ── Széles képek felezése (egyoldalas könyv mód) ─────────── */
// Pozíció: { index, half } — half: 0 = első fél, 1 = második fél, null =
// egész kép. ctx: { total, step (1 vagy 2), split, isWide(index) }.
// Felezés csak egyoldalas nézetben (step 1) és "split" beállításnál.
function splits(ctx, index) {
  return ctx.step === 1 && ctx.split && !!ctx.isWide(index);
}

export function nextPosition(pos, ctx) {
  if (splits(ctx, pos.index) && pos.half === 0) return { index: pos.index, half: 1 };
  const index = pos.index + ctx.step;
  if (index >= ctx.total) return null;
  return { index, half: splits(ctx, index) ? 0 : null };
}

export function prevPosition(pos, ctx) {
  if (splits(ctx, pos.index) && pos.half === 1) return { index: pos.index, half: 0 };
  const index = pos.index - ctx.step;
  if (index < 0) return null;
  // visszafelé a fél kép második felére érkezünk
  return { index, half: splits(ctx, index) ? 1 : null };
}

// Melyik oldala látszik a képnek: balról jobbra olvasva előbb a bal fél,
// jobbról balra előbb a jobb
export function halfSide(half, direction) {
  if (half == null) return null;
  const firstIsLeft = direction !== "rtl";
  return (half === 0) === firstIsLeft ? "left" : "right";
}

export function isWideImage(width, height) {
  return width > 0 && height > 0 && width / height > 1.2;
}

/* ── Webtoon-felismerés ────────────────────────────────────── */
// Hosszú, keskeny képek (magasság / szélesség > 2.2): ha az első betöltött
// képek többsége ilyen, webtoonnak tekintjük
export function isWebtoonImage(width, height) {
  return width > 0 && height / width > 2.2;
}
export function detectWebtoon(dims) {
  const known = (dims || []).filter(d => d && d.width > 0 && d.height > 0).slice(0, 3);
  if (known.length < 2) return false;
  return known.filter(d => isWebtoonImage(d.width, d.height)).length * 2 > known.length;
}
