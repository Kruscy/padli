/* Admin → 💸 GPT-API fül: OpenAI-költségek kulcsonként, havi lapozással (2026-11-08).
   Csak a tulajdonos látja (a szerver is ellenőrzi). */
(() => {
  const btn = document.querySelector('.tab-btn[data-tab="tab-openai"]');
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

    const dayBars = d.days.map(x => `<div title="${esc(x.day)}: ${ft(x.huf)}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:8px">
        <div style="width:100%;background:#7c3aed;border-radius:3px 3px 0 0;height:${Math.max(2, Math.round(100 * x.huf / maxDay))}px"></div>
        <div style="font-size:.6rem;color:#64748b;margin-top:3px">${Number(x.day.slice(8))}</div></div>`).join("");

    box.innerHTML = `${nav()}
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <div style="${card};margin:0;min-width:200px"><div style="color:#94a3b8;font-size:.8rem">Összes költés (${esc(label(d.month))})</div>
          <div style="font-size:1.6rem;font-weight:700;color:#e2e8f0">${ft(d.totalHuf)}</div>
          <div style="color:#64748b;font-size:.75rem">${d.totalUsd ?? 0} $ · ${d.rate} Ft/$</div></div>
        ${d.projects.map(p => `<div style="${card};margin:0;min-width:160px"><div style="color:#94a3b8;font-size:.8rem">Projekt: ${esc(p.name)}</div>
          <div style="font-size:1.2rem;font-weight:700;color:#e2e8f0">${ft(p.huf)}</div></div>`).join("")}
      </div>
      <div style="${card}"><div style="color:#94a3b8;font-size:.8rem;margin-bottom:8px">Napi költés</div>
        <div style="display:flex;gap:3px;align-items:flex-end;height:120px">${dayBars || '<span style="color:#64748b">Nincs adat.</span>'}</div></div>
      <div style="${card};overflow-x:auto"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Kulcsonként – ki mennyit költött</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>
          <th style="${th}">Kulcs / tulajdonos</th><th style="${th}">Modellek</th><th style="${th};text-align:right">Kérés</th>
          <th style="${th};text-align:right" title="Egy kérés ≈ egy lefordított oldal">Ft / kérés</th><th style="${th};text-align:right">Ft / 1000 token</th><th style="${th}">Költés</th>
        </tr></thead><tbody>${keyRows}</tbody></table></div>
      <div style="${card};overflow-x:auto"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Modellenként – ár-érték</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr>
          <th style="${th}">Modell</th><th style="${th};text-align:right">Költés</th><th style="${th};text-align:right">Kérés</th>
          <th style="${th};text-align:right">Ft / kérés</th><th style="${th};text-align:right">Ft / 1000 token</th>
        </tr></thead><tbody>${modelRows}</tbody></table></div>
      <p style="color:#64748b;font-size:.75rem">A végösszeg az OpenAI valódi számlatételeiből jön. A kulcsonkénti bontás a tételek tokenarányos szétosztása. Frissítve: ${new Date(d.cachedAt).toLocaleString("hu-HU")} (az aktuális hónap 10 percenként frissül).</p>`;
    bindNav();
  }

  function nav() {
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <button id="oaPrev" class="btn-secondary" style="padding:6px 12px;cursor:pointer">‹ Előző hónap</button>
      <strong style="min-width:150px;text-align:center;color:#e2e8f0">${esc(label(month))}</strong>
      <button id="oaNext" class="btn-secondary" style="padding:6px 12px;cursor:pointer" ${month >= curMonth ? "disabled" : ""}>Következő hónap ›</button>
      <button id="oaRefresh" class="btn-secondary" style="padding:6px 12px;cursor:pointer;margin-left:auto" title="Friss adat az OpenAI-tól">↻ Frissítés</button>
    </div>`;
  }
  function bindNav() {
    document.getElementById("oaPrev").onclick = () => { month = shift(month, -1); load(); };
    document.getElementById("oaNext").onclick = () => { if (month < curMonth) { month = shift(month, 1); load(); } };
    document.getElementById("oaRefresh").onclick = () => load(true);
  }
})();
