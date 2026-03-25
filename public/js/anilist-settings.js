async function loadAniListStatus() {
  try {
    const res = await fetch("/api/anilist/status");
    const data = await res.json();

    const disconnected = document.getElementById("anilist-disconnected");
    const connected = document.getElementById("anilist-connected");

    if (data.connected) {
      disconnected.classList.add("hidden");
      connected.classList.remove("hidden");
      // 🔥 SYNC INFO
      if (data.pending > 0) {
        syncEl.textContent = `⏳ Szinkron folyamatban (${data.pending})`;
      } else {
        syncEl.textContent = `✔ Minden szinkronizálva`;
      }
    } else {
      disconnected.classList.remove("hidden");
      connected.classList.add("hidden");
    }

  } catch (err) {
    console.error("ANILIST STATUS ERROR:", err);
  }
}

// connect
document.getElementById("anilistConnectBtn")?.addEventListener("click", () => {
  window.location.href = "/api/anilist/connect";
});

// disconnect
document.getElementById("anilistDisconnectBtn")?.addEventListener("click", async () => {
  await fetch("/api/anilist/disconnect", { method: "POST" });
  loadAniListStatus(); // 🔥 reload helyett ez jobb
});

// 🔥 betöltéskor
loadAniListStatus();
