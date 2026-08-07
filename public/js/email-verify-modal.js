/* email-verify-modal.js — középre felugró emlékeztető, ha a user emailje
   nincs visszaigazolva. auth-check.js hívja meg, miután betöltötte a
   /api/user/me választ (email, email_verified mezők). */

const EMAIL_VERIFY_DISMISS_KEY = "emailVerifyModalDismissed";

function injectEmailVerifyStyles() {
  if (document.getElementById("emailVerifyModalStyles")) return;
  const style = document.createElement("style");
  style.id = "emailVerifyModalStyles";
  style.textContent = `
    .email-verify-modal { position: fixed; inset: 0; z-index: 2500; display: flex; align-items: center; justify-content: center; }
    .email-verify-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.75); }
    .email-verify-box { position: relative; background: #1a1a2e; border-radius: 16px; padding: 2.5rem 2rem; max-width: 420px; width: 90%; z-index: 1; color: #fff; text-align: center; font-family: Poppins, sans-serif; }
    .email-verify-box h2 { font-size: 1.3rem; margin: 0 0 0.75rem; }
    .email-verify-box p { font-size: 0.92rem; line-height: 1.6; opacity: 0.85; margin: 0 0 1.25rem; }
    .email-verify-box .email-highlight { color: #c4b5fd; font-weight: 700; }
    .email-verify-resend-btn { display: inline-block; background: linear-gradient(135deg,#7c3aed,#5b21b6); color: #fff; border: none; padding: 12px 28px; border-radius: 10px; font-size: 0.95rem; font-weight: 700; cursor: pointer; transition: transform 0.2s ease; font-family: inherit; }
    .email-verify-resend-btn:hover { transform: translateY(-2px); }
    .email-verify-resend-btn:disabled { opacity: 0.6; cursor: default; transform: none; }
    .email-verify-feedback { margin-top: 0.9rem; font-size: 0.85rem; font-weight: 600; min-height: 1.2em; }
    .email-verify-close { margin-top: 1.25rem; background: none; border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 0.88rem; font-family: inherit; display: block; margin-left: auto; margin-right: auto; }
  `;
  document.head.appendChild(style);
}

function closeEmailVerifyModal() {
  document.getElementById("emailVerifyModal")?.remove();
  sessionStorage.setItem(EMAIL_VERIFY_DISMISS_KEY, "1");
}

window.showEmailVerifyModal = function (email) {
  if (!email) return;
  if (sessionStorage.getItem(EMAIL_VERIFY_DISMISS_KEY)) return;
  if (document.getElementById("emailVerifyModal")) return;

  injectEmailVerifyStyles();

  const wrap = document.createElement("div");
  wrap.className = "email-verify-modal";
  wrap.id = "emailVerifyModal";
  wrap.innerHTML = `
    <div class="email-verify-backdrop" id="emailVerifyBackdrop"></div>
    <div class="email-verify-box">
      <h2>✉️ Erősítsd meg az email címed!</h2>
      <p>A <span class="email-highlight"></span> címre korábban küldtünk egy megerősítő linket. Ha nem találod, kérhetsz egy újat.</p>
      <button type="button" class="email-verify-resend-btn" id="emailVerifyResendBtn">📧 Megerősítő email újraküldése</button>
      <div class="email-verify-feedback" id="emailVerifyFeedback"></div>
      <button type="button" class="email-verify-close" id="emailVerifyCloseBtn">Később</button>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector(".email-highlight").textContent = email;

  document.getElementById("emailVerifyBackdrop").addEventListener("click", closeEmailVerifyModal);
  document.getElementById("emailVerifyCloseBtn").addEventListener("click", closeEmailVerifyModal);

  document.getElementById("emailVerifyResendBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const feedback = document.getElementById("emailVerifyFeedback");
    btn.disabled = true;
    feedback.style.color = "#aaa";
    feedback.textContent = "Küldés...";
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        feedback.style.color = "#22c55e";
        feedback.textContent = "✅ Elküldve! Nézd meg a postaládád (spam mappát is).";
      } else {
        feedback.style.color = "#ef4444";
        feedback.textContent = "❌ Hiba történt, próbáld később.";
        btn.disabled = false;
      }
    } catch {
      feedback.style.color = "#ef4444";
      feedback.textContent = "❌ Szerverrel nem sikerült kapcsolatba lépni.";
      btn.disabled = false;
    }
  });
};
