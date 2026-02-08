const usernameEl = document.getElementById("username");
const emailEl = document.getElementById("email");
const oldPwEl = document.getElementById("oldPassword");
const newPwEl = document.getElementById("newPassword");
const newPw2El = document.getElementById("newPassword2");
const form = document.getElementById("settingsForm");
const statusEl = document.getElementById("status");

/* ===== BETÖLTÉS ===== */
fetch("/api/settings")
  .then(r => {
    if (!r.ok) throw new Error();
    return r.json();
  })
  .then(d => {
    usernameEl.value = d.username;
    emailEl.value = d.email;
  })
  .catch(() => {
    statusEl.textContent = "Nem sikerült betölteni az adatokat";
  });

/* ===== MENTÉS ===== */
form.addEventListener("submit", async e => {
  e.preventDefault();
  statusEl.textContent = "";

  if (newPwEl.value || newPw2El.value) {
    if (!oldPwEl.value) {
      statusEl.textContent = "Régi jelszó megadása kötelező";
      return;
    }
    if (newPwEl.value !== newPw2El.value) {
      statusEl.textContent = "Az új jelszavak nem egyeznek";
      return;
    }
    if (newPwEl.value.length < 8) {
      statusEl.textContent = "Az új jelszó túl rövid";
      return;
    }
  }

  const payload = {
    email: emailEl.value,
    oldPassword: oldPwEl.value || null,
    newPassword: newPwEl.value || null
  };

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok) {
    statusEl.textContent = data.error || "Hiba történt";
    return;
  }

  statusEl.textContent = "Beállítások mentve ✔";
  oldPwEl.value = "";
  newPwEl.value = "";
  newPw2El.value = "";
});
document.querySelectorAll(".settings-nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;

    document
      .querySelectorAll(".settings-nav button")
      .forEach(b => b.classList.remove("active"));

    document
      .querySelectorAll(".tab")
      .forEach(t => t.classList.remove("active"));

    btn.classList.add("active");
    document
      .getElementById("tab-" + btn.dataset.tab)
      .classList.add("active");
  });
});
