(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = d => d ? new Date(d).toLocaleString("hu-HU", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const TYPE_LABEL = {
    login_failed: "Sikertelen belépés", login_success: "Sikeres belépés", register: "Regisztráció",
    password_reset_request: "Jelszó-visszaállítás kérés", auth_rate_limited: "Belépési korlát",
    rate_limited: "Korlátba futott (429)", scanner_probe: "Sebezhetőség-keresés", admin_probe: "Admin-próbálgatás",
    write_burst: "Tömeges írás (spam?)", request_flood: "Kérés-áradat (DoS?)", blocked_request: "Tiltott IP kérése",
    discord_raid: "Discord raid / feltört fiók", ip_blocked: "IP tiltva", ip_unblocked: "IP tiltás feloldva",
  };
  const label = t => TYPE_LABEL[t] ? `${TYPE_LABEL[t]} <span class="sec-code">${esc(t)}</span>` : `<span class="sec-code">${esc(t)}</span>`;
  const sev = s => `<span class="sec-sev ${esc(s)}">${{ info: "info", warn: "figyelmeztetés", high: "súlyos" }[s] || esc(s)}</span>`;

  function showError(msg) { const e = $("secError"); e.textContent = msg; e.hidden = !msg; }

  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", ...opts });
    if (r.status === 403 || r.status === 401) throw new Error("Ehhez az oldalhoz nincs jogosultságod.");
    if (!r.ok) throw new Error("Hiba a betöltésnél (HTTP " + r.status + ")");
    return r.json();
  }

  async function loadSummary() {
    const s = await api(`/api/admin/security/summary?hours=${$("secHours").value}`);
    $("secAlerts").innerHTML = s.alerts.length
      ? s.alerts.map(a => `<div class="sec-alert"><span class="sec-time">${fmt(a.created_at)}</span> ${esc(a.text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>")}</div>`).join("")
      : `<p class="sec-muted">Nincs riasztás ebben az időszakban. 👍</p>`;

    $("secTypes").innerHTML = `<tr><th>Esemény</th><th>Súlyosság</th><th>Darab</th></tr>` + (s.byType.length
      ? s.byType.map(t => `<tr><td><a href="#" data-type="${esc(t.type)}">${label(t.type)}</a></td><td>${sev(t.severity)}</td><td>${t.n}${t.suppressed ? ` <span class="sec-muted">(+${t.suppressed} összevonva)</span>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="3" class="sec-muted">Nincs esemény.</td></tr>`);

    $("secCountries").innerHTML = `<tr><th>Ország</th><th>Gyanús esemény</th></tr>` + (s.countries.length
      ? s.countries.map(c => `<tr><td>${esc(c.country)}</td><td>${c.n}</td></tr>`).join("")
      : `<tr><td colspan="2" class="sec-muted">Nincs gyanús esemény.</td></tr>`);

    $("secIps").innerHTML = `<tr><th>IP</th><th>Ország</th><th>Gyanús / össz.</th><th>Típusok</th><th>Fiókok</th><th>Utoljára</th><th></th></tr>` + (s.topIps.length
      ? s.topIps.map(i => `<tr class="${i.suspicious ? "sec-hot" : ""}">
          <td><a href="#" data-ip="${esc(i.ip)}">${esc(i.ip)}</a></td><td>${esc(i.country || "?")}</td>
          <td>${i.suspicious} / ${i.n}</td><td>${(i.types || []).map(t => `<span class="sec-code">${esc(t)}</span>`).join(" ")}</td>
          <td>${esc((i.users || []).slice(0, 4).join(", "))}${(i.users || []).length > 4 ? " …" : ""}</td>
          <td>${fmt(i.last_seen)}</td>
          <td><button class="sec-btn small danger" data-block="${esc(i.ip)}">Tiltás</button></td></tr>`).join("")
      : `<tr><td colspan="7" class="sec-muted">Nincs adat.</td></tr>`);

    $("secBlocks").innerHTML = `<tr><th>IP</th><th>Indok</th><th>Tiltotta</th><th>Mióta</th><th>Lejár</th><th></th></tr>` + (s.blocks.length
      ? s.blocks.map(b => `<tr><td>${esc(b.ip)}</td><td>${esc(b.reason || "")}</td><td>${esc(b.created_by || "")}</td>
          <td>${fmt(b.created_at)}</td><td>${b.expires_at ? fmt(b.expires_at) : "végleges"}</td>
          <td><button class="sec-btn small" data-unblock="${esc(b.ip)}">Feloldás</button></td></tr>`).join("")
      : `<tr><td colspan="6" class="sec-muted">Nincs tiltott IP.</td></tr>`);
  }

  let lastId = null;
  async function loadEvents(append = false) {
    const q = new URLSearchParams({ limit: "100" });
    if ($("fType").value.trim()) q.set("type", $("fType").value.trim());
    if ($("fIp").value.trim()) q.set("ip", $("fIp").value.trim());
    if ($("fUser").value.trim()) q.set("user", $("fUser").value.trim());
    if ($("fSusp").checked) q.set("severity", "suspicious");
    if ($("fHideInfo").checked) q.set("hideInfo", "1");
    if (append && lastId) q.set("before", lastId);
    const { events } = await api(`/api/admin/security/events?${q}`);
    const rows = events.map(e => `<tr class="${e.severity !== "info" ? "sec-hot" : ""}">
        <td class="sec-time">${fmt(e.created_at)}</td><td>${label(e.type)}</td><td>${sev(e.severity)}</td>
        <td><a href="#" data-ip="${esc(e.ip || "")}">${esc(e.ip || "—")}</a> ${e.country ? `<span class="sec-muted">${esc(e.country)}</span>` : ""}</td>
        <td>${esc(e.username || "")}</td>
        <td class="sec-path" title="${esc(e.user_agent || "")}">${esc(e.method || "")} ${esc(e.path || "")}</td>
        <td class="sec-details">${e.details ? esc(JSON.stringify(e.details)) : ""}</td></tr>`).join("");
    const head = `<tr><th>Idő</th><th>Esemény</th><th>Súly.</th><th>IP</th><th>Fiók</th><th>Kérés</th><th>Részletek</th></tr>`;
    if (append) $("secEvents").insertAdjacentHTML("beforeend", rows);
    else $("secEvents").innerHTML = head + (rows || `<tr><td colspan="7" class="sec-muted">Nincs a szűrőnek megfelelő esemény.</td></tr>`);
    lastId = events.length ? events[events.length - 1].id : lastId;
    $("secMore").hidden = events.length < 100;
  }

  const ACTION_LABEL = { chapter_unlock_adjust: "Feloldási idő eltolva", chapter_unlock_now: "Feloldva most" };
  let lastActionId = null;
  async function loadAdminActions(append = false) {
    const q = new URLSearchParams({ limit: "100" });
    if ($("aAdmin").value.trim()) q.set("admin", $("aAdmin").value.trim());
    if ($("aTarget").value.trim()) q.set("target", $("aTarget").value.trim());
    if (append && lastActionId) q.set("before", lastActionId);
    const { actions } = await api(`/api/admin/security/admin-actions?${q}`);
    const rows = actions.map(a => {
      const d = a.details || {};
      const change = a.action === "chapter_unlock_adjust"
        ? `${d.hours > 0 ? "+" : ""}${d.hours} óra`
        : "azonnal";
      return `<tr>
        <td class="sec-time">${fmt(a.created_at)}</td><td>${esc(a.admin_username || "?")}</td>
        <td>${esc(ACTION_LABEL[a.action] || a.action)}</td><td>${esc(a.target_title || "")}</td>
        <td>${esc(change)}</td><td class="sec-time">${fmt(d.before)} → ${fmt(d.after)}</td></tr>`;
    }).join("");
    const head = `<tr><th>Idő</th><th>Admin</th><th>Művelet</th><th>Fejezet</th><th>Változás</th><th>Feloldás: előtte → utána</th></tr>`;
    if (append) $("secAdminActions").insertAdjacentHTML("beforeend", rows);
    else $("secAdminActions").innerHTML = head + (rows || `<tr><td colspan="6" class="sec-muted">Még nincs naplózott admin-művelet.</td></tr>`);
    lastActionId = actions.length ? actions[actions.length - 1].id : lastActionId;
    $("aMore").hidden = actions.length < 100;
  }

  async function refresh() {
    showError("");
    try { await Promise.all([loadSummary(), loadEvents(), loadAdminActions()]); }
    catch (e) { showError(e.message); }
  }

  async function block(ip, reason, hours) {
    await api("/api/admin/security/block", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, reason, hours: hours || null }),
    });
    await refresh();
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-ip],[data-type],[data-block],[data-unblock]");
    if (!t) return;
    e.preventDefault();
    try {
      if (t.dataset.ip !== undefined) { $("fIp").value = t.dataset.ip; $("fHideInfo").checked = false; await loadEvents(); $("secEvents").scrollIntoView({ behavior: "smooth" }); }
      else if (t.dataset.type) { $("fType").value = t.dataset.type; $("fHideInfo").checked = false; await loadEvents(); $("secEvents").scrollIntoView({ behavior: "smooth" }); }
      else if (t.dataset.block) {
        if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Biztos? (24 óra)"; setTimeout(() => { t.dataset.confirm = ""; t.textContent = "Tiltás"; }, 4000); return; }
        await block(t.dataset.block, "Biztonsági naplóból", 24);
      }
      else if (t.dataset.unblock) {
        await api(`/api/admin/security/block/${encodeURIComponent(t.dataset.unblock)}`, { method: "DELETE" });
        await refresh();
      }
    } catch (err) { showError(err.message); }
  });

  $("secBlockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await block($("secBlockIp").value.trim(), $("secBlockReason").value.trim(), $("secBlockHours").value);
      $("secBlockIp").value = ""; $("secBlockReason").value = "";
    } catch (err) { showError(err.message); }
  });

  $("aApply").addEventListener("click", () => loadAdminActions().catch(err => showError(err.message)));
  $("aMore").addEventListener("click", () => loadAdminActions(true).catch(err => showError(err.message)));
  $("secRefresh").addEventListener("click", refresh);
  $("secHours").addEventListener("change", refresh);
  $("fApply").addEventListener("click", () => loadEvents().catch(err => showError(err.message)));
  $("secMore").addEventListener("click", () => loadEvents(true).catch(err => showError(err.message)));

  refresh();
  setInterval(() => { if (!document.hidden) loadSummary().catch(() => {}); }, 60000);
})();
