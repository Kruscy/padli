async function checkBirthDate() {
  try {
    const res = await fetch("/api/user/birth-date");
    if (!res.ok) return;
    const data = await res.json();
    if (!data.birth_date) {
      showBirthDatePopup();
    }
  } catch {}
}

function showBirthDatePopup() {
  const overlay = document.createElement("div");
  overlay.id = "birthDateOverlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0,0,0,0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    font-family: Poppins, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="
      background: #0f1220;
      border: 1px solid #2a2a3e;
      border-radius: 16px;
      padding: 2rem;
      max-width: 400px;
      width: 90%;
      text-align: center;
      color: #fff;
    ">
      <div style="font-size: 2.5rem; margin-bottom: 1rem;">🍆</div>
      <h2 style="margin: 0 0 0.5rem; font-size: 1.3rem;">Üdvözlünk a PadlizsanFanSub-on!</h2>
      <p style="color: #aaa; font-size: 0.9rem; margin-bottom: 1.5rem;">
        Kérjük add meg a születési dátumodat a folytatáshoz.
      </p>
      <input
        type="date"
        id="birthDateInput"
        style="
          width: 100%;
          background: #1a1f35;
          border: 1px solid #2a2a3e;
          border-radius: 8px;
          padding: 10px;
          color: #fff;
          font-size: 1rem;
          font-family: Poppins, sans-serif;
          box-sizing: border-box;
          margin-bottom: 1rem;
        "
      >
      <p id="birthDateError" style="color:#f87171; font-size:0.85rem; margin-bottom:0.5rem; display:none;">
        Kérjük adj meg érvényes születési dátumot!
      </p>
      <button
        id="birthDateSaveBtn"
        style="
          background: linear-gradient(135deg, #7c3aed, #5b21b6);
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 12px 32px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          width: 100%;
          font-family: Poppins, sans-serif;
        "
      >
        Mentés
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("birthDateSaveBtn").addEventListener("click", async () => {
    const val = document.getElementById("birthDateInput").value;
    const errorEl = document.getElementById("birthDateError");

    if (!val) {
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";

    const res = await fetch("/api/user/birth-date", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birth_date: val })
    });

    if (res.ok) {
      overlay.remove();
    }
  });
}

// Megvárjuk hogy a user be legyen töltve
function waitAndCheck() {
  if (window.currentUser) {
    checkBirthDate();
  } else {
    setTimeout(waitAndCheck, 200);
  }
}

waitAndCheck();
