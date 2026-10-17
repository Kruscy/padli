/* ── Egyszerű, méretkorlátos memóriacache lejárati idővel ─────
   Gyakran kért, ritkán változó adatokhoz (fejezet-útvonalak, kezdőlapi
   listák). maxEntries fölött a legrégebben betett elem esik ki, így a
   memória nem nőhet korlátlanul. Egy folyamaton belül érvényes. */
export function createTtlCache({ ttlMs, maxEntries = 1000 }) {
  const map = new Map(); // key → { at, value }

  function get(key) {
    const hit = map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > ttlMs) { map.delete(key); return undefined; }
    return hit.value;
  }

  function set(key, value) {
    map.delete(key);
    map.set(key, { at: Date.now(), value });
    if (map.size > maxEntries) map.delete(map.keys().next().value);
  }

  // Ha nincs (érvényes) érték, a loader-rel tölti be; az egyidejű
  // kérések ugyanazt a folyamatban lévő betöltést várják meg.
  const inflight = new Map();
  async function wrap(key, loader) {
    const hit = get(key);
    if (hit !== undefined) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const value = await loader();
        set(key, value);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return { get, set, wrap, delete: key => map.delete(key), clear: () => map.clear() };
}
