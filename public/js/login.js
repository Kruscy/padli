const form = document.getElementById("loginForm");
const errorEl = document.getElementById("error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  const login = document.getElementById("login").value.trim();
  const password = document.getElementById("password").value;
  const remember = document.getElementById("rememberMe")?.checked;

  if (!login || !password) {
    errorEl.textContent = "Minden mező kötelező";
    return;
  }

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password, remember })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || "Hibás belépési adatok";
      return;
    }

    location.href = "/";
  } catch (err) {
    errorEl.textContent = "Server hiba";
  }
});
