/**
 * Egyszerű cím-hasonlóság szóátfedés alapján — annak eldöntésére, hogy egy
 * másik forrásból (Jikan/MangaDex) kapott cím valószínűleg ugyanazt a
 * művet jelöli-e, mielőtt kereszt-azonosítóként elmentenénk. Óvatos
 * (legalább 50% szóegyezés kell), hogy ne kössünk össze két különböző
 * mangát egy hasonló, de nem egyező cím miatt.
 */
function normalizeWords(str) {
  return new Set(
    str.toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(w => w.length > 2)
  );
}

export function titlesMatch(a, b) {
  if (!a || !b) return false;
  const wa = normalizeWords(a);
  const wb = normalizeWords(b);
  if (!wa.size || !wb.size) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size) >= 0.5;
}
