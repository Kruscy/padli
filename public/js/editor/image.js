/* ============================================================
   editor-image.js - Kép betöltés és rendering
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   IMAGE LOADING
   ══════════════════════════════════════════════════════════ */

async function loadImageFromUrl(url) {
  setStatus("⏳ Betöltés...", "info");
  try {
    const blob = await (await fetch(url)).blob();
    const burl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { 
      initImage(img); 
      URL.revokeObjectURL(burl); 
    };
    img.onerror = () => {
      setStatus("❌ Kép betöltési hiba", "err");
      URL.revokeObjectURL(burl);
    };
    img.src = burl;
  } catch (e) { 
    setStatus("❌ " + e.message, "err"); 
  }
}

function initImage(img) {
  imgEl = img;
  
  // Eredeti canvas backup
  origCanvas = document.createElement("canvas");
  origCanvas.width = img.width; 
  origCanvas.height = img.height;
  origCanvas.getContext("2d").drawImage(img, 0, 0);
  
  // Edit layer inicializálás (ecset/radír)
  editCanvas = document.createElement("canvas");
  editCanvas.width = img.width;
  editCanvas.height = img.height;
  editCtx = editCanvas.getContext("2d", { willReadFrequently: true });
  
  // Text layer inicializálás (szöveg ráégetés) - ÚJ!
  textCanvas = document.createElement("canvas");
  textCanvas.width = img.width;
  textCanvas.height = img.height;
  textCtx = textCanvas.getContext("2d");
  
  // Reset state
  maskHistory = []; 
  editHistory = [];
  clearMask(); 
  fitToViewport(); 
  renderAll();
  
  // Info display
  const infoEl = document.getElementById("imgInfo");
  if (infoEl) {
    infoEl.innerHTML =
      `${img.width}×${img.height}px<br>` +
      (BUG_SLUG ? `<span style="color:var(--accent2)">${BUG_SLUG}</span><br>${BUG_CHAPTER} | #${BUG_INDEX}` : "");
  }
  
  setStatus(`✅ Kép betöltve (${img.width}×${img.height})`, "ok");
}

/* ══════════════════════════════════════════════════════════
   RENDERING
   ══════════════════════════════════════════════════════════ */

function renderAll() { 
  renderImage(); 
  renderMaskOverlay(); 
  renderOverlay(); 
}

function renderImage() {
  vctx.clearRect(0, 0, vc.width, vc.height);
  if (!imgEl) return;
  
  vctx.save(); 
  vctx.translate(offX, offY); 
  vctx.scale(scale, scale);
  
  // 1. Eredeti kép (alul)
  vctx.drawImage(origCanvas, 0, 0);
  
  // 2. Edit layer (ecset/radír - középen)
  if (editCanvas) {
    vctx.drawImage(editCanvas, 0, 0);
  }
  
  // 3. Szöveg layer (legfelül) - ÚJ!
  if (textCanvas) {
    vctx.drawImage(textCanvas, 0, 0);
  }
  
  vctx.restore();
}

/* ══════════════════════════════════════════════════════════
   MASK MANAGEMENT
   ══════════════════════════════════════════════════════════ */

let _maskC = null;

function getMaskCanvas() {
  if (!imgEl) return null;
  if (!_maskC || _maskC.width !== imgEl.width) {
    _maskC = document.createElement("canvas");
    _maskC.width = imgEl.width; 
    _maskC.height = imgEl.height;
  }
  return _maskC;
}

function renderMaskOverlay() {
  mctx.clearRect(0, 0, mc.width, mc.height);
  const m = getMaskCanvas(); 
  if (!m) return;
  
  mctx.save(); 
  mctx.translate(offX, offY); 
  mctx.scale(scale, scale);
  mctx.drawImage(m, 0, 0); 
  mctx.restore();
}

function saveMaskState() {
  const m = getMaskCanvas(); 
  if (!m) return;
  const s = document.createElement("canvas");
  s.width = m.width; 
  s.height = m.height; 
  s.getContext("2d").drawImage(m, 0, 0);
  maskHistory.push(s);
  if (maskHistory.length > 20) maskHistory.shift();
}

function clearMask() {
  const m = getMaskCanvas();
  if (m) {
    const ctx = m.getContext("2d");
    ctx.clearRect(0, 0, m.width, m.height);
  }
  renderMaskOverlay();
}

function undoMask() {
  if (maskHistory.length === 0) return;
  const prev = maskHistory.pop();
  const m = getMaskCanvas();
  if (m && prev) {
    m.getContext("2d").clearRect(0, 0, m.width, m.height);
    m.getContext("2d").drawImage(prev, 0, 0);
  }
  renderMaskOverlay();
}

/* ══════════════════════════════════════════════════════════
   COMPOSITE FOR MASK (Edit + Text layers)
   ══════════════════════════════════════════════════════════ */

function getCompositeForMask() {
  if (!imgEl) return null;
  
  // Kompozit canvas: eredeti + edit + text
  const composite = document.createElement("canvas");
  composite.width = imgEl.width;
  composite.height = imgEl.height;
  const ctx = composite.getContext("2d");
  
  // 1. Eredeti kép
  ctx.drawImage(origCanvas, 0, 0);
  
  // 2. Edit layer (ecset)
  if (editCanvas) {
    ctx.drawImage(editCanvas, 0, 0);
  }
  
  // 3. Text layer (szöveg)
  if (textCanvas) {
    ctx.drawImage(textCanvas, 0, 0);
  }
  
  return composite;
}
