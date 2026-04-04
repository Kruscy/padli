const TIER_CONFIG = {
  "szuper": { cls: "section-szuper-tamogato", label: "Szuper Támogató", emoji: "👑" },
  "booster": { cls: "section-booster",        label: "Booster",         emoji: "⚡" },
  "tamogato": { cls: "section-tamogato",      label: "Támogató",        emoji: "💜" },
};

// Normalizálja a DB string értékét kulccsá
function normalizeTier(tier) {
  if (!tier) return "tamogato";
  const s = String(tier).toLowerCase().trim()
    .replace(/á/g, "a").replace(/é/g, "e").replace(/ó/g, "o")
    .replace(/ő/g, "o").replace(/ú/g, "u").replace(/ü/g, "u")
    .replace(/ű/g, "u").replace(/í/g, "i");
  if (s.includes("szuper") || s.includes("super")) return "szuper";
  if (s.includes("boost"))  return "booster";
  if (s.includes("admin"))  return null; // Admin nem jelenik meg a listában
  return "tamogato";
}

// Sorrend: szuper → booster → tamogato
const TIER_ORDER = ["szuper", "booster", "tamogato"];

function getTierConfig(key) {
  return TIER_CONFIG[key] || TIER_CONFIG["tamogato"];
}

(async () => {
  const root = document.getElementById("supportersRoot");
  try {
    const res = await fetch("/api/supporters");
    if (!res.ok) throw new Error("API error " + res.status);
    const supporters = await res.json();

    root.innerHTML = "";

    if (!supporters.length) {
      root.innerHTML = '<p class="supporters-empty">Még nincsenek aktív támogatók.</p>';
      return;
    }

    // Csoportosítás normalizált kulcs szerint
    const groups = {};
    supporters.forEach(s => {
      const key = normalizeTier(s.tier);
      if (!key) return; // Admin kihagyva
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });

    // Fix sorrend: szuper → booster → tamogato
    TIER_ORDER.filter(k => groups[k]).forEach(tierKey => {
      const cfg = getTierConfig(tierKey);
      const members = groups[tierKey];

      const section = document.createElement("div");
      section.className = "tier-section " + cfg.cls;

      const header = document.createElement("div");
      header.className = "tier-header";

      const h2 = document.createElement("h2");
      h2.textContent = cfg.emoji + " " + cfg.label;

      const count = document.createElement("span");
      count.className = "tier-count";
      count.textContent = members.length + " támogató";

      header.appendChild(h2);
      header.appendChild(count);

      const grid = document.createElement("div");
      grid.className = "supporters-grid";

      members.forEach(s => {
        const card = document.createElement("div");
        card.className = "supporter-card";

        const img = document.createElement("img");
        img.className = "supporter-avatar";
        img.src = s.avatar || "/uploads/default.png";
        img.alt = s.username || "?";
        img.onerror = function() { this.src = "/uploads/default.png"; };

        const name = document.createElement("div");
        name.className = "supporter-name";
        name.textContent = s.username || "Névtelen";

        const lbl = document.createElement("div");
        lbl.className = "supporter-tier-label";
        lbl.textContent = cfg.emoji + " " + cfg.label;

        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(lbl);
        grid.appendChild(card);
      });

      section.appendChild(header);
      section.appendChild(grid);
      root.appendChild(section);
    });

  } catch(err) {
    console.error("Supporters load error:", err);
    root.innerHTML = '<p class="supporters-empty">Nem sikerült betölteni a támogatókat.</p>';
  }
})();
