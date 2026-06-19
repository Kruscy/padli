const PACKAGE_ICONS = {
  starter: "⚡",
  pro:     "🔥",
  ultra:   "💎",
  max:     "👑",
};

const PACKAGE_COLORS = {
  starter: "#3b82f6",
  pro:     "#7c3aed",
  ultra:   "#ec4899",
  max:     "#f59e0b",
};

/* ── BETÖLTÉS ────────────────────────────────────────────── */
async function init() {
  // URL paraméter
  const params = new URLSearchParams(window.location.search);
  if (params.get("success")) showMsg("✅ Sikeres vásárlás! A kreditek néhány másodpercen belül jóváíródnak.", "success");
  if (params.get("cancelled")) showMsg("❌ A vásárlás megszakadt.", "error");

  // Pontok
  try {
    const r = await fetch("/api/padlicrome/me", { credentials: "include" });
    if (r.ok) {
      const data = await r.json();
      document.getElementById("shopPoints").textContent = data.points ?? 0;
    }
  } catch {}

  // Csomagok
  await loadPackages();

  // Rendelések
  await loadOrders();
}

async function loadPackages() {
  try {
    const r = await fetch("/api/shop/packages", { credentials: "include" });
    const packages = await r.json();
    renderPackages(packages);
  } catch {
    document.getElementById("shopGrid").innerHTML = '<p style="color:#ef4444">Nem sikerült betölteni.</p>';
  }
}

function renderPackages(packages) {
  const grid = document.getElementById("shopGrid");
  grid.innerHTML = "";

  packages.forEach((pkg, i) => {
    const icon  = PACKAGE_ICONS[pkg.id]  || "💡";
    const color = PACKAGE_COLORS[pkg.id] || "#7c3aed";
    const perImg = Math.round(pkg.price / pkg.points * 10) / 10;
    const isBest = pkg.id === "ultra";

    const card = document.createElement("div");
    card.className = "shop-card" + (isBest ? " shop-card-best" : "");
    card.style.setProperty("--card-color", color);
    card.innerHTML = `
      ${isBest ? '<div class="shop-badge">Legjobb ár</div>' : ""}
      <div class="shop-card-icon">${icon}</div>
      <div class="shop-card-name">${pkg.name}</div>
      <div class="shop-card-credits">${pkg.points.toLocaleString("hu-HU")}</div>
      <div class="shop-card-unit">kredit</div>
      <div class="shop-card-per">${perImg} Ft / kép</div>
      <div class="shop-card-price">${pkg.price.toLocaleString("hu-HU")} Ft</div>
      <button class="shop-btn" onclick="checkout('${pkg.id}', this)">
        Megvásárlom
      </button>
    `;
    grid.appendChild(card);
  });
}

/* ── CHECKOUT ────────────────────────────────────────────── */
async function checkout(packageId, btn) {
  btn.disabled = true;
  btn.textContent = "⏳ Átirányítás...";

  try {
    const r = await fetch("/api/shop/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ packageId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Hiba");
    window.location.href = data.url;
  } catch (err) {
    showMsg("❌ Hiba: " + err.message, "error");
    btn.disabled = false;
    btn.textContent = "Megvásárlom";
  }
}

/* ── RENDELÉSEK ──────────────────────────────────────────── */
async function loadOrders() {
  try {
    const r = await fetch("/api/shop/orders", { credentials: "include" });
    const orders = await r.json();
    if (!orders.length) return;

    const list = document.getElementById("shopOrdersList");
    list.innerHTML = orders.map(o => `
      <div class="shop-order-item">
        <span class="shop-order-pkg">${o.package_id}</span>
        <span class="shop-order-pts">+${o.points} kredit</span>
        <span class="shop-order-amt">${o.amount_huf?.toLocaleString("hu-HU")} Ft</span>
        <span class="shop-order-date">${new Date(o.created_at).toLocaleDateString("hu-HU")}</span>
      </div>
    `).join("");

    document.getElementById("shopOrders").style.display = "block";
  } catch {}
}

/* ── ÜZENET ──────────────────────────────────────────────── */
function showMsg(msg, type) {
  const el = document.getElementById("shopMsg");
  el.className = "shop-msg shop-msg-" + type;
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => el.style.display = "none", 6000);
}

init();
