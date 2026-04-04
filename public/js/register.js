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

    location.href = "/";
  } catch (err) {
    errorEl.textContent = "Szerver hiba";
  }
});
