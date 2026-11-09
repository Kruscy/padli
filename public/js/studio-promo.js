/* Padlizsan Studio letöltés-ajánló (2026-11-09): a PadliCrome oldalon (#studioPromo).
   A verziót a nyilvános /api/studio/latest adja; a letöltés belépéshez kötött
   (belépés nélkül a szerver a belépés után folytatja). Az első letöltésért 30 pont jár. */
(() => {
  const box = document.getElementById("studioPromo");
  if (!box) return;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  fetch("/api/studio/latest").then(r => r.ok ? r.json() : null).then(L => {
    if (!L) return;
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 20px;margin-bottom:16px;border-radius:14px;
                  background:linear-gradient(135deg,#2a1747 0%,#1b1530 60%,#14202b 100%);border:1px solid #4b2f7a">
        <img src="/assets/studio-icon.png" alt="" width="52" height="52" style="border-radius:12px;flex:none">
        <div style="flex:1;min-width:220px">
          <div style="font-weight:800;font-size:1.05rem;color:#f3e8ff">🍆 Padlizsan Studio – asztali fordító Windowsra</div>
          <div style="font-size:.84rem;color:#c4b5fd;margin-top:3px;line-height:1.5">
            Egész mappákat fordít egyszerre, a gépeden. Ugyanazokkal a pontokkal, mint a PadliCrome.
            <b style="color:#fde68a">Az első letöltésért 30 pontot kapsz ajándékba!</b>
          </div>
        </div>
        <a href="/api/studio/download" style="flex:none;display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:999px;
             background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;font-weight:700;text-decoration:none;white-space:nowrap">
          ⬇ Letöltés · v${esc(L.version)}</a>
      </div>`;
  }).catch(() => {});
})();
