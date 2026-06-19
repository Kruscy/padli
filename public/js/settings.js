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
    renderEmailStatus(d.email_verified, d.email);
  })
  .catch(() => {
    statusEl.textContent = "Nem sikerült betölteni az adatokat";
  });

function renderEmailStatus(verified, email) {
  const existing = document.getElementById("emailVerifyStatus");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "emailVerifyStatus";
  if (verified) {
    el.style.cssText = "margin-top:6px;padding:8px 14px;background:#0f1e14;border:1px solid #166534;border-radius:8px;font-size:0.84rem;color:#86efac;display:flex;align-items:center;gap:8px";
    el.innerHTML = `✅ <span>Email cím megerősítve</span>`;
  } else {
    el.style.cssText = "margin-top:6px;padding:10px 14px;background:#1e1230;border:1px solid #7c3aed;border-radius:8px;font-size:0.85rem;color:#c4b5fd;display:flex;align-items:center;gap:10px;flex-wrap:wrap";
    el.innerHTML = `⚠️ <span style="flex:1">Nincs megerősítve. Ellenőrizd a postaládád!</span>
      <button id="resendVerifySettingsBtn" style="background:#7c3aed;color:#fff;border:none;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem">📨 Újraküldés</button>
      <span id="resendVerifySettingsStatus" style="font-size:0.8rem;color:#888"></span>`;
  }
  emailEl.parentElement.insertAdjacentElement("afterend", el);
  if (!verified) {
    document.getElementById("resendVerifySettingsBtn").addEventListener("click", async () => {
      const btn = document.getElementById("resendVerifySettingsBtn");
      const st = document.getElementById("resendVerifySettingsStatus");
      btn.disabled = true;
      try {
        await fetch("/api/auth/resend-verification", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        st.textContent = "✅ Elküldve!";
      } catch { st.textContent = "❌ Hiba"; btn.disabled = false; }
    });
  }
}

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

  if (data.emailChanged) {
    statusEl.style.color = "#a78bfa";
    statusEl.textContent = "✉️ Megerősítő emailt küldtük az új email címre. Kattints a linkre!";
    renderEmailStatus(false, emailEl.value);
  } else {
    statusEl.style.color = "";
    statusEl.textContent = "Beállítások mentve ✔";
  }
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
/* ===== COOKIE BEÁLLÍTÁS ===== */
function updateCookieStatusUI() {
  const consent = localStorage.getItem('cookieConsent');
  const btn = document.getElementById('cookieStatusBtn');
  const txt = document.getElementById('cookieStatusText');
  if (!btn || !txt) return;
  if (consent === 'accepted') {
    btn.textContent = 'Letiltom';
    btn.style.borderColor = '#7f1d1d';
    btn.style.color = '#fca5a5';
    txt.textContent = 'Jelenleg: engedélyezett';
  } else {
    btn.textContent = 'Engedélyezem';
    btn.style.borderColor = '#444';
    btn.style.color = '#ccc';
    txt.textContent = consent === 'declined' ? 'Jelenleg: letiltott' : 'Jelenleg: nem döntöttél';
  }
}

document.getElementById('cookieStatusBtn')?.addEventListener('click', () => {
  const consent = localStorage.getItem('cookieConsent');
  if (consent === 'accepted') {
    localStorage.setItem('cookieConsent', 'declined');
  } else {
    localStorage.setItem('cookieConsent', 'accepted');
    if (typeof loadMatomo === 'function') loadMatomo();
  }
  updateCookieStatusUI();
});

updateCookieStatusUI();

/* ===== GDPR ===== */
document.getElementById("gdprExportBtn")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("gdprStatus");
  try {
    const res = await fetch("/api/gdpr/export");
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (statusEl) { statusEl.textContent = d.error || "Hiba a letöltés során."; statusEl.style.color = "#f87171"; }
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "padlizsan-adatom.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    if (statusEl) { statusEl.textContent = "Hálózati hiba."; statusEl.style.color = "#f87171"; }
  }
});

document.getElementById("gdprDeleteBtn")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("gdprStatus");
  const ok = confirm(
    "Biztosan véglegesen törlöd a fiókodat?\n\nMinden adatod (olvasási előrehaladás, kedvencek, értékelések) visszavonhatatlanul törlődik."
  );
  if (!ok) return;

  const ok2 = confirm("Utolsó megerősítés: ez a művelet NEM vonható vissza. Folytatod?");
  if (!ok2) return;

  statusEl.textContent = "Törlés folyamatban...";
  statusEl.style.color = "#f87171";

  const res = await fetch("/api/gdpr/account", { method: "DELETE" });
  if (res.ok) {
    statusEl.textContent = "Fiók törölve. Átirányítás...";
    setTimeout(() => { window.location.href = "/"; }, 1500);
  } else {
    const d = await res.json().catch(() => ({}));
    statusEl.textContent = d.error || "Hiba történt a törlés során.";
  }
});

// Felhasználónév kiírása
fetch("/api/auth/me", { credentials: "include" })
  .then(r => r.ok ? r.json() : null)
  .then(d => {
    if (d?.username) {
      const el = document.getElementById("patreonUsername");
      if (el) el.textContent = d.username;
    }
  });
