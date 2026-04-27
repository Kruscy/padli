/* ============================================================
   editor-core.js - JAVÍTOTT textbox változókkal
   ============================================================ */

// URL paraméterek
const urlParams = new URLSearchParams(location.search);
const BUG_SLUG = urlParams.get("slug");
const BUG_CHAPTER = urlParams.get("chapter");
const BUG_INDEX = urlParams.get("image_index");
const BUG_URL = urlParams.get("image_url");
const BUG_PROVIDER = urlParams.get("provider");

// Képlista navigáció
let allImages = [];
let currentImageIndex = -1;
let imageHasBugReport = {};
let isEditingBlocked = false;

// Canvas referenciák
const vp = document.getElementById("viewport");
const vc = document.getElementById("view-canvas");
const mc = document.getElementById("mask-canvas");
const oc = document.getElementById("overlay-canvas");
const vctx = vc.getContext("2d");
const mctx = mc.getContext("2d");
const octx = oc.getContext("2d");

// ÚJ: Edit layer (memóriában)
let editCanvas = null;
let editCtx = null;

// Globális state
let imgEl = null, origCanvas = null, beforeInpaint = null;
let scale = 1, offX = 0, offY = 0;
let mode = "mask", bs = 22;
let painting = false;
let maskHistory = [];
let editHistory = []; // ÚJ: Edit layer history
let panStart = null, panOffset = null;
let brushColor = "#ffffff";
let eraseMode = false; // ÚJ: Radír mód

// KRITIKUS: Textbox változók - HIÁNYZOTT!
const textBoxes = [];
let selectedTb = null, nextTbId = 1;
let tbDragging = false, tbDragStart = null;
let tbResizing = false, tbResizeStart = null;
const HS = 10; // handle méret

// Touch state
let touchStartDist = 0;
let touchStartScale = 1;
let touchStartCenter = null;
let lastTouchPos = null;

// Shortcut mapping
const SHORTCUTS = {
  'm': 'mask',
  'b': 'brush',
  'e': 'eraser',
  'i': 'pipette',
  'h': 'pan',
  't': 'text'
};

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */

window.addEventListener("DOMContentLoaded", () => {
  resizeCanvases();
  setMode("mask");
  setupKeyboardShortcuts();
  setupMouseHandlers();
  
  if (BUG_URL) loadImageFromUrl(BUG_URL);
  if (!BUG_SLUG) {
    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) saveBtn.style.display = "none";
  }
  
  // Képlista betöltés
  if (BUG_SLUG && BUG_CHAPTER) {
    loadImageList();
  }
  
  // Brush color listener
  const brushColorInput = document.getElementById("brushColor");
  if (brushColorInput) {
    brushColorInput.addEventListener("input", (e) => {
      brushColor = e.target.value;
    });
  }
});

window.addEventListener("resize", resizeCanvases);

/* ══════════════════════════════════════════════════════════
   VIEWPORT & ZOOM
   ══════════════════════════════════════════════════════════ */

function VP_W() { return vp.clientWidth; }
function VP_H() { return vp.clientHeight; }

function resizeCanvases() {
  [vc, mc, oc].forEach(c => { 
    c.width = VP_W(); 
    c.height = VP_H(); 
  });
  renderAll();
}

function fitToViewport() {
  if (!imgEl) return;
  scale = Math.min(VP_W() / imgEl.width, VP_H() / imgEl.height, 1);
  offX = (VP_W() - imgEl.width * scale) / 2;
  offY = (VP_H() - imgEl.height * scale) / 2;
  updateZoomLabel();
}

function zoom(delta, cx, cy) {
  cx = cx ?? VP_W()/2; 
  cy = cy ?? VP_H()/2;
  const ns = Math.min(10, Math.max(0.05, scale + delta));
  offX = cx - (cx - offX) * (ns / scale);
  offY = cy - (cy - offY) * (ns / scale);
  scale = ns; 
  renderAll(); 
  updateZoomLabel();
}

function resetZoom() { 
  fitToViewport(); 
  resizeCanvases(); 
}

function updateZoomLabel() {
  const p = Math.round(scale * 100) + "%";
  const lbl = document.getElementById("zoom-lbl");
  const info = document.getElementById("zoom-info");
  if (lbl) lbl.textContent = p;
  if (info) info.textContent = p;
}

/* ══════════════════════════════════════════════════════════
   COORDINATE CONVERSION
   ══════════════════════════════════════════════════════════ */

function viewToImg(vx, vy) { 
  return { 
    x: (vx - offX) / scale, 
    y: (vy - offY) / scale 
  }; 
}

function imgToView(ix, iy) { 
  return { 
    vx: ix * scale + offX, 
    vy: iy * scale + offY 
  }; 
}

function eventPos(e) {
  const rect = vc.getBoundingClientRect();
  return {
    vx: e.clientX - rect.left,
    vy: e.clientY - rect.top
  };
}
