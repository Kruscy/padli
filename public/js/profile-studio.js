/* Profil → 🍆 Padlizsan Studio (2026-11-08): API-kulcs, letöltés (mindig a legújabb),
   és a saját fordítások statisztikája havonta. */
(() => {
  const sec = document.getElementById("studio");
  if (!sec) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pt = n => Number(n || 0).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
  const fmtDate = d => d ? new Date(d).toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" }) : "még nem használt";
  const HU_MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
  const DAYS_HU = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let month = curMonth;
  const shift = (m, d) => { const [y, mo] = m.split("-").map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
  const label = m => { const [y, mo] = m.split("-").map(Number); return `${y}. ${HU_MONTHS[mo - 1]}`; };

  const css = `
    .st-sub { font-weight:700; margin:18px 0 8px; font-size:.95rem; }
    .st-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 15px; border-radius:999px; background:#1e1b2e; color:#e2e8f0;
      border:1px solid #3b3561; font-size:.85rem; font-weight:600; cursor:pointer; text-decoration:none; transition:background .15s, border-color .15s; }
    .st-btn:hover:not(:disabled) { background:#2a2350; border-color:#8b5cf6; }
    .st-btn:disabled { opacity:.35; cursor:default; }
    .st-btn.primary { background:linear-gradient(135deg,#7c3aed,#a855f7); border-color:transparent; color:#fff; }
    .st-input { flex:1; min-width:160px; background:#1e293b; border:1px solid #334155; border-radius:8px; padding:8px 10px; color:#e2e8f0; }
    .st-key { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:9px 0; border-top:1px solid rgba(255,255,255,.07); }
    .st-key small { display:block; color:#888; font-size:.75rem; }
    .st-new { background:#10261a; border:1px solid #22c55e; border-radius:10px; padding:10px 12px; margin:10px 0; }
    .st-new code { word-break:break-all; user-select:all; }
    .st-nav { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
    .st-month { flex:1; text-align:center; font-weight:700; }
    .st-big { font-size:1.6rem; font-weight:800; line-height:1.1; }
    .st-muted { color:#94a3b8; font-size:.82rem; }
    .st-days { display:flex; gap:2px; align-items:flex-end; height:96px; padding-top:34px; margin:12px 0 6px; }
    .st-day { position:relative; flex:1; min-width:5px; height:100%; display:flex; flex-direction:column; justify-content:flex-end; }
    .st-bar { width:100%; background:#22c55e; border-radius:3px 3px 0 0; }
    .st-day:hover .st-bar { background:#86efac; }
    .st-tip { position:absolute; bottom:calc(var(--h) + 6px); left:50%; transform:translateX(-50%); background:#f8fafc; color:#0f172a;
      font-size:.75rem; font-weight:700; white-space:nowrap; padding:3px 8px; border-radius:7px; pointer-events:none; opacity:0; z-index:2; box-shadow:0 4px 14px rgba(0,0,0,.35); }
    .st-tip small { display:block; font-weight:500; color:#475569; font-size:.68rem; }
    .st-day:hover .st-tip { opacity:1; }
    .st-day.l .st-tip { left:0; transform:none; } .st-day.r .st-tip { left:auto; right:0; transform:none; }
    .st-row { display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-top:1px solid rgba(255,255,255,.07); font-size:.85rem; }
    .st-row span { color:#94a3b8; }`;
  try { const sh = new CSSStyleSheet(); sh.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; }
  catch { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); }

  /* ── letöltés ── */
  async function loadDownload() {
    const el = $("stDownload");
    const r = await fetch("/api/studio/info", { credentials: "include" }).catch(() => null);
    const info = r?.ok ? await r.json() : null;
    if (!info?.allowed) {
      el.innerHTML = `<p class="st-muted">A program jelenleg zárt tesztelés alatt áll, hamarosan itt lesz letölthető.</p>`;
      return;
    }
    if (!info.file) { el.innerHTML = `<p class="st-muted">Még nincs feltöltött csomag.</p>`; return; }
    const f = info.file;
    el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a class="st-btn primary" href="/api/studio/download">⬇ Letöltés (Windows) · v${esc(f.version)}</a>
        <span class="st-muted">${(f.size / 1048576).toFixed(0)} MB · ${new Date(f.date).toLocaleDateString("hu-HU")}</span></div>
      <p class="st-muted" style="margin:8px 0 0">Csomagold ki egy mappába, és indítsd a „Padlizsan Studio.exe”-t. Ez a link mindig a legújabb változatot adja; a program maga is szól, ha van frissebb.</p>`;
  }

  /* ── API-kulcsok ── */
  async function loadKeys() {
    const list = $("stKeyList");
    try {
      const r = await fetch("/api/user/api-keys", { credentials: "include" });
      if (!r.ok) throw 0;
      const { keys } = await r.json();
      list.innerHTML = keys.length ? keys.map(k => `<div class="st-key"><div><b>${esc(k.label || "Névtelen kulcs")}</b> <code style="color:#888">${esc(k.prefix)}…</code>
          <small>Létrehozva: ${fmtDate(k.created_at)} · Utoljára használva: ${fmtDate(k.last_used_at)}</small></div>
          <button class="st-btn" data-revoke="${k.id}">Visszavonás</button></div>`).join("")
        : `<p class="st-muted">Még nincs API-kulcsod. Hozz létre egyet, és másold be a programba.</p>`;
    } catch { list.innerHTML = `<p class="st-muted" style="color:#f87171">Nem sikerült betölteni a kulcsokat.</p>`; }
  }
  $("stKeyCreate").addEventListener("click", async () => {
    const st = $("stKeyStatus"); st.textContent = "";
    const r = await fetch("/api/user/api-keys", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: $("stKeyLabel").value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { st.textContent = d.error || "Hiba történt."; st.style.color = "#f87171"; return; }
    $("stKeyNewValue").textContent = d.key;
    $("stKeyNew").hidden = false;
    $("stKeyLabel").value = "";
    loadKeys();
  });
  $("stKeyCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("stKeyNewValue").textContent); $("stKeyStatus").textContent = "Kimásolva ✔"; $("stKeyStatus").style.color = ""; }
    catch { $("stKeyStatus").textContent = "Jelöld ki és másold kézzel."; }
  });
  $("stKeyList").addEventListener("click", async e => {
    const id = e.target.closest("[data-revoke]")?.dataset.revoke;
    if (!id || !confirm("Biztosan visszavonod ezt a kulcsot? Az ezt használó program azonnal kiesik.")) return;
    const r = await fetch(`/api/user/api-keys/${id}`, { method: "DELETE", credentials: "include" });
    $("stKeyStatus").textContent = r.ok ? "Kulcs visszavonva." : "Nem sikerült visszavonni.";
    $("stKeyNew").hidden = true;
    loadKeys();
  });

  /* ── saját statisztika ── */
  async function loadStats() {
    const box = $("stStats");
    const nav = `<div class="st-nav"><button class="st-btn" id="stPrev">‹</button><span class="st-month">${esc(label(month))}</span>
      <button class="st-btn" id="stNext" ${month >= curMonth ? "disabled" : ""}>›</button></div>`;
    box.innerHTML = nav + '<p class="st-muted">Betöltés…</p>';
    const bind = () => {
      $("stPrev").onclick = () => { month = shift(month, -1); loadStats(); };
      $("stNext").onclick = () => { if (month < curMonth) { month = shift(month, 1); loadStats(); } };
    };
    bind();
    let d;
    try { const r = await fetch(`/api/studio/my-stats?month=${month}`, { credentials: "include" }); d = await r.json(); if (!r.ok) throw 0; }
    catch { box.innerHTML = nav + '<p class="st-muted" style="color:#f87171">A statisztika most nem érhető el.</p>'; bind(); return; }
    const max = Math.max(1, ...d.byDay.map(x => x.pages));
    const bars = d.byDay.map((x, i) => {
      const h = Math.max(2, Math.round(60 * x.pages / max)), dt = new Date(x.key + "T12:00:00");
      const edge = i < 3 ? " l" : i >= d.byDay.length - 3 ? " r" : "";
      return `<div class="st-day${edge}" style="--h:${h}px"><div class="st-tip">${x.pages} oldal · ${pt(x.points)} pont<small>${dt.toLocaleDateString("hu-HU", { month: "short", day: "numeric" })}, ${DAYS_HU[dt.getDay()]}</small></div><div class="st-bar" style="height:${h}px"></div></div>`;
    }).join("");
    box.innerHTML = nav + (d.pages ? `
      <div style="display:flex;gap:28px;flex-wrap:wrap"><div><div class="st-big">${d.pages}</div><div class="st-muted">lefordított oldal</div></div>
        <div><div class="st-big">${pt(d.points)}</div><div class="st-muted">felhasznált pont</div></div>
        <div><div class="st-big">${d.pages ? pt(d.points / d.pages) : "–"}</div><div class="st-muted">pont / oldal</div></div></div>
      <div class="st-days">${bars}</div>
      ${d.byModel.map(m => `<div class="st-row"><span>${esc(m.key)}</span><strong>${m.pages} oldal · ${pt(m.points)} pont</strong></div>`).join("")}`
      : '<p class="st-muted">Ebben a hónapban nem fordítottál a Padlizsan Studióval.</p>');
    bind();
  }

  // a profil csak belépve tölt be; az /api/user/api-keys 401-et ad, ha nem
  fetch("/api/user/api-keys", { credentials: "include" }).then(r => {
    if (!r.ok) return;
    sec.style.display = "";
    loadDownload(); loadKeys(); loadStats();
    if (location.hash === "#studio") setTimeout(() => sec.scrollIntoView({ behavior: "smooth" }), 300);
  });
})();
