/* stats-widget.js – Olvasási statisztika widget */

(function () {
  let currentPeriod = "daily";
  let isOpen = false;

  /* ── WIDGET LÉTREHOZÁSA ──────────────────────────────────── */
  function createWidget() {
    // Toggle fül (csak asztali)
    const tab = document.createElement("div");
    tab.id = "statsTab";
    tab.innerHTML = "📊 Statisztika";
    tab.addEventListener("click", toggleWidget);
    document.body.appendChild(tab);

    // Widget panel
    const panel = document.createElement("div");
    panel.id = "statsPanel";
    panel.innerHTML = `
      <div class="stats-header">
        <span class="stats-title">📊 Olvasási statisztika</span>
        <button class="stats-close" id="statsClose">✕</button>
      </div>
      <div class="stats-periods">
        <button class="stats-period-btn active" data-period="daily">Napi</button>
        <button class="stats-period-btn" data-period="weekly">Heti</button>
        <button class="stats-period-btn" data-period="monthly">Havi</button>
      </div>
      <div class="stats-list" id="statsList">
        <div class="stats-loading">Betöltés...</div>
      </div>
    `;
    document.body.appendChild(panel);

    // Bezárás gomb
    document.getElementById("statsClose").addEventListener("click", closeWidget);

    // Periódus gombok
    panel.querySelectorAll(".stats-period-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        panel.querySelectorAll(".stats-period-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentPeriod = btn.dataset.period;
        loadStats();
      });
    });

    // Mobil: inline widget az index.html-ben
    const inlineContainer = document.getElementById("statsInline");
    if (inlineContainer) {
      renderInlineWidget(inlineContainer);
    }
  }

  function renderInlineWidget(container) {
    container.innerHTML = `
      <div class="stats-inline-header">
        <span class="stats-title">📊 Olvasási statisztika</span>
      </div>
      <div class="stats-periods stats-periods-inline">
        <button class="stats-period-btn active" data-period="daily">Napi</button>
        <button class="stats-period-btn" data-period="weekly">Heti</button>
        <button class="stats-period-btn" data-period="monthly">Havi</button>
      </div>
      <div class="stats-list" id="statsListInline">
        <div class="stats-loading">Betöltés...</div>
      </div>
    `;
    container.querySelectorAll(".stats-period-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".stats-period-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentPeriod = btn.dataset.period;
        loadStats();
      });
    });
  }

  /* ── TOGGLE ──────────────────────────────────────────────── */
  function toggleWidget() {
    isOpen ? closeWidget() : openWidget();
  }

  function openWidget() {
    isOpen = true;
    const panel = document.getElementById("statsPanel");
    const tab = document.getElementById("statsTab");
    const main = document.querySelector("main.content");

    if (panel) panel.classList.add("open");
    if (tab) tab.classList.add("active");
    if (main) main.classList.add("stats-pushed");

    loadStats();
  }

  function closeWidget() {
    isOpen = false;
    const panel = document.getElementById("statsPanel");
    const tab = document.getElementById("statsTab");
    const main = document.querySelector("main.content");

    if (panel) panel.classList.remove("open");
    if (tab) tab.classList.remove("active");
    if (main) main.classList.remove("stats-pushed");
  }

  /* ── ADATOK BETÖLTÉSE ────────────────────────────────────── */
  async function loadStats() {
    const listEl = document.getElementById("statsList");
    const inlineEl = document.getElementById("statsListInline");

    [listEl, inlineEl].forEach(el => {
      if (el) el.innerHTML = '<div class="stats-loading">Betöltés...</div>';
    });

    try {
      const res = await fetch(`/api/stats/reading?period=${currentPeriod}`, { credentials: "include" });
      if (!res.ok) throw new Error("Hiba");
      const data = await res.json();
      renderStats(data, listEl);
      renderStats(data, inlineEl);
    } catch {
      [listEl, inlineEl].forEach(el => {
        if (el) el.innerHTML = '<div class="stats-empty">Nem sikerült betölteni</div>';
      });
    }
  }

  function renderStats(data, container) {
    if (!container) return;
    if (!data.length) {
      container.innerHTML = '<div class="stats-empty">Nincs adat ebben az időszakban</div>';
      return;
    }

    const max = Math.max(...data.map(d => d.total_reads)) || 1;
    container.innerHTML = data.map((item, i) => `
      <a href="/chapters.html?slug=${encodeURIComponent(item.slug)}" class="stats-item">
        <div class="stats-rank">${i + 1}</div>
        ${item.cover_url
          ? `<img src="${item.cover_url}" class="stats-cover" loading="lazy" alt="">`
          : `<div class="stats-cover-ph">📚</div>`}
        <div class="stats-info">
          <div class="stats-manga-title">${escHtml(item.title)}</div>
          <div class="stats-bar-wrap">
            <div class="stats-bar" style="width:${Math.round(item.total_reads / max * 100)}%"></div>
          </div>
        <div class="stats-nums">${item.total_unique} Felhasználó    ${item.total_reads} Rész</div>
        </div>
      </a>
    `).join("");
  }

  function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  /* ── INIT ────────────────────────────────────────────────── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createWidget);
  } else {
    createWidget();
  }
})();
