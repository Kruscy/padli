(function () {
  const fmt = n => Number(n).toLocaleString("hu-HU") + " Ft";
  let _piPass = "";

  function initPatreonInvoice() {
    const lockPass = document.getElementById("piLockPass");
    const lockBtn  = document.getElementById("piLockBtn");
    const lockErr  = document.getElementById("piLockError");
    const amountEl = document.getElementById("piAmount");
    const descEl   = document.getElementById("piDescription");
    const sendBtn  = document.getElementById("piSendBtn");
    const statusEl = document.getElementById("piStatus");

    if (!lockBtn) return;

    lockPass.addEventListener("keydown", e => {
      if (e.key === "Enter") lockBtn.click();
    });

    lockBtn.addEventListener("click", async () => {
      const pass = lockPass.value.trim();
      lockErr.style.display = "none";
      if (!pass) { lockErr.textContent = "Add meg a jelszót!"; lockErr.style.display = "block"; return; }
      lockBtn.disabled = true; lockBtn.textContent = "⏳ Ellenőrzés...";
      try {
        const res = await fetch("/api/patreon-invoice", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pass, amount: 0, description: "check" }),
        });
        const data = await res.json();
        if (data.error === "Helytelen jelszó") {
          lockErr.textContent = "Helytelen jelszó!"; lockErr.style.display = "block";
        } else {
          _piPass = pass;
          document.getElementById("piLockScreen").style.display = "none";
          document.getElementById("piPanel").style.display = "block";
          lockPass.value = "";
        }
      } catch {
        lockErr.textContent = "Hálózati hiba"; lockErr.style.display = "block";
      } finally {
        lockBtn.disabled = false; lockBtn.textContent = "Belépés";
      }
    });

    function updatePreview() {
      const amount = parseInt(amountEl.value || "0", 10);
      const desc   = descEl.value || "IT-műszaki támogatás";
      const preview = document.getElementById("piPreview");
      if (amount > 0) {
        document.getElementById("piPreviewDesc").textContent  = desc;
        document.getElementById("piPreviewNet").textContent   = fmt(amount);
        document.getElementById("piPreviewGross").textContent = fmt(amount);
        preview.style.display = "block";
      } else {
        preview.style.display = "none";
      }
    }

    amountEl.addEventListener("input", updatePreview);
    descEl.addEventListener("input", updatePreview);

    sendBtn.addEventListener("click", async () => {
      const amount      = parseInt(amountEl.value || "0", 10);
      const description = descEl.value.trim();
      if (!amount || amount < 1) { statusEl.style.color = "#f87171"; statusEl.textContent = "❌ Adj meg érvényes összeget!"; return; }
      if (!description) { statusEl.style.color = "#f87171"; statusEl.textContent = "❌ A megnevezés nem lehet üres!"; return; }
      if (!confirm(`Biztosan kiállítod a számlát?\n\nCím: Patreon Ireland Limited, German Branch\nMegnevezés: ${description}\nÖsszeg: ${fmt(amount)} (AAM 0%)\nFizetési mód: Átutalás (már teljesített)`)) return;
      sendBtn.disabled = true; sendBtn.textContent = "⏳ Kiállítás..."; statusEl.textContent = "";
      try {
        const res = await fetch("/api/patreon-invoice", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: _piPass, amount, description }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          statusEl.innerHTML = `✅ <strong>Számla kiállítva!</strong> Számlaszám: <strong>${data.invoiceNumber}</strong> — ${fmt(data.amount)}`;
          statusEl.style.color = "#4ade80";
          amountEl.value = ""; updatePreview();
        } else {
          statusEl.style.color = "#f87171"; statusEl.textContent = "❌ " + (data.error || "Ismeretlen hiba");
        }
      } catch {
        statusEl.style.color = "#f87171"; statusEl.textContent = "❌ Hálózati hiba";
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = "📤 Számla kiállítása";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPatreonInvoice);
  } else {
    initPatreonInvoice();
  }
})();
