// Android-app letöltő oldal: a legfrissebb verzió száma és mérete (2026-11-15)
fetch("/api/app/apk-info").then((r) => r.json()).then((d) => {
  if (!d.version) return;
  document.getElementById("verzio").textContent =
    "Verzió: " + d.version + " · " + (d.size / 1048576).toFixed(1) + " MB · Android 8.0 vagy újabb";
}).catch(() => {});
