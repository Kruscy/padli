/* Admin → 🍆 Padlizsan Studio fül (2026-11-08): ki használja, mennyit fordít,
   mennyi a bevétel / költség / haszon, a csomag verziója, nyilvános letöltés. Csak tulajdonos. */
(() => {
  const btn = document.querySelector('.tab-btn[data-tab="tab-studio"]');
  const box = document.getElementById("studioAdmin");
  if (!btn || !box) return;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ft = n => Number(n || 0).toLocaleString("hu-HU", { maximumFractionDigits: 0 }) + " Ft";
  const pt = n => Number(n || 0).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
  const HU_MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let month = curMonth, loaded = false;
  const shift = (m, d) => { const [y, mo] = m.split("-").map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
  const label = m => { const [y, mo] = m.split("-").map(Number); return `${y}. ${HU_MONTHS[mo - 1]}`; };

  fetch("/api/auth/me", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(me => { if (me?.can_security) btn.style.display = ""; }).catch(() => {});
  btn.addEventListener("click", () => { if (!loaded) load(); });

  const card = "background:#0f172a;border-radius:10px;padding:14px 18px;margin-bottom:14px";
  const th = "text-align:left;padding:7px 10px;color:#94a3b8;font-weight:600;font-size:.78rem;border-bottom:1px solid #1e293b;white-space:nowrap";
  const td = "padding:7px 10px;border-bottom:1px solid #1e293b;font-size:.85rem;color:#e2e8f0";
  const tdr = td + ";text-align:right;white-space:nowrap";
  const B = "display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:999px;background:#1e1b2e;color:#e2e8f0;border:1px solid #3b3561;font-size:.86rem;font-weight:600;cursor:pointer";

  // Kulcsos kérések naplója (2026-11-12): ingyenes lekérések is
  async function showKeyLog(uid) {
    const el = box.querySelector(`.sd-keylog-box[data-uid="${CSS.escape(uid)}"]`);
    if (!el) return;
    if (el.style.display !== "none") { el.style.display = "none"; return; }
    el.style.display = ""; el.innerHTML = '<p style="color:#64748b">Betöltés…</p>';
    try {
      const r = await fetch(`/api/studio/admin/key-requests/${encodeURIComponent(uid)}`, { credentials: "include" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const when = t => new Date(t).toLocaleString("hu-HU");
      const stCol = s => s >= 400 ? "#ef4444" : "#22c55e";
      el.innerHTML = !d.recent.length ? '<p style="color:#64748b">Nincs naplózott kérés (a naplózás 2026-11-12 óta él).</p>' : `
        <div style="color:#94a3b8;font-size:.78rem;margin:4px 0">Végpontonként, utolsó 30 nap</div>
        <table style="width:100%;border-collapse:collapse"><tr><th style="${th}">Végpont</th><th style="${th};text-align:right">Kérés</th><th style="${th};text-align:right">Hiba</th><th style="${th}">Utoljára</th></tr>
        ${d.byPath.map(p => `<tr><td style="${td}">${esc(p.method)} ${esc(p.path)}</td><td style="${tdr}">${p.n}</td><td style="${tdr}">${p.errors}</td><td style="${td}">${when(p.last)}</td></tr>`).join("")}</table>
        <div style="color:#94a3b8;font-size:.78rem;margin:10px 0 4px">Legutóbbi ${d.recent.length} kérés</div>
        <div style="max-height:320px;overflow:auto"><table style="width:100%;border-collapse:collapse"><tr><th style="${th}">Idő</th><th style="${th}">Kérés</th><th style="${th};text-align:right">Állapot</th><th style="${th};text-align:right">ms</th><th style="${th}">Kulcs</th><th style="${th}">IP</th></tr>
        ${d.recent.map(x => `<tr><td style="${td}">${when(x.created_at)}</td><td style="${td}">${esc(x.method)} ${esc(x.path)}</td><td style="${tdr};color:${stCol(x.status)}">${esc(x.status)}</td><td style="${tdr}">${esc(x.ms)}</td><td style="${td}">${esc(x.prefix || "–")}</td><td style="${td}">${esc(x.ip)}</td></tr>`).join("")}</table></div>`;
    } catch (e) {
      el.innerHTML = `<p style="color:#ef4444">Nem sikerült betölteni: ${esc(e.message)}</p>`;
    }
  }

  const nav = () => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <button id="sdPrev" style="${B}">‹ Előző hónap</button>
    <span style="min-width:170px;text-align:center;color:#e2e8f0;font-weight:700;padding:7px 14px;border-radius:999px;background:#0f172a;border:1px solid #1e293b">📅 ${esc(label(month))}</span>
    <button id="sdNext" style="${B}" ${month >= curMonth ? "disabled" : ""}>Következő hónap ›</button></div>`;
  const bindNav = () => {
    document.getElementById("sdPrev").onclick = () => { month = shift(month, -1); load(); };
    document.getElementById("sdNext").onclick = () => { if (month < curMonth) { month = shift(month, 1); load(); } };
  };
  const stat = (title, value, color) => `<div style="${card};margin:0;min-width:140px"><div style="color:#94a3b8;font-size:.8rem">${title}</div>
    <div style="font-size:1.4rem;font-weight:700;color:${color || "#e2e8f0"}">${value}</div></div>`;

  async function load() {
    loaded = true;
    box.innerHTML = nav() + '<p style="color:#888">Betöltés…</p>';
    bindNav();
    let d;
    try { const r = await fetch(`/api/studio/admin/overview?month=${month}`, { credentials: "include" }); d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); }
    catch (e) { box.innerHTML = nav() + `<p style="color:#ef4444">Hiba: ${esc(e.message)}</p>`; bindNav(); return; }
    const L = d.latest;
    box.innerHTML = `
      <div style="${card}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div><div style="color:#94a3b8;font-size:.8rem">Legújabb csomag</div>
            <div style="color:#e2e8f0;font-weight:700">${L ? `v${esc(L.version)} · ${esc(L.name)} · ${(L.size / 1048576).toFixed(0)} MB · ${new Date(L.date).toLocaleString("hu-HU")}` : "nincs feltöltve"}</div>
            <div style="color:#94a3b8;font-size:.8rem">Telepítő: ${L?.installer ? `${esc(L.installer.name)} · ${(L.installer.size / 1048576).toFixed(0)} MB` : L?.installerBuilding ? "épp készül…" : "nincs (a ZIP feltöltése után magától elkészül)"}</div>
            <div style="color:#64748b;font-size:.75rem">Állandó letöltési link (mindig a legújabb): <code>https://padlizsanfansub.hu/api/studio/download</code> · a ZIP helye: /opt/padli/studio-dist/</div></div>
          <label style="display:flex;align-items:center;gap:8px;color:#e2e8f0;cursor:pointer">
            <input type="checkbox" id="sdPublic" ${d.publicDownload ? "checked" : ""} style="width:18px;height:18px">
            <span><b>Letöltés mindenkinek</b><br><small style="color:#94a3b8">${d.publicDownload ? "minden belépett felhasználó letöltheti" : `most csak a tesztelők (${d.testers.length} fő)`}</small></span></label>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        ${stat("Letöltések összesen", d.downloads?.total ?? 0)}
        ${stat("Letöltő felhasználó", d.downloads?.users ?? 0)}
        ${stat("Ma", d.downloads?.today ?? 0)}
        ${stat("Ajándékpontot kapott", `${d.downloads?.gifts ?? 0} fő · ${d.downloads?.gift_points ?? 0} pont`, "#fbbf24")}
      </div>
      ${nav()}
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        ${stat("Lefordított oldal", d.total.pages)}
        ${stat("Levont pont", pt(d.total.points))}
        ${stat(`Bevétel (${d.pointFt} Ft/pont)`, ft(d.total.revenue_ft))}
        ${stat("Költségünk", ft(d.total.cost_ft))}
        ${stat("Haszon", ft(d.total.profit_ft), d.total.profit_ft >= 0 ? "#22c55e" : "#ef4444")}
      </div>
      <div style="${card};overflow-x:auto"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Felhasználónként</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Felhasználó</th><th style="${th}">Mód</th>
          <th style="${th};text-align:right">Oldal</th><th style="${th};text-align:right">Pont</th><th style="${th};text-align:right">Bevétel</th>
          <th style="${th};text-align:right">Költség</th><th style="${th};text-align:right">Haszon</th></tr></thead>
        <tbody>${d.users.map(u => `<tr><td style="${td}"><b>${esc(u.user)}</b></td><td style="${td};color:#94a3b8">${u.modes.map(esc).join(", ")}</td>
          <td style="${tdr}">${u.pages}</td><td style="${tdr}">${pt(u.points)}</td><td style="${tdr}">${ft(u.revenue_ft)}</td>
          <td style="${tdr}">${ft(u.cost_ft)}</td><td style="${tdr};color:${u.profit_ft >= 0 ? "#22c55e" : "#ef4444"}">${ft(u.profit_ft)}</td></tr>`).join("")
          || `<tr><td style="${td}" colspan="7">Ebben a hónapban senki nem fordított a Studióval.</td></tr>`}</tbody></table></div>
      <div style="${card};overflow-x:auto"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">Modellenként</div>
        <table style="width:100%;border-collapse:collapse"><thead><tr><th style="${th}">Mód · modell</th><th style="${th};text-align:right">Oldal</th>
          <th style="${th};text-align:right">Pont</th><th style="${th};text-align:right">Bevétel</th><th style="${th};text-align:right">Költség</th><th style="${th};text-align:right">Költség / oldal</th></tr></thead>
        <tbody>${d.byModel.map(m => `<tr><td style="${td}">${esc(m.key)}</td><td style="${tdr}">${m.pages}</td><td style="${tdr}">${pt(m.points)}</td>
          <td style="${tdr}">${ft(m.revenue_ft)}</td><td style="${tdr}">${ft(m.cost_ft)}</td><td style="${tdr}">${m.pages ? (m.cost_ft / m.pages).toFixed(2) + " Ft" : "–"}</td></tr>`).join("")
          || `<tr><td style="${td}" colspan="6">Nincs adat.</td></tr>`}</tbody></table></div>
      <div style="${card}"><div style="color:#e2e8f0;font-weight:600;margin-bottom:8px">API-kulccsal rendelkezők</div>
        ${d.keyHolders.map(k => `<div style="padding:5px 0;border-bottom:1px solid #1e293b;font-size:.85rem;color:#e2e8f0">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <span>${esc(k.username)} <span style="color:#64748b">(${k.keys} kulcs)</span></span>
          <span style="color:#94a3b8">${k.last_used ? "utoljára: " + new Date(k.last_used).toLocaleString("hu-HU") : "még nem használta"}
            · ${k.requests_30d ?? 0} kérés / 30 nap
            <button class="sd-keylog" data-uid="${esc(k.user_id)}" style="${B};padding:3px 10px;font-size:.75rem;margin-left:6px">Napló</button></span></div>
          <div class="sd-keylog-box" data-uid="${esc(k.user_id)}" style="display:none;margin-top:8px"></div></div>`).join("")
          || '<p style="color:#64748b">Még senkinek nincs kulcsa.</p>'}</div>
      <p style="color:#64748b;font-size:.75rem">A bevétel a levont pontok × ${d.pointFt} Ft (a legolcsóbb csomag ára); áfa és Stripe-díj nélkül. A költség: Torii-kredit × 0,465 Ft + OpenAI-díj.</p>`;
    bindNav();
    box.querySelectorAll(".sd-keylog").forEach(b => b.onclick = () => showKeyLog(b.dataset.uid));
    document.getElementById("sdPublic").onchange = async (e) => {
      const want = e.target.checked;
      if (want && !confirm("Biztosan letölthetővé teszed a programot minden belépett felhasználónak?")) { e.target.checked = false; return; }
      const r = await fetch("/api/studio/admin/settings", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicDownload: want }) });
      if (!r.ok) { alert("Nem sikerült menteni."); e.target.checked = !want; return; }
      load();
    };
  }
})();
