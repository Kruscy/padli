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

document
  .getElementById("patreonConnectBtn")
  ?.addEventListener("click", () => {
    location.href = "/api/patreon/connect";
  });

loadPatreonStatus();
