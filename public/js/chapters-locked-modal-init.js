async function showLockedModal() {
  const modal   = document.getElementById("lockedModal");
  const content = document.getElementById("lockPaywallContent");

  let patreonConnected = false;
  try {
    const res = await fetch("/api/patreon/status", { credentials: "include" });
    if (res.ok) { const d = await res.json(); patreonConnected = !!d.connected; }
  } catch {}

  if (!window._buildPaywallHTML) {
    await new Promise(r => {
      const t = setInterval(() => { if (window._buildPaywallHTML) { clearInterval(t); r(); } }, 50);
      setTimeout(() => { clearInterval(t); r(); }, 2000);
    });
  }
  if (content) {
    content.innerHTML = window._buildPaywallHTML
      ? window._buildPaywallHTML({ patreonConnected })
      : `<p style="color:#bbb">Prémium tartalom. <a href="/settings.html" style="color:#a78bfa">Előfizetés</a></p>`;
  }

  modal.classList.remove("hidden");
  document.getElementById("lockCloseBtn").onclick  = () => modal.classList.add("hidden");
  document.getElementById("lockedBackdrop").onclick = () => modal.classList.add("hidden");
}

function showAgeRestrictedModal() {
  const modal   = document.getElementById("lockedModal");
  const content = document.getElementById("lockPaywallContent");

  if (content) {
    content.innerHTML = `<p style="color:#bbb">🔞 Ez a tartalom csak 18 éven felülieknek elérhető. A fiókodhoz rögzített születési dátum alapján jelenleg nem férhetsz hozzá.</p>`;
  }

  modal.classList.remove("hidden");
  document.getElementById("lockCloseBtn").onclick  = () => modal.classList.add("hidden");
  document.getElementById("lockedBackdrop").onclick = () => modal.classList.add("hidden");
}
