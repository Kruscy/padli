// Telepítő varázsló (első indítás) — lásd server/routes/setup.js
const $ = (id) => document.getElementById(id);

const status = await fetch("/api/setup/status").then(r => r.json()).catch(() => null);
if (status && !status.needsSetup) location.replace("/");

$("siteUrl").value = location.origin;

$("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("setupError");
  err.textContent = "";
  if ($("password").value !== $("password2").value) {
    err.textContent = "A két jelszó nem egyezik.";
    return;
  }
  const body = Object.fromEntries(
    ["token", "siteName", "siteUrl", "patreonUrl", "username", "email", "password", "birthDate"].map(k => [k, $(k).value.trim()])
  );
  body.password = $("password").value; // a jelszót nem vágjuk le
  $("setupSubmit").disabled = true;
  try {
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Sikertelen telepítés.");
    location.replace("/admin.html");
  } catch (ex) {
    err.textContent = ex.message;
    $("setupSubmit").disabled = false;
  }
});
