// Padlizsan Studio kérdőív (2026-11-15): az e-mailben kapott egyedi link (?t=...) alapján
(function () {
  const token = new URLSearchParams(location.search).get("t") || "";
  const $ = (id) => document.getElementById(id);
  const urlap = $("urlap"), betolt = $("betolt"), kesz = $("kesz"), hiba = $("hiba"), kuld = $("kuld");

  function vege(html) {
    betolt.hidden = true; urlap.hidden = true;
    kesz.innerHTML = html; kesz.hidden = false;
  }

  if (!token) { vege("Ez a link hiányos. Kérlek, az e-mailben kapott linket használd."); return; }

  fetch("/api/studio/survey/" + encodeURIComponent(token))
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) return vege(d.error || "Érvénytelen link.");
      if (d.answered) return vege("Ezt a kérdőívet már kitöltötted – köszönjük! 💜<br><a href=\"/\">Vissza a főoldalra</a>");
      const nev = document.createElement("strong");
      nev.textContent = d.username;
      $("koszones").textContent = "Szia, ";
      $("koszones").appendChild(nev);
      $("koszones").append("! Segíts jobbá tenni a Studiót!");
      betolt.hidden = true; urlap.hidden = false;
    })
    .catch(() => vege("Nem sikerült betölteni. Próbáld újra később."));

  urlap.addEventListener("submit", (e) => {
    e.preventDefault();
    hiba.textContent = "";
    const f = new FormData(urlap);
    const body = {};
    for (const k of ["install", "key", "translate", "gpu"]) {
      const v = f.get(k);
      if (!v) { hiba.textContent = "Kérlek, az 1–4. kérdésre válaszolj."; return; }
      body[k] = v;
    }
    body.comment = f.get("comment") || "";
    kuld.disabled = true;
    fetch("/api/studio/survey/" + encodeURIComponent(token), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { hiba.textContent = d.error || "Hiba történt."; kuld.disabled = false; return; }
        vege("🎉 Köszönjük a válaszaidat!<br><strong>+" + d.points + " pontot</strong> írtunk jóvá a fiókodon.<br><br><a href=\"/\">Vissza a főoldalra</a>");
      })
      .catch(() => { hiba.textContent = "Nem sikerült beküldeni, próbáld újra."; kuld.disabled = false; });
  });
})();
