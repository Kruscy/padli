const usernameEl = document.getElementById("username");
const emailEl = document.getElementById("email");
const oldPwEl = document.getElementById("oldPassword");
const newPwEl = document.getElementById("newPassword");
const newPw2El = document.getElementById("newPassword2");
const form = document.getElementById("settingsForm");

/* ===== BETÖLTÉS ===== */
fetch("/api/settings")
  .then(r => r.json())
  .then(d => {
    usernameEl.value = d.username;
    usernameEl.disabled = true;
    emailEl.value = d.email;
  });

/* ===== MENTÉS ===== */
form.addEventListener("submit", async e => {
  e.preventDefault();

  if (newPwEl.value && newPwEl.value !== newPw2El.value) {
    alert("Az új jelszavak nem egyeznek");
    return;
  }

  const payload = {
    email: emailEl.value || undefined,
    oldPassword: oldPwEl.value || undefined,
    newPassword: newPwEl.value || undefined
  };

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error);
    return;
  }

  alert("Beállítások mentve ✔");
  form.reset();
});
