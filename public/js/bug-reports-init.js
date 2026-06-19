// Notification-ból érkező deep link kezelés
window.openBugReportById = function(bugId) {
  function correctTab(report) {
    if (report.is_closed) return "closed";
    if (report.fixes && report.fixes.length > 0) return "fixed";
    return "open";
  }

  function tryOpen(attempts) {
    if (attempts <= 0) return;

    if (typeof allBugReports === "undefined" || typeof renderBugReports !== "function") {
      setTimeout(() => tryOpen(attempts - 1), 300);
      return;
    }

    const report = allBugReports.find(r => r.id === bugId);
    if (!report) { setTimeout(() => tryOpen(attempts - 1), 300); return; }

    // Helyes tab kiválasztása az állapot alapján
    const tab = correctTab(report);
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (tabBtn && !tabBtn.classList.contains("active")) tabBtn.click();

    setTimeout(() => {
      if (typeof expandedManga !== "undefined") expandedManga[report.manga_slug] = true;
      if (typeof expandedReports !== "undefined") expandedReports[bugId] = true;
      if (typeof renderBugReports === "function") renderBugReports();
      if (typeof loadComments === "function") loadComments(bugId);

      setTimeout(() => {
        const el = document.querySelector('[data-report-id="' + bugId + '"]')
                || document.getElementById("report-" + bugId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.style.transition = "box-shadow .3s";
          el.style.boxShadow = "0 0 0 3px rgba(124,92,255,.6)";
          setTimeout(() => { el.style.boxShadow = ""; }, 2000);
        }
      }, 350);
    }, 200);
  }
  tryOpen(20);
};

// URL paraméterből auto-megnyitás
document.addEventListener("DOMContentLoaded", () => {
  const bugId = new URLSearchParams(window.location.search).get("id");
  if (bugId) {
    // Várunk amíg loadBugReports lefut, nem fix 900ms
    const interval = setInterval(() => {
      if (typeof allBugReports !== "undefined" && allBugReports.length >= 0) {
        clearInterval(interval);
        window.openBugReportById(parseInt(bugId));
      }
    }, 150);
    setTimeout(() => clearInterval(interval), 8000);
  }
});
