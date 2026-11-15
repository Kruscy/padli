// Android-app letöltő oldal (2026-11-15): verzió, letöltésszám, keret, visszajelzés-űrlap
(function () {
  const $ = (id) => document.getElementById(id);
  fetch("/api/app/apk-info").then((r) => r.json()).then((d) => {
    if (d.version) $("verzio").textContent = "Verzió: " + d.version + " · " + (d.size / 1048576).toFixed(1) + " MB · Android 8.0 vagy újabb";
    if (d.downloads) $("szamlalo").textContent = "📥 Eddig " + d.downloads + " olvasó töltötte le" + (d.users ? " · " + d.users + " használja bejelentkezve" : "");
    if (d.free_limit) $("keret").textContent = d.free_limit + (d.free_limit > 10 ? " (az áramszünetig megemelve!)" : "");
  }).catch(() => {});

  let rating = null;
  document.querySelectorAll("#csillagok span").forEach((s) => s.addEventListener("click", () => {
    rating = Number(s.dataset.v);
    document.querySelectorAll("#csillagok span").forEach((x) => x.classList.toggle("be", Number(x.dataset.v) <= rating));
  }));
  $("helper").addEventListener("change", () => { $("kapcsolatDoboz").hidden = !$("helper").checked; });

  $("urlap").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData($("urlap"));
    const body = {
      install: f.get("install") || null, rating, wishes: f.getAll("wishes"),
      wish_text: $("wish_text").value, bug_text: $("bug_text").value, device: $("device").value,
      helper: $("helper").checked, contact: $("contact").value,
    };
    $("kuld").disabled = true; $("eredmeny").textContent = ""; $("eredmeny").className = "";
    fetch("/api/app/feedback", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { $("eredmeny").textContent = d.error || "Hiba történt."; $("eredmeny").className = "hiba"; $("kuld").disabled = false; return; }
        $("urlap").reset(); rating = null;
        document.querySelectorAll("#csillagok span").forEach((x) => x.classList.remove("be"));
        $("kapcsolatDoboz").hidden = true;
        $("eredmeny").textContent = "Köszönjük! 💜 Minden visszajelzést elolvasunk."; $("eredmeny").className = "ok";
        $("kuld").disabled = false;
      })
      .catch(() => { $("eredmeny").textContent = "Nem sikerült beküldeni, próbáld újra."; $("eredmeny").className = "hiba"; $("kuld").disabled = false; });
  });
})();
