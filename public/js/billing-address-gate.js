async function checkBillingAddress() {
  try {
    const res = await fetch("/api/user/billing-address");
    if (!res.ok) return;
    const data = await res.json();
    if (data.required) {
      showBillingAddressPopup();
    }
  } catch {}
}

function showBillingAddressPopup() {
  if (document.getElementById("billingAddressOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "billingAddressOverlay";
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
    padding: 16px;
    box-sizing: border-box;
  `;

  overlay.innerHTML = `
    <div style="
      background: #0f1220;
      border: 1px solid #2a2a3e;
      border-radius: 16px;
      padding: 2rem;
      max-width: 440px;
      width: 100%;
      text-align: center;
      color: #fff;
      box-sizing: border-box;
    ">
      <div style="font-size: 2.5rem; margin-bottom: 1rem;">🧾</div>
      <h2 style="margin: 0 0 0.5rem; font-size: 1.3rem;">Számlázási cím szükséges</h2>
      <p style="color: #aaa; font-size: 0.9rem; margin-bottom: 1rem;">
        Adminisztrációs okokból szükségünk van a számlázási címedre (lakcím), hogy a Stripe-előfizetésedhez kapcsolódó számládat helyesen tudjuk kiállítani.
      </p>
      <p style="color: #888; font-size: 0.8rem; margin-bottom: 1.25rem;">
        Az adatot kizárólag a számla kiállításához használjuk, harmadik félnek nem adjuk ki (a számlázó rendszerünk kivételével), és nem használjuk fel más célra.
        Bővebben az <a href="/privacy.html" target="_blank" style="color:#a855f7;">Adatvédelmi Nyilatkozatban</a>.
      </p>
      <input
        id="billingFullName"
        type="text"
        placeholder="Teljes valódi neved (pl. Kovács János)"
        style="
          width: 100%;
          background: #1a1f35;
          border: 1px solid #2a2a3e;
          border-radius: 8px;
          padding: 10px;
          color: #fff;
          font-size: 0.95rem;
          font-family: Poppins, sans-serif;
          box-sizing: border-box;
          margin-bottom: 0.5rem;
        "
      />
      <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
        <input
          id="billingPostCode"
          type="text"
          placeholder="Irányítószám"
          maxlength="4"
          inputmode="numeric"
          style="
            width: 35%;
            background: #1a1f35;
            border: 1px solid #2a2a3e;
            border-radius: 8px;
            padding: 10px;
            color: #fff;
            font-size: 0.95rem;
            font-family: Poppins, sans-serif;
            box-sizing: border-box;
          "
        />
        <input
          id="billingCity"
          type="text"
          placeholder="Város"
          style="
            width: 65%;
            background: #1a1f35;
            border: 1px solid #2a2a3e;
            border-radius: 8px;
            padding: 10px;
            color: #fff;
            font-size: 0.95rem;
            font-family: Poppins, sans-serif;
            box-sizing: border-box;
          "
        />
      </div>
      <div style="display:flex; gap:0.5rem; margin-bottom:1rem;">
        <input
          id="billingStreet"
          type="text"
          placeholder="Utca, közterület neve"
          style="
            width: 65%;
            background: #1a1f35;
            border: 1px solid #2a2a3e;
            border-radius: 8px;
            padding: 10px;
            color: #fff;
            font-size: 0.95rem;
            font-family: Poppins, sans-serif;
            box-sizing: border-box;
          "
        />
        <input
          id="billingHouseNumber"
          type="text"
          placeholder="Házszám"
          style="
            width: 35%;
            background: #1a1f35;
            border: 1px solid #2a2a3e;
            border-radius: 8px;
            padding: 10px;
            color: #fff;
            font-size: 0.95rem;
            font-family: Poppins, sans-serif;
            box-sizing: border-box;
          "
        />
      </div>
      <p id="billingAddressError" style="color:#f87171; font-size:0.85rem; margin-bottom:0.5rem; display:none;">
        Kérjük tölts ki minden mezőt!
      </p>
      <button
        id="billingAddressSaveBtn"
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

  document.getElementById("billingAddressSaveBtn").addEventListener("click", async () => {
    const full_name = document.getElementById("billingFullName").value.trim();
    const post_code = document.getElementById("billingPostCode").value.trim();
    const city = document.getElementById("billingCity").value.trim();
    const street = document.getElementById("billingStreet").value.trim();
    const houseNumber = document.getElementById("billingHouseNumber").value.trim();
    const errorEl = document.getElementById("billingAddressError");
    const saveBtn = document.getElementById("billingAddressSaveBtn");

    if (!full_name || !/^\d{4}$/.test(post_code) || !city || !street || !houseNumber) {
      errorEl.textContent = "Kérjük tölts ki minden mezőt (az irányítószám 4 számjegy legyen)!";
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";
    saveBtn.disabled = true;
    saveBtn.textContent = "Ellenőrzés...";

    const res = await fetch("/api/user/billing-address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name, post_code, city, street, house_number: houseNumber }),
    });

    if (res.ok) {
      overlay.remove();
    } else {
      const data = await res.json().catch(() => ({}));
      errorEl.textContent = data.error || "Hiba történt, próbáld újra.";
      errorEl.style.display = "block";
      saveBtn.disabled = false;
      saveBtn.textContent = "Mentés";
    }
  });
}

function waitAndCheckBillingAddress() {
  if (window.currentUser) {
    checkBillingAddress();
  } else {
    setTimeout(waitAndCheckBillingAddress, 200);
  }
}

waitAndCheckBillingAddress();
