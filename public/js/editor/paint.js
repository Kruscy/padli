/* ============================================================
   editor-paint.js - Rajzolás (drawTouchLine ELTÁVOLÍTVA)
   ============================================================ */

function setMode(m) {
  mode = m;
  eraseMode = false;
  
  document.querySelectorAll('#topbar .btn').forEach(b => {
    if (b.id && b.id.startsWith('btn-')) {
      b.classList.remove('act');
    }
  });
  
  if (vc) vc.classList.remove('eraser-mode');
  
  if (m === "mask") {
    document.getElementById("btn-mask")?.classList.add("act");
    setStatus("🖌 Maszk mód", "info");
  } else if (m === "brush") {
    document.getElementById("btn-brush")?.classList.add("act");
    setStatus("✏️ Ecset mód", "info");
  } else if (m === "eraser") {
    document.getElementById("btn-eraser")?.classList.add("act");
    eraseMode = true;
    if (vc) vc.classList.add('eraser-mode');
    setStatus("🧹 Radír mód", "info");
  } else if (m === "pipette") {
    document.getElementById("btn-pipette")?.classList.add("act");
    setStatus("💉 Pipetta", "info");
  } else if (m === "pan") {
    document.getElementById("btn-pan")?.classList.add("act");
    setStatus("✋ Mozgatás", "info");
  } else if (m === "text") {
    document.getElementById("btn-text")?.classList.add("act");
    setStatus("💬 Szövegdoboz", "info");
  }
}

function paintMask(vx, vy) {
  const ip = viewToImg(vx, vy);
  const m = getMaskCanvas();
  if (!m) return;
  
  saveMaskState();
  const ctx = m.getContext("2d");
  ctx.fillStyle = "#FF0000";
  ctx.beginPath();
  ctx.arc(ip.x, ip.y, bs / 2, 0, Math.PI * 2);
  ctx.fill();
  renderMaskOverlay();
}

function paintBrush(vx, vy) {
  if (!editCanvas || !editCtx) return;
  
  const ip = viewToImg(vx, vy);
  
  if (eraseMode) {
    editCtx.globalCompositeOperation = 'destination-out';
    editCtx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    editCtx.globalCompositeOperation = 'source-over';
    editCtx.fillStyle = brushColor;
  }
  
  editCtx.beginPath();
  editCtx.arc(ip.x, ip.y, bs / 2, 0, Math.PI * 2);
  editCtx.fill();
  
  editCtx.globalCompositeOperation = 'source-over';
  
  renderImage();
}

function pickColor(vx, vy) {
  if (!imgEl || !origCanvas) return;
  
  const ip = viewToImg(vx, vy);
  const ix = Math.floor(ip.x);
  const iy = Math.floor(ip.y);
  
  if (ix < 0 || ix >= imgEl.width || iy < 0 || iy >= imgEl.height) return;
  
  const ctx = origCanvas.getContext("2d");
  const pixel = ctx.getImageData(ix, iy, 1, 1).data;
  const hex = "#" + [pixel[0], pixel[1], pixel[2]]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
  
  brushColor = hex;
  const colorInput = document.getElementById("brushColor");
  if (colorInput) colorInput.value = hex;
  
  const info = document.getElementById("pipetteInfo");
  if (info) {
    info.textContent = hex;
    info.style.display = "inline";
    setTimeout(() => info.style.display = "none", 2000);
  }
  
  setStatus(`Szín: ${hex} - Ecset mód`, "info");
  
  // ✅ Automatikus ecset mód váltás
  setMode("brush");
}

// drawTouchLine ELTÁVOLÍTVA - most a mouse.js-ben van drawSmoothLine()
