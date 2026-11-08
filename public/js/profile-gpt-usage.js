/* Profil → 💸 GPT-fogyasztásom (2026-11-08): a feltöltő a saját OpenAI-kulcsainak
   havi költését látja forintban. Csak az jelenik meg, akinek van hozzárendelt kulcsa. */
(() => {
  const sec = document.getElementById("gptUsageSection");
  const box = document.getElementById("gptUsageBox");
  if (!sec || !box) return;

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ft = n => n == null ? "–" : Number(n).toLocaleString("hu-HU", { maximumFractionDigits: 2 }) + " Ft";
  const num = n => Number(n || 0).toLocaleString("hu-HU");
  const HU_MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
  const DAYS_HU = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let month = curMonth;
  const shift = (m, d) => { const [y, mo] = m.split("-").map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
  const label = m => { const [y, mo] = m.split("-").map(Number); return `${y}. ${HU_MONTHS[mo - 1]}`; };

  const css = `
    .gu-nav { display:flex; align-items:center; gap:8px; margin-bottom:14px; flex-wrap:wrap; }
    .gu-btn { padding:6px 13px; border-radius:999px; background:#1e1b2e; color:#e2e8f0; border:1px solid #3b3561;
      font-size:.82rem; font-weight:600; cursor:pointer; transition:background .15s, border-color .15s; }
    .gu-btn:hover:not(:disabled) { background:#2a2350; border-color:#8b5cf6; }
    .gu-btn:disabled { opacity:.35; cursor:default; }
    .gu-month { flex:1; text-align:center; font-weight:700; color:#e2e8f0; }
    .gu-total { font-size:1.7rem; font-weight:800; color:#e2e8f0; line-height:1.1; }
    .gu-sub { color:#94a3b8; font-size:.82rem; margin-top:2px; }
    .gu-days { display:flex; gap:2px; align-items:flex-end; height:100px; padding-top:34px; margin:14px 0 6px; }
    .gu-day { position:relative; flex:1; min-width:5px; height:100%; display:flex; flex-direction:column; justify-content:flex-end; }
    .gu-bar { width:100%; background:#7c3aed; border-radius:3px 3px 0 0; }
    .gu-day:hover .gu-bar { background:#c084fc; }
    .gu-tip { position:absolute; bottom:calc(var(--h) + 6px); left:50%; transform:translateX(-50%); background:#f8fafc; color:#0f172a;
      font-size:.75rem; font-weight:700; white-space:nowrap; padding:3px 8px; border-radius:7px; pointer-events:none; opacity:0; z-index:2;
      box-shadow:0 4px 14px rgba(0,0,0,.35); }
    .gu-tip small { display:block; font-weight:500; color:#475569; font-size:.68rem; }
    .gu-day:hover .gu-tip { opacity:1; }
    .gu-day.l .gu-tip { left:0; transform:none; } .gu-day.r .gu-tip { left:auto; right:0; transform:none; }
    .gu-row { display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-top:1px solid rgba(255,255,255,.07); font-size:.85rem; }
    .gu-row span { color:#94a3b8; }`;
  try { const sh = new CSSStyleSheet(); sh.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; }
  catch { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); }

  async function load() {
    box.innerHTML = nav() + '<p style="color:#888;font-size:.85rem">Betöltés…</p>';
    bind();
    let d;
    try {
      const r = await fetch(`/api/user/gpt-usage?month=${month}`, { credentials: "include" });
      d = await r.json();
      if (r.status === 401) return;
      if (!r.ok) throw new Error(d.error || r.status);
    } catch (e) {
      box.innerHTML = nav() + `<p style="color:#f87171;font-size:.85rem">${esc(e.message)}</p>`;
      bind();
      return;
    }
    if (!d.hasKeys) return; // nincs hozzárendelt kulcs: a szekció rejtve marad
    sec.style.display = "";
    const maxDay = Math.max(1, ...d.days.map(x => x.huf));
    const bars = d.days.map((x, i) => {
      const h = Math.max(2, Math.round(62 * x.huf / maxDay));
      const dt = new Date(x.day + "T12:00:00");
      const edge = i < 3 ? " l" : i >= d.days.length - 3 ? " r" : "";
      return `<div class="gu-day${edge}" style="--h:${h}px"><div class="gu-tip">${ft(x.huf)}<small>${dt.toLocaleDateString("hu-HU", { month: "short", day: "numeric" })}, ${DAYS_HU[dt.getDay()]}</small></div><div class="gu-bar" style="height:${h}px"></div></div>`;
    }).join("");
    const models = new Map();
    for (const k of d.keys) for (const m of k.models) models.set(m.model, (models.get(m.model) || 0) + m.huf);
    box.innerHTML = nav() + `
      <div class="gu-total">${ft(d.totalHuf)}</div>
      <div class="gu-sub">${num(d.requests)} kérés · átlagosan ${ft(d.hufPerRequest)} / kérés (≈ oldal)</div>
      ${d.days.length ? `<div class="gu-days">${bars}</div>` : '<p style="color:#64748b;font-size:.85rem;margin:12px 0">Ebben a hónapban nem volt fogyasztás.</p>'}
      ${[...models].sort((a, b) => b[1] - a[1]).map(([m, huf]) => `<div class="gu-row"><span>${esc(m)}</span><strong>${ft(huf)}</strong></div>`).join("")}
      <div style="margin-top:10px;color:#64748b;font-size:.75rem">Kulcs: ${d.keys.map(k => esc(k.name) + (k.last4 ? " …" + esc(k.last4) : "")).join(", ") || "–"} · ${d.rate} Ft/$ · az OpenAI adatai néhány órás késéssel frissülnek.</div>`;
    bind();
  }
  function nav() {
    return `<div class="gu-nav"><button class="gu-btn" id="guPrev">‹</button><span class="gu-month">${esc(label(month))}</span>
      <button class="gu-btn" id="guNext" ${month >= curMonth ? "disabled" : ""}>›</button></div>`;
  }
  function bind() {
    document.getElementById("guPrev").onclick = () => { month = shift(month, -1); load(); };
    document.getElementById("guNext").onclick = () => { if (month < curMonth) { month = shift(month, 1); load(); } };
  }
  load();
})();
