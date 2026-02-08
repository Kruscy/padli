const token = new URLSearchParams(location.search).get("token");
const msg = document.getElementById("msg");

document.getElementById("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const password = document.getElementById("password").value;

  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password })
  });

  msg.textContent = res.ok
    ? "✅ Jelszó frissítve. Átirányítás..."
    : "❌ Hibás vagy lejárt link";

  if (res.ok) {
    setTimeout(() => {
      location.href = "/login.html";
    }, 2000);
  }
});
