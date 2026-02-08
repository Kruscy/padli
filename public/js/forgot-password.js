document.getElementById("forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const msg = document.getElementById("msg");

  msg.textContent = "⏳ Küldés...";

  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });

  msg.textContent = res.ok
    ? "📧 Ha létezik fiók, küldtünk egy e-mailt."
    : "❌ Hiba történt";
});

