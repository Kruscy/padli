(async () => {
  const params = new URLSearchParams(location.search);
  const token  = params.get("token");
  const status = params.get("status");
  const box    = document.getElementById("box");

  async function render(icon, title, body) {
    box.innerHTML = `<div class="verify-icon">${icon}</div><h2>${title}</h2>${body}`;
  }

  // Ha a backend már átirányított státusszal
  if (status === "success") {
    return render("✅", "Email megerősítve!", `
      <p>Sikeresen megerősítetted az email címed.</p>
      <a href="/login.html?verified=1" class="btn">Bejelentkezés</a>`);
  }
  if (status === "expired") {
    return render("⏰", "A link lejárt", `
      <p>A megerősítő link lejárt. Kérj újat!</p>
      ${resendForm()}`);
  }
  if (status === "invalid" || status === "error") {
    return render("❌", "Érvénytelen link", `
      <p>Ez a link nem érvényes. Kérj újat!</p>
      ${resendForm()}`);
  }

  // Token van az URL-ben — átirányítjuk a backend verify endpointra
  if (token) {
    window.location.href = `/api/auth/verify-email?token=${encodeURIComponent(token)}`;
    return;
  }

  // Nincs token, nincs status
  render("✉️", "Email megerősítés", `
    <p>Add meg az email címed, és küldünk egy új megerősítő linket.</p>
    ${resendForm()}`);

  function resendForm() {
    return `
      <div id="resendSection">
        <input type="email" id="resendEmail" placeholder="email@example.com">
        <button onclick="resend()">📨 Új link kérése</button>
        <div id="resendMsg"></div>
      </div>`;
  }

  window.resend = async function() {
    const email = document.getElementById("resendEmail")?.value?.trim();
    const msg   = document.getElementById("resendMsg");
    if (!email) { if (msg) msg.textContent = "Add meg az email címet!"; return; }
    const btn = document.querySelector("#resendSection button");
    if (btn) btn.disabled = true;
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (msg) msg.textContent = "✅ Ha ez az email regisztrálva van, elküldtük a linket. Ellenőrizd a postaládád!";
    } catch {
      if (msg) msg.textContent = "❌ Hiba, próbáld újra.";
      if (btn) btn.disabled = false;
    }
  };
})();
