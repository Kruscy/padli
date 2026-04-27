/* ============================================================
   editor-shortcuts.js - Keyboard shortcuts
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ══════════════════════════════════════════════════════════ */

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    
    // Ctrl/Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        undoMask();
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        openSaveModal();
        return;
      }
      return;
    }
    
    const key = e.key.toLowerCase();
    
    // Mode shortcuts
    if (SHORTCUTS[key]) {
      e.preventDefault();
      setMode(SHORTCUTS[key]);
      return;
    }
    
    // Zoom shortcuts
    if (key === '+' || key === '=') {
      e.preventDefault();
      zoom(0.25);
    } else if (key === '-' || key === '_') {
      e.preventDefault();
      zoom(-0.25);
    } else if (key === '0') {
      e.preventDefault();
      resetZoom();
    }
  });
}
