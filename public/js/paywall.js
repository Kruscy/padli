/* ============================================================
   paywall.js — Prémium tartalom zárolt állapot UI
   Chapters modal + Reader lock page közösen használja
   ============================================================ */

const TIER_LIST = [
  { id: "tamogato", name: "Támogató",       price: 500,  desc: "Korai hozzáférés + exkluzív tartalmak", color: "#6366f1" },
  { id: "booster",  name: "Booster",        price: 1000, desc: "Booster juttatások + pont bónusz",       color: "#8b5cf6" },
  { id: "szuper",   name: "Szuper Támogató", price: 2000, desc: "Minden előny + prioritás támogatás",    color: "#a78bfa" },
];

export async function subscribeToTier(tierId) {
  const btn = document.querySelector(`[data-tier="${tierId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  try {
    const res = await fetch("/api/shop/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Hiba történt");
      if (btn) { btn.disabled = false; btn.textContent = "Előfizetés"; }
      return;
    }
    window.location.href = data.url;
  } catch {
    alert("Hálózati hiba");
    if (btn) { btn.disabled = false; btn.textContent = "Előfizetés"; }
  }
}

window._paywallSubscribe  = subscribeToTier;
window._buildPaywallHTML  = buildPaywallHTML;

export function buildPaywallHTML({ patreonConnected, returnUrl = "" }) {
  const encodedReturn = encodeURIComponent(returnUrl || window.location.href);

  const tierCards = TIER_LIST.map(t => `
    <div class="paywall-tier-card">
      <div class="paywall-tier-name" style="color:${t.color}">${t.name}</div>
      <div class="paywall-tier-price">${t.price.toLocaleString("hu-HU")} Ft<span class="paywall-tier-mo">/hó</span></div>
      <div class="paywall-tier-desc">${t.desc}</div>
      <button class="paywall-tier-btn" data-tier="${t.id}"
        style="background:${t.color}"
        onclick="window._paywallSubscribe('${t.id}')">
        Előfizetés
      </button>
    </div>
  `).join("");

  const patreonSecondary = patreonConnected
    ? `<a href="https://patreon.com/Padlizsanfansub" target="_blank" class="paywall-patreon-link">💜 Előfizetés a Patreonon</a>`
    : `<a href="/api/patreon/connect" class="paywall-patreon-link">💜 Patreon összekapcsolása</a>`;

  return `
    <div class="paywall-header">
      <img src="/assets/padlizsanfansublakat.png" style="height:64px;margin-bottom:10px">
      <h2 class="paywall-title">🔒 Prémium tartalom</h2>
      <p class="paywall-subtitle">Ez a fejezet még nem érhető el ingyenesen.</p>
      <div class="paywall-new-badge">✨ Újdonság — fizethetsz bankkártyával, Patreon nem kell!</div>
    </div>
    <div class="paywall-tiers">${tierCards}</div>
    <div class="paywall-divider">
      <span>vagy</span>
    </div>
    <div class="paywall-patreon-row">
      ${patreonSecondary}
    </div>
  `;
}
