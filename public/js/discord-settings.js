/* ══════════════════════════════════════════════════════════
   Beállítások → Discord: fiók-összekapcsolás és támogatói rang
   ══════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  let inviteUrl = "https://discord.gg/Hq6SysgZXC";

  const ERROR_TEXT = {
    taken: "Ez a Discord-fiók már egy másik weboldali fiókhoz van kapcsolva.",
    access_denied: "Megszakítottad az összekapcsolást a Discordon.",
    state: "Az összekapcsolás lejárt vagy érvénytelen volt — próbáld újra.",
    token_exchange: "A Discord nem fogadta el a bejelentkezést — próbáld újra.",
    identity: "Nem sikerült lekérni a Discord-fiókod adatait — próbáld újra.",
    not_configured: "A Discord-összekapcsolás még nincs beállítva a szerveren.",
    server: "Szerverhiba történt — próbáld újra később.",
  };

  // notice: { kind: "ok"|"warn"|"error"|"", text, invite? }
  function showNotice(n) {
    const box = $("discordSyncNotice");
    if (!box) return;
    if (!n) { box.classList.add("hidden"); return; }
    box.className = `discord-notice ${n.kind || ""}`;
    box.textContent = n.text;
    if (n.invite) {
      box.append(" ");
      const a = document.createElement("a");
      a.href = inviteUrl; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Csatlakozás a szerverhez →";
      box.append(a);
    }
  }

  function noticeForSync(r) {
    if (!r) return null;
    switch (r.status) {
      case "ok":
        if (!r.role) {
          return (r.removed || []).length
            ? { kind: "warn", text: `Jelenleg nincs aktív támogatásod, ezért a támogatói rangot (${r.removed.join(", ")}) elvettük.` }
            : { kind: "", text: "Jelenleg nincs aktív támogatásod, így támogatói rang nem jár. Ha támogatni kezdesz, a rangot automatikusan megkapod." };
        }
        return { kind: "ok", text: (r.added || []).length ? `✅ Megkaptad a(z) „${r.role}” rangot a Discordon!` : `✅ A(z) „${r.role}” rang rendben van a Discordon.` };
      case "admin_skip":
        return { kind: "", text: "Admin fiók: a Discord-rangjaidat a bot nem módosítja, azokat kézzel kezeljük." };
      case "not_member":
        return { kind: "warn", text: "Még nem vagy tagja a Discord szerverünknek. Csatlakozz, és a rangot fél órán belül automatikusan megkapod (vagy nyomd meg a „Rang frissítése” gombot).", invite: true };
      case "bot_offline":
        return { kind: "warn", text: "A Discord bot éppen nem elérhető — a rangot hamarosan automatikusan megkapod." };
      default:
        return { kind: "error", text: "Nem sikerült a rang frissítése. Próbáld újra később." };
    }
  }

  async function loadStatus() {
    try {
      const r = await fetch("/api/discord/status", { credentials: "include" });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      if (s.inviteUrl) inviteUrl = s.inviteUrl;
      $("discord-loading").classList.add("hidden");
      $("discord-notconfigured").classList.toggle("hidden", s.configured || s.linked);
      $("discord-disconnected").classList.toggle("hidden", s.linked || !s.configured);
      $("discord-connected").classList.toggle("hidden", !s.linked);
      if (s.linked) {
        $("discordUsername").textContent = s.username || "—";
        $("discordRole").textContent = s.admin
          ? "— (Admin fiók, a bot nem módosítja)"
          : (s.role || "nincs (nincs aktív támogatás)");
      }
      return s;
    } catch {
      $("discord-loading").textContent = "Nem sikerült betölteni a Discord-állapotot.";
      return null;
    }
  }

  $("discordConnectBtn")?.addEventListener("click", () => {
    window.location.href = "/api/discord/connect";
  });

  $("discordSyncBtn")?.addEventListener("click", async () => {
    const btn = $("discordSyncBtn");
    btn.disabled = true;
    try {
      const r = await fetch("/api/discord/sync", { method: "POST", credentials: "include" });
      const data = await r.json().catch(() => ({}));
      showNotice(r.ok ? noticeForSync(data) : { kind: "error", text: data.error || "Nem sikerült a rang frissítése." });
      await loadStatus();
    } finally {
      setTimeout(() => { btn.disabled = false; }, 3000);
    }
  });

  $("discordDisconnectBtn")?.addEventListener("click", async () => {
    const btn = $("discordDisconnectBtn");
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1";
      btn.textContent = "Biztosan? A támogatói rangot is elveszíted — kattints újra";
      setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "Leválasztás"; }, 5000);
      return;
    }
    btn.disabled = true;
    try {
      const r = await fetch("/api/discord/disconnect", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(r.status);
      showNotice(null);
      await loadStatus();
    } catch {
      showNotice({ kind: "error", text: "Nem sikerült a leválasztás. Próbáld újra." });
    } finally {
      btn.disabled = false; btn.dataset.confirm = ""; btn.textContent = "Leválasztás";
    }
  });

  // Visszatérés a Discord összekapcsolásból (?tab=discord&discord=linked|error)
  const params = new URLSearchParams(location.search);
  if (params.get("tab") === "discord") {
    document.querySelector('.settings-nav button[data-tab="discord"]')?.click();
  }

  loadStatus().then(() => {
    const result = params.get("discord");
    if (result === "linked") {
      const sync = params.get("sync");
      showNotice(sync === "ok"
        ? { kind: "ok", text: "✅ Discord-fiók összekapcsolva! A rangod állapota lent látható — ha kell, frissítsd." }
        : noticeForSync({ status: sync }));
      if (sync === "ok") $("discordSyncBtn")?.click();
    } else if (result === "error") {
      const reason = params.get("reason");
      const text = ERROR_TEXT[reason] || "Nem sikerült az összekapcsolás. Próbáld újra.";
      const target = $("discord-connected").classList.contains("hidden") ? $("discord-disconnected") : null;
      if (target) {
        const p = document.createElement("div");
        p.className = "discord-notice error";
        p.textContent = text;
        target.prepend(p);
      } else {
        showNotice({ kind: "error", text });
      }
    }
    if (result) history.replaceState(null, "", "/settings.html?tab=discord");
  });
})();
