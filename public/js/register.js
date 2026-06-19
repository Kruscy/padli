const form = document.getElementById("registerForm");
const errorEl = document.getElementById("error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  const username = document.getElementById("username").value.trim();
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const password2 = document.getElementById("password2").value;
  const gdpr     = document.getElementById("gdprAccept").checked;

  if (!username || !email || !password || !password2) {
    errorEl.textContent = "Minden mező kötelező";
    return;
  }

  if (password !== password2) {
    errorEl.textContent = "A jelszavak nem egyeznek";
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = "A jelszó legalább 6 karakter legyen";
    return;
  }

  if (!gdpr) {
    errorEl.textContent = "Az Adatvédelmi Nyilatkozat elfogadása kötelező a regisztrációhoz";
    return;
  }

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, gdprAccepted: true })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || "Regisztráció sikertelen";
      return;
    }

    // Email verifikáció szükséges
    if (data.needsVerification) {
      form.style.display = "none";
      errorEl.style.color = "#22c55e";
      errorEl.innerHTML = `
        <div style="text-align:center;padding:24px 0">
          <div style="font-size:3rem;margin-bottom:12px">✉️</div>
          <h3 style="color:#a78bfa;margin:0 0 10px">Erősítsd meg az email címed!</h3>
          <p style="color:#bbb;line-height:1.7">Küldtünk egy megerősítő emailt a <strong style="color:#fff">${email}</strong> címre.</p>
          <p style="color:#bbb;font-size:0.88rem">Kattints a levélben lévő linkre, majd bejelentkezhetsz.</p>
          <p style="color:#888;font-size:0.82rem;margin-top:16px">Nem kaptad meg? Ellenőrizd a spam mappát, vagy <a href="/login.html" style="color:#a78bfa">bejelentkezés oldalon</a> kérhetsz újat.</p>
        </div>`;
      return;
    }

    location.href = "/";
  } catch (err) {
    errorEl.textContent = "Szerver hiba";
  }
});
