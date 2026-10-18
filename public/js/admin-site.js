// Admin: Oldal beállításai + verzió / frissítés (server/routes/site-admin.js)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let loaded = false;

async function loadSite() {
  const res = await fetch("/api/admin/site");
  if (!res.ok) { $("siteStatus").textContent = "Nem sikerült betölteni."; return; }
  const { site, canEdit, version } = await res.json();
  $("siteName").value = site.name;
  $("siteUrl").value = site.url;
  $("sitePatreon").value = site.patreonUrl || "";
  $("siteDescription").value = site.description || "";
  for (const id of ["siteName", "siteUrl", "sitePatreon", "siteDescription", "siteSave"]) $(id).disabled = !canEdit;

  const v = $("siteVersion");
  v.classList.toggle("update", !!version.updateAvailable);
  v.innerHTML = version.updateAvailable
    ? `⬆️ Új verzió érhető el: <strong>${esc(version.latest)}</strong> (most: ${esc(version.current)}).
       ${version.releaseUrl ? `<a href="${esc(version.releaseUrl)}" target="_blank" rel="noopener">Mi változott?</a>` : ""}
       Frissítés: <code>docker compose pull &amp;&amp; docker compose up -d</code> (lásd UPDATING.md)`
    : `Verzió: <strong>${esc(version.current)}</strong>${version.disabled ? " (frissítés-ellenőrzés kikapcsolva)"
       : version.latest ? " — naprakész" : " — a legújabb kiadás most nem ellenőrizhető"}`;
}

document.querySelector('.tab-btn[data-tab="tab-site"]')?.addEventListener("click", () => {
  if (!loaded) { loaded = true; loadSite(); }
});

$("siteForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("siteStatus");
  status.textContent = "Mentés…";
  const res = await fetch("/api/admin/site", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: $("siteName").value, url: $("siteUrl").value,
      patreonUrl: $("sitePatreon").value, description: $("siteDescription").value,
    }),
  });
  const data = await res.json().catch(() => ({}));
  status.textContent = res.ok ? "Elmentve." : (data.error || "Hiba a mentéskor.");
});
