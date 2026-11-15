// Android-app belépés (2026-11-15): a bejelentkezett user engedélyezi az appot → padlizsan://auth?code=..&state=..
(function () {
  const p = new URLSearchParams(location.search);
  const state = p.get("state") || "", device = p.get("device") || "", ret = p.get("return") || "", challenge = p.get("cc") || "";
  const $ = (id) => document.getElementById(id);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) { $("szoveg").textContent = "Hiányos link. Indítsd a belépést az appból."; return; }
  fetch("/api/user/me", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      const u = me && (me.username || me.user?.username);
      if (!u) {
        location.href = "/login.html?redirect=" + encodeURIComponent(location.pathname + location.search);
        return;
      }
      $("szoveg").textContent = "";
      $("szoveg").append("Bejelentkezve: ", Object.assign(document.createElement("strong"), { textContent: u }),
        ". Engedélyezed, hogy a Padlizsan app" + (device ? " (" + device + ")" : "") + " a fiókodat használja?");
      $("engedely").hidden = false;
    })
    .catch(() => { $("hiba").textContent = "Nem sikerült betölteni, próbáld újra."; });

  $("engedely").addEventListener("click", () => {
    $("engedely").disabled = true;
    fetch("/api/app/auth/grant", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, device, return: ret, code_challenge: challenge }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { $("hiba").textContent = d.error || "Hiba történt."; $("engedely").disabled = false; return; }
        $("szoveg").textContent = ret ? "Kész! Visszatérhetsz a Padlizsan Studióba (ez az ablak bezárható)." : "Kész! Visszaviszünk az appba…";
        $("engedely").hidden = true;
        location.href = d.redirect;
      })
      .catch(() => { $("hiba").textContent = "Hiba történt, próbáld újra."; $("engedely").disabled = false; });
  });
})();
