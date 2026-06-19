/* ============================================================
   stripe-settings.js — Stripe előfizetés kezelő a settings oldalon
   ============================================================ */

const TIER_LABELS = {
  tamogato: "Támogató",
  booster:  "Booster",
  szuper:   "Szuper Támogató",
};

const TIER_COLORS = {
  tamogato: "#6366f1",
  booster:  "#8b5cf6",
  szuper:   "#a78bfa",
};

let currentStripeStatus = null;

async function loadStripeStatus() {
  try {
    const res = await fetch("/api/shop/my-subscription", { credentials: "include" });
    if (!res.ok) { renderTierCards(null); return; }
    const data = await res.json();
    currentStripeStatus = data;
    renderStripeActiveBox(data);
    renderTierCards(data);
  } catch (e) {
    renderTierCards(null);
  }
}

function renderStripeActiveBox(data) {
  const box         = document.getElementById("stripe-active-box");
  const tierEl      = document.getElementById("stripeActiveTier");
  const periodEl    = document.getElementById("stripePeriodEnd");
  const cancelPend  = document.getElementById("stripe-cancel-pending");
  if (!box) return;

  const hasStripe = data && data.payment_source === "stripe" && data.active && data.tier;
  if (!hasStripe) { box.classList.add("hidden"); return; }

  box.classList.remove("hidden");
  if (tierEl) tierEl.textContent = data.tier;
  if (periodEl && data.stripe_period_end) {
    periodEl.textContent = new Date(data.stripe_period_end).toLocaleDateString("hu-HU");
  }

  // Stripe-ból lekérjük, hogy cancel_at_period_end-e
  fetch("/api/shop/subscription-detail", { credentials: "include" })
    .then(r => r.ok ? r.json() : null)
    .then(detail => {
      if (detail?.cancel_at_period_end && cancelPend) {
        cancelPend.classList.remove("hidden");
        const unsubBtn = document.getElementById("stripeUnsubBtn");
        if (unsubBtn) unsubBtn.disabled = true;
      }
    }).catch(() => {});
}

function renderTierCards(data) {
  const container = document.getElementById("stripe-tiers");
  if (!container) return;

  const activeTier = (data?.payment_source === "stripe" && data?.active) ? data.tier : null;

  fetch("/api/shop/tiers", { credentials: "include" })
    .then(r => r.ok ? r.json() : [])
    .then(tiers => {
      container.innerHTML = tiers.map(t => {
        const isActive = activeTier === t.tier;
        const color    = TIER_COLORS[t.id] || "#7c3aed";
        return `
          <div style="background:#1a1a28;border:1px solid ${isActive ? color : "#2a2a3a"};border-radius:12px;padding:16px 20px;min-width:180px;flex:1;max-width:220px">
            <div style="color:${color};font-weight:700;font-size:1rem;margin-bottom:4px">${t.name}</div>
            <div style="color:#ccc;font-size:1.2rem;font-weight:700;margin-bottom:4px">${t.price.toLocaleString("hu-HU")} Ft<span style="font-size:0.7rem;color:#888;font-weight:400">/hó</span></div>
            <div style="color:#888;font-size:0.8rem;margin-bottom:14px">${t.description}</div>
            ${isActive
              ? `<span style="color:${color};font-size:0.83rem;font-weight:600">✓ Aktív előfizetés</span>`
              : `<button onclick="stripeSubscribe('${t.id}')" style="background:${color};color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:0.85rem;width:100%">Előfizetés</button>`
            }
          </div>`;
      }).join("");
    }).catch(() => {
      container.innerHTML = "<p style='color:#888;font-size:0.85rem'>Tier adatok nem elérhetők.</p>";
    });
}

async function stripeSubscribe(tierId) {
  const statusEl = document.getElementById("stripe-sub-status");
  if (statusEl) statusEl.textContent = "Átirányítás Stripe-ra...";
  try {
    const res = await fetch("/api/shop/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = "❌ " + (data.error || "Hiba");
      return;
    }
    window.location.href = data.url;
  } catch (e) {
    if (statusEl) statusEl.textContent = "❌ Hálózati hiba";
  }
}

window.stripeSubscribe = stripeSubscribe;

const unsubBtn = document.getElementById("stripeUnsubBtn");
if (unsubBtn) {
  unsubBtn.addEventListener("click", async () => {
    if (!confirm("Biztosan lemondod az előfizetést? Az aktuális időszak végéig aktív marad.")) return;
    const statusEl = document.getElementById("stripeUnsubStatus");
    try {
      const res = await fetch("/api/shop/subscription", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        if (statusEl) statusEl.textContent = "✅ " + (data.message || "Lemondva");
        unsubBtn.disabled = true;
        const cancelPend = document.getElementById("stripe-cancel-pending");
        if (cancelPend) cancelPend.classList.remove("hidden");
      } else {
        if (statusEl) statusEl.textContent = "❌ " + (data.error || "Hiba");
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = "❌ Hálózati hiba";
    }
  });
}

// URL paraméter kezelés (Stripe redirect vissza)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("sub") === "success") {
  const tier = urlParams.get("tier");
  const statusEl = document.getElementById("stripe-sub-status");
  if (statusEl) statusEl.textContent = `✅ Sikeres előfizetés! ${tier ? "(" + tier + ")" : ""} — Hamarosan aktiválódik.`;
  history.replaceState({}, "", "/settings.html");
} else if (urlParams.get("sub") === "cancelled") {
  const statusEl = document.getElementById("stripe-sub-status");
  if (statusEl) statusEl.textContent = "❌ Előfizetés megszakítva.";
  history.replaceState({}, "", "/settings.html");
}

// Betöltés
loadStripeStatus();
