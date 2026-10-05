const token = new URLSearchParams(location.search).get("token");
const msg = document.getElementById("msg");

document.getElementById("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const password = document.getElementById("password").value;
  if (password.length < 8) {
    msg.textContent = "❌ A jelszó legalább 8 karakter legyen";
    return;
  }

  let data = {};
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password })
  });
  try { data = await res.json(); } catch {}

  msg.textContent = res.ok
    ? "✅ Jelszó frissítve. Minden eszközön kiléptettünk — jelentkezz be újra. Átirányítás..."
    : "❌ " + (data.error || "Hibás vagy lejárt link");

  if (res.ok) {
    setTimeout(() => {
      location.href = "/login.html";
    }, 2500);
  }
});
