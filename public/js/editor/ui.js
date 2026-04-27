/* ============================================================
   editor-ui.js - UI helper funkciók
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   STATUS & PROGRESS
   ══════════════════════════════════════════════════════════ */

function setStatus(text, type = "info") {
  const st = document.getElementById("status-text");
  if (!st) return;
  st.textContent = text;
  st.className = type;
}

function showProgress(on, msg = "Feldolgozás...") {
  const prog = document.getElementById("progress");
  const progMsg = document.getElementById("prog-msg");
  if (!prog) return;
  
  prog.style.display = on ? "flex" : "none";
  if (progMsg && msg) progMsg.textContent = msg;
}

/* ══════════════════════════════════════════════════════════
   SÚGÓ MODAL
   ══════════════════════════════════════════════════════════ */

function toggleHelp() {
  const modal = document.getElementById("helpModal");
  if (modal) {
    modal.classList.toggle("open");
    console.log("Súgó modal toggled:", modal.classList.contains("open")); // DEBUG
  }
}

function closeHelp() {
  const modal = document.getElementById("helpModal");
  if (modal) {
    modal.classList.remove("open");
    console.log("Súgó modal closed"); // DEBUG
  }
}

// ESC gombbal bezárható - JAVÍTOTT!
window.addEventListener('keydown', (e) => {
  // Ignore if typing in input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }
  
  if (e.key === 'Escape' || e.key === 'Esc') {
    const helpModal = document.getElementById("helpModal");
    if (helpModal && helpModal.classList.contains('open')) {
      e.preventDefault();
      e.stopPropagation();
      closeHelp();
    }
  }
}, true); // UseCapture = true

// Kattintás a modal háttérre bezárja
window.addEventListener('DOMContentLoaded', () => {
  const helpModalOverlay = document.getElementById("helpModal");
  if (helpModalOverlay) {
    helpModalOverlay.addEventListener('click', (e) => {
      // Ha a háttérre kattintunk (nem a modal belső részére)
      if (e.target === helpModalOverlay) {
        closeHelp();
      }
    });
  }
});

/* ══════════════════════════════════════════════════════════
   MOBILE SIDEBAR TOGGLE
   ══════════════════════════════════════════════════════════ */

function toggleMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.classList.toggle("mobile-open");
  }
}
