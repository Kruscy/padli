async function loadPatreonStatus() {
  const res = await fetch("/api/patreon/status");

  if (!res.ok) return;

  const data = await res.json();

  const connected = document.getElementById("patreon-connected");
  const disconnected = document.getElementById("patreon-disconnected");

  if (!data.connected) {
    disconnected.classList.remove("hidden");
    connected.classList.add("hidden");
  } else {
    document.getElementById("patreonActive").textContent =
      data.active ? "Aktív ✅" : "Inaktív ❌";

    document.getElementById("patreonTier").textContent =
      data.tier || "—";

    connected.classList.remove("hidden");
    disconnected.classList.add("hidden");
  }
}

/* CONNECT */
document
  .getElementById("patreonConnectBtn")
  ?.addEventListener("click", () => {
    location.href = "/api/patreon/connect";
  });

/* DISCONNECT */
document
  .getElementById("patreonDisconnectBtn")
  ?.addEventListener("click", async () => {
    if (!confirm("Biztosan leválasztod a Patreon fiókot?")) return;

    await fetch("/api/patreon/disconnect", {
      method: "POST"
    });

    location.reload();
  });

/* SUCCESS MESSAGE */
if (location.search.includes("patreon=connected")) {
  alert("💜 Patreon sikeresen összekapcsolva!");
}

/* ERROR MESSAGE */
if (location.search.includes("patreon=error")) {
  alert("❌ Patreon hiba történt!");
}

loadPatreonStatus();
