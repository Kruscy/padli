/* profile-birthdate.js – Születési dátum megjelenítése/szerkesztése a profil oldalon */

(async () => {
  const input = document.getElementById("birthDateInput");
  const btn   = document.getElementById("birthDateSaveBtn");
  const fb    = document.getElementById("birthDateFeedback");
  if (!input || !btn) return;

  try {
    const res = await fetch("/api/user/birth-date");
    if (res.ok) {
      const data = await res.json();
      if (data.birth_date) {
        input.value = data.birth_date.slice(0, 10);
      }
    }
  } catch {}

  btn.addEventListener("click", async () => {
    const val = input.value;
    fb.textContent = "";

    if (!val) {
      fb.style.color = "#ef4444";
      fb.textContent = "Adj meg egy dátumot!";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Mentés...";

    try {
      const res = await fetch("/api/user/birth-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birth_date: val }),
      });
      const data = await res.json();

      if (res.ok) {
        fb.style.color = "#22c55e";
        fb.textContent = "✅ Mentve!";
      } else {
        fb.style.color = "#ef4444";
        fb.textContent = "❌ " + (data.error || "Hiba történt");
      }
    } catch {
      fb.style.color = "#ef4444";
      fb.textContent = "❌ Szerverrel nem sikerült kapcsolatba lépni";
    } finally {
      btn.disabled = false;
      btn.textContent = "Mentés";
    }
  });
})();
