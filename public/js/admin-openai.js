/* Admin → 💸 GPT-API fül: OpenAI-költségek kulcsonként, havi lapozással (2026-11-08).
   Csak a tulajdonos látja (a szerver is ellenőrzi). */
(() => {
  const btn = document.querySelector('.tab-btn[data-tab="tab-openai"]');

  // A fül saját stílusai (gombok, azonnali súgó a napi oszlopokon)
  const css = `
    .oa-nav { display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
    .oa-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:999px;
      background:#1e1b2e; color:#e2e8f0; border:1px solid #3b3561; font-size:.86rem; font-weight:600;
      cursor:pointer; transition:background .15s, border-color .15s, transform .1s, box-shadow .15s; }
    .oa-btn:hover:not(:disabled) { background:#2a2350; border-color:#8b5cf6; box-shadow:0 0 0 3px rgba(139,92,246,.18); }
    .oa-btn:active:not(:disabled) { transform:translateY(1px); }
    .oa-btn:disabled { opacity:.35; cursor:default; }
    .oa-btn.primary { background:linear-gradient(135deg,#7c3aed,#a855f7); border-color:transparent; color:#fff; }
    .oa-btn.primary:hover:not(:disabled) { background:linear-gradient(135deg,#6d28d9,#9333ea); }
    .oa-btn.spin .oa-ico { display:inline-block; animation:oa-spin .8s linear infinite; }
    @keyframes oa-spin { to { transform:rotate(360deg); } }
    .oa-month { min-width:170px; text-align:center; color:#e2e8f0; font-weight:700; font-size:1.05rem;
      padding:7px 14px; border-radius:999px; background:#0f172a; border:1px solid #1e293b; }
    .oa-days { display:flex; gap:3px; align-items:flex-end; height:130px; padding-top:34px; }
    .oa-day { position:relative; flex:1; min-width:8px; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; cursor:default; }
    .oa-day .oa-bar { width:100%; background:#7c3aed; border-radius:3px 3px 0 0; transition:background .1s; }
    .oa-day:hover .oa-bar { background:#c084fc; }
    .oa-day .oa-num { font-size:.6rem; color:#64748b; margin-top:3px; }
    .oa-day .oa-tip { position:absolute; bottom:calc(var(--h) + 20px); left:50%; transform:translateX(-50%);
      background:#f8fafc; color:#0f172a; font-size:.78rem; font-weight:700; white-space:nowrap; padding:4px 9px;
      border-radius:7px; box-shadow:0 4px 14px rgba(0,0,0,.35); pointer-events:none; opacity:0; transition:opacity .08s; z-index:2; }
    .oa-day .oa-tip small { display:block; font-weight:500; color:#475569; font-size:.7rem; }
    .oa-day:hover .oa-tip { opacity:1; }
    .oa-day.edge-l .oa-tip { left:0; transform:none; }
    .oa-day.edge-r .oa-tip { left:auto; right:0; transform:none; }`;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  }
  const box = document.getElementById("openaiCosts");
  if (!btn || !box) return;

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ft = n => n == null ? "–" : Number(n).toLocaleString("hu-HU", { maximumFractionDigits: 2 }) + " Ft";
  const num = n => Number(n || 0).toLocaleString("hu-HU");
  const HU_MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let month = curMonth;
  let loadedOnce = false;

  const shift = (m, d) => {
    const [y, mo] = m.split("-").map(Number);
    const t = new Date(y, mo - 1 + d, 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  };
  const label = m => { const [y, mo] = m.split("-").map(Number); return `${y}. ${HU_MONTHS[mo - 1]}`; };

  // a fül csak a tulajdonosnak jelenik meg
  fetch("/api/auth/me", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(me => {
    if (me?.can_security) btn.style.display = "";
  }).catch(() => {});

  btn.addEventListener("click", () => { if (!loadedOnce) load(); });

  const card = "background:#0f172a;border-radius:10px;padding:14px 18px;margin-bottom:14px";
  const th = "text-align:left;padding:7px 10px;color:#94a3b8;font-weight:600;font-size:.78rem;border-bottom:1px solid #1e293b;white-space:nowrap";
  const td = "padding:7px 10px;border-bottom:1px solid #1e293b;font-size:.85rem;color:#e2e8f0;vertical-align:top";
  const tdr = td + ";text-align:right;white-space:nowrap";

  async function load(refresh) {
    loadedOnce = true;
    box.innerHTML = `${nav()}<p style="color:#888">Betöltés az OpenAI-tól…</p>`;
    bindNav();
    const rb0 = document.getElementById("oaRefresh");
    rb0.classList.add("spin"); rb0.disabled = true;
    let d;
    try {
      const r = await fetch(`/api/admin/openai-costs?month=${month}${refresh ? "&refresh=1" : ""}`, { credentials: "include" });
      d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
    } catch (e) {
      box.innerHTML = `${nav()}<p style="color:#ef4444">Hiba: ${esc(e.message)}</p>`;
      bindNav();
      return;
    }
    const maxKey = Math.max(1, ...d.keys.map(k => k.huf));
    const maxDay = Math.max(1, ...d.days.map(x => x.huf));

    const keyRows = d.keys.map(k => {
      const share = d.totalHuf ? Math.round(100 * k.huf / d.totalHuf) : 0;
      return `<tr>
        <td style="${td}"><strong>${esc(k.name)}</strong>${k.last4 ? ` <span style="color:#64748b;font-family:monospace">…${esc(k.last4)}</span>` : ""}
          <div style="color:#64748b;font-size:.75rem">${esc(k.project)}${k.owner ? " · " + esc(k.owner) : ""}${k.lastUsed ? " · utoljára " + new Date(k.lastUsed).toLocaleDateString("hu-HU") : ""}</div></td>
        <td style="${td};font-size:.78rem;color:#94a3b8">${k.models.map(m => `${esc(m.model)}: ${ft(m.huf)}`).join("<br>")}</td>
        <td style="${tdr}">${num(k.requests)}</td>
        <td style="${tdr}">${ft(k.hufPerRequest)}</td>
        <td style="${tdr}">${ft(k.hufPer1kTokens)}</td>
        <td style="${td};min-width:160px"><div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;background:#1e293b;border-radius:5px;height:8px;overflow:hidden"><div style="background:#a78bfa;height:100%;width:${Math.round(100 * k.huf / maxKey)}%"></div></div>
          <strong style="white-space:nowrap">${ft(k.huf)}</strong><span style="color:#64748b;font-size:.75rem">${share}%</span></div></td>
      </tr>`;
    }).join("") || `<tr><td style="${td}" colspan="6">Ebben a hónapban nincs költés.</td></tr>`;

    const modelRows = d.models.map(m => `<tr>
        <td style="${td}">${esc(m.model)}</td>
        <td style="${tdr}">${ft(m.huf)}</td>
        <td style="${tdr}">${num(m.requests)}</td>
        <td style="${tdr}">${ft(m.hufPerRequest)}</td>
        <td style="${tdr}">${ft(m.hufPer1kTokens)}</td>
      </tr>`).join("");

    const DAYS_HU = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
    const dayBars = d.days.map((x, i) => {
      const h = Math.max(2, Math.round(90 * x.huf / maxDay));
      const dt = new Date(x.day + "T12:00:00");
      const edge = i < 3 ? " edge-l" : i >= d.days.length - 3 ? " edge-r" : "";
      return `<div class="oa-day${edge}" style="--h:${h}px">
        <div class="oa-tip">${ft(x.huf)}<small>${dt.toLocaleDateString("hu-HU", { month: "short", day: "numeric" })}, ${DAYS_HU[dt.getDay()]}</small></div>
        <div class="oa-bar" style="height:${h}px"></div>
        <div class="oa-num">${Number(x.day.slice(8))}</div></div>`;
    }).join("");

    box.innerHTML = `${nav()}
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <div style="${card};margin:0;min-width:200px"><div style="color:#94a3b8;font-size:.8rem">Összes költés (${esc(label(d.month))})</div>
          <div style="font-size:1.6rem;font-weight:700;color:#e2e8f0">${ft(d.totalHuf)}</div>
          <div style="color:#64748b;font-size:.75rem">${d.totalUsd ?? 0} $ · ${d.rate} Ft/$</div></div>
        ${d.projects.map(p => `<div style="${card};margin:0;min-width:160px"><div style="color:#94a3b8;font-size:.8rem">Projekt: ${esc(p.name)}</div>
          <div style="font-size:1.2rem;font-weight:700;color:#e2e8f0">${ft(p.huf)}</div></div>`).join("")}
      </div>
      <div style="${card}"><div style="color:#94a3b8;font-size:.8rem;margin-bottom:8px">Napi költés</div>
        <div class="oa-days">${dayBars || '<span style="color:#64748b">Nincs adat.</span>'}</div></div>
      <div style="${card};overflow-x:auto"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Személyenként – ki hány forintot költött</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>
          <th style="${th}">Személy</th><th style="${th}">Kulcsai</th><th style="${th};text-align:right">Kérés</th>
          <th style="${th};text-align:right">Ft / kérés</th><th style="${th}">Költés</th>
        </tr></thead><tbody>${(d.persons || []).map(p => {
          const share = d.totalHuf ? Math.round(100 * p.huf / d.totalHuf) : 0;
          return `<tr><td style="${td}"><strong>${esc(p.name)}</strong></td>
            <td style="${td};font-size:.78rem;color:#94a3b8">${p.keys.map(esc).join("<br>")}</td>
            <td style="${tdr}">${num(p.requests)}</td><td style="${tdr}">${ft(p.hufPerRequest)}</td>
            <td style="${td};min-width:160px"><div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;background:#1e293b;border-radius:5px;height:8px;overflow:hidden"><div style="background:#22c55e;height:100%;width:${Math.round(100 * p.huf / Math.max(1, d.persons[0].huf))}%"></div></div>
              <strong style="white-space:nowrap">${ft(p.huf)}</strong><span style="color:#64748b;font-size:.75rem">${share}%</span></div></td></tr>`;
        }).join("")}</tbody></table></div>
      <div style="${card};overflow-x:auto"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Kulcsonként – részletesen</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>
          <th style="${th}">Kulcs / tulajdonos</th><th style="${th}">Modellek</th><th style="${th};text-align:right">Kérés</th>
          <th style="${th};text-align:right" title="Egy kérés ≈ egy lefordított oldal">Ft / kérés</th><th style="${th};text-align:right">Ft / 1000 token</th><th style="${th}">Költés</th>
        </tr></thead><tbody>${keyRows}</tbody></table></div>
      <div style="${card};overflow-x:auto"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Modellenként – ár-érték</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>
          <th style="${th}">Modell</th><th style="${th};text-align:right">Költés</th><th style="${th};text-align:right">Kérés</th>
          <th style="${th};text-align:right">Ft / kérés</th><th style="${th};text-align:right">Ft / 1000 token</th>
        </tr></thead><tbody>${modelRows}</tbody></table></div>
      <div style="${card};overflow-x:auto" id="oaTotals"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Összesen – ki mennyit fogyasztott</div>
        <p style="color:#888;font-size:.85rem">Betöltés (az elmúlt 12 hónap, első alkalommal ~15 mp)…</p></div>
      <p style="color:#64748b;font-size:.75rem">A végösszeg az OpenAI valódi számlatételeiből jön. A kulcsonkénti bontás a tételek tokenarányos szétosztása. Frissítve: ${new Date(d.cachedAt).toLocaleString("hu-HU")} (az aktuális hónap 10 percenként frissül).</p>`;
    bindNav();
    loadTotals();
  }

  async function loadTotals() {
    const el = document.getElementById("oaTotals");
    if (!el) return;
    let t;
    try {
      const r = await fetch(`/api/admin/openai-costs/totals?month=${month}`, { credentials: "include" });
      t = await r.json();
      if (!r.ok) throw new Error(t.error || r.status);
    } catch (e) { el.querySelector("p").textContent = "Hiba: " + e.message; el.querySelector("p").style.color = "#ef4444"; return; }
    if (!document.body.contains(el)) return;
    const max = Math.max(1, ...t.rows.map(r => r.huf));
    el.innerHTML = `<div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Összesen – ki mennyit fogyasztott</div>
      <table style="width:100%;border-collapse:collapse"><thead><tr>
        <th style="${th}">Ki</th><th style="${th};text-align:right">${esc(label(t.month))}</th>
        <th style="${th};text-align:right">Kérés (12 hó)</th><th style="${th}">Elmúlt 12 hónap (${esc(label(t.since))} óta)</th>
      </tr></thead><tbody>${t.rows.map(r => `<tr>
        <td style="${td}"><strong>${esc(r.name)}</strong></td>
        <td style="${tdr}">${r.monthHuf ? ft(r.monthHuf) : '<span style="color:#475569">–</span>'}</td>
        <td style="${tdr}">${num(r.requests)}</td>
        <td style="${td};min-width:180px"><div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;background:#1e293b;border-radius:5px;height:8px;overflow:hidden"><div style="background:#f59e0b;height:100%;width:${Math.round(100 * r.huf / max)}%"></div></div>
          <strong style="white-space:nowrap">${ft(r.huf)}</strong></div></td></tr>`).join("")}
        <tr><td style="${td};font-weight:700">Összesen</td><td style="${tdr};font-weight:700">${ft(t.monthTotal)}</td><td style="${td}"></td>
          <td style="${td};font-weight:700">${ft(t.allTotal)}</td></tr>
      </tbody></table>
      <p style="color:#64748b;font-size:.75rem;margin-top:8px">Az OpenAI csak az elmúlt egy év adatait adja ki. Ahol a kulcs egy fiókhoz van rendelve, ott a felhasználónév látszik.</p>`;
  }

  function nav() {
    return `<div class="oa-nav">
      <button id="oaPrev" class="oa-btn" title="Előző hónap">‹ Előző hónap</button>
      <span class="oa-month">📅 ${esc(label(month))}</span>
      <button id="oaNext" class="oa-btn" title="Következő hónap" ${month >= curMonth ? "disabled" : ""}>Következő hónap ›</button>
      ${month !== curMonth ? `<button id="oaNow" class="oa-btn" title="Vissza az aktuális hónapra">Aktuális hónap</button>` : ""}
      <button id="oaRefresh" class="oa-btn primary" style="margin-left:auto" title="Friss adat az OpenAI-tól"><span class="oa-ico">↻</span> Frissítés</button>
    </div>`;
  }
  function bindNav() {
    document.getElementById("oaPrev").onclick = () => { month = shift(month, -1); load(); };
    document.getElementById("oaNext").onclick = () => { if (month < curMonth) { month = shift(month, 1); load(); } };
    const now = document.getElementById("oaNow");
    if (now) now.onclick = () => { month = curMonth; load(); };
    const rb = document.getElementById("oaRefresh");
    rb.onclick = () => { rb.classList.add("spin"); rb.disabled = true; load(true); };
  }
})();
