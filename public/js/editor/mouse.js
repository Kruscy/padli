/* ============================================================
   editor-mouse.js - Mouse és touch event kezelés
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   MOUSE HANDLERS SETUP
   ══════════════════════════════════════════════════════════ */

function setupMouseHandlers() {
  if (!vc) return;
  
  vc.addEventListener("mousedown", onMouseDown);
  vc.addEventListener("mousemove", onMouseMove);
  vc.addEventListener("mouseup", onMouseUp);
  vc.addEventListener("mouseleave", onMouseUp);
  vc.addEventListener("wheel", onWheel, { passive: false });
  
  vc.addEventListener("touchstart", onTouchStart, { passive: false });
  vc.addEventListener("touchmove", onTouchMove, { passive: false });
  vc.addEventListener("touchend", onTouchEnd, { passive: false });
}

/* ══════════════════════════════════════════════════════════
   MOUSE EVENTS
   ══════════════════════════════════════════════════════════ */

function onMouseDown(e) {
  if (!imgEl) return;
  
  const pos = eventPos(e);
  const ip = viewToImg(pos.vx, pos.vy);
  
  // Textbox interaction
  const hit = tbAt(pos.vx, pos.vy);
  if (hit) {
    selectTb(hit.tb);
    
    if (hit.type === 'drag') {
      tbDragging = true;
      tbDragStart = { ix: ip.x - hit.tb.x, iy: ip.y - hit.tb.y };
    } else if (hit.type === 'resize') {
      tbResizing = true;
      tbResizeStart = {
        corner: hit.corner,
        x: ip.x, y: ip.y,
        origW: hit.tb.w,
        origH: hit.tb.h,
        origX: hit.tb.x,
        origY: hit.tb.y
      };
    }
    
    e.preventDefault();
    return;
  }
  
  // Mode-specific actions
  if (mode === "text") {
    makeTb(ip.x, ip.y);
  } else if (mode === "mask") {
    painting = true;
    paintMask(pos.vx, pos.vy);
  } else if (mode === "brush" || mode === "eraser") {
    painting = true;
    paintBrush(pos.vx, pos.vy);
  } else if (mode === "pipette") {
    pickColor(pos.vx, pos.vy);
  } else if (mode === "pan") {
    panStart = { x: pos.vx, y: pos.vy };
    panOffset = { x: offX, y: offY };
  }
}

function onMouseMove(e) {
  if (!imgEl) return;
  
  const pos = eventPos(e);
  const ip = viewToImg(pos.vx, pos.vy);
  
  // Textbox drag
  if (tbDragging && selectedTb && tbDragStart) {
    selectedTb.x = ip.x - tbDragStart.ix;
    selectedTb.y = ip.y - tbDragStart.iy;
    renderOverlay();
    return;
  }
  
  // Textbox resize
  if (tbResizing && selectedTb && tbResizeStart) {
    const dx = ip.x - tbResizeStart.x;
    const dy = ip.y - tbResizeStart.y;
    
    if (tbResizeStart.corner.includes('e')) {
      selectedTb.w = Math.max(50, tbResizeStart.origW + dx);
    }
    if (tbResizeStart.corner.includes('w')) {
      const newW = Math.max(50, tbResizeStart.origW - dx);
      selectedTb.x = tbResizeStart.origX + (tbResizeStart.origW - newW);
      selectedTb.w = newW;
    }
    if (tbResizeStart.corner.includes('s')) {
      selectedTb.h = Math.max(30, tbResizeStart.origH + dy);
    }
    if (tbResizeStart.corner.includes('n')) {
      const newH = Math.max(30, tbResizeStart.origH - dy);
      selectedTb.y = tbResizeStart.origY + (tbResizeStart.origH - newH);
      selectedTb.h = newH;
    }
    
    renderOverlay();
    return;
  }
  
  // Painting
  if (painting) {
    if (mode === "mask") {
      paintMask(pos.vx, pos.vy);
    } else if (mode === "brush" || mode === "eraser") {
      paintBrush(pos.vx, pos.vy);
    }
  }
  
  // Pan
  if (panStart && panOffset) {
    offX = panOffset.x + (pos.vx - panStart.x);
    offY = panOffset.y + (pos.vy - panStart.y);
    renderAll();
  }
}

function onMouseUp(e) {
  painting = false;
  panStart = null;
  panOffset = null;
  tbDragging = false;
  tbDragStart = null;
  tbResizing = false;
  tbResizeStart = null;
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  const pos = eventPos(e);
  zoom(delta, pos.vx, pos.vy);
}

/* ══════════════════════════════════════════════════════════
   TOUCH EVENTS
   ══════════════════════════════════════════════════════════ */

function onTouchStart(e) {
  e.preventDefault();
  
  // Two-finger pinch zoom
  if (e.touches.length === 2) {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    touchStartDist = Math.sqrt(
      (t1.clientX - t0.clientX)**2 + 
      (t1.clientY - t0.clientY)**2
    );
    touchStartScale = scale;
    touchStartCenter = {
      x: (t0.clientX + t1.clientX) / 2,
      y: (t0.clientY + t1.clientY) / 2
    };
    return;
  }
  
  // Single touch
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    const fakeEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => e.preventDefault()
    };
    onMouseDown(fakeEvent);
    lastTouchPos = { x: touch.clientX, y: touch.clientY };
  }
}

function onTouchMove(e) {
  e.preventDefault();
  
  // Two-finger pinch zoom
  if (e.touches.length === 2 && touchStartDist > 0) {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const dist = Math.sqrt(
      (t1.clientX - t0.clientX)**2 + 
      (t1.clientY - t0.clientY)**2
    );
    
    const newScale = touchStartScale * (dist / touchStartDist);
    const centerX = (t0.clientX + t1.clientX) / 2;
    const centerY = (t0.clientY + t1.clientY) / 2;
    
    scale = Math.min(10, Math.max(0.05, newScale));
    
    if (touchStartCenter) {
      offX += centerX - touchStartCenter.x;
      offY += centerY - touchStartCenter.y;
      touchStartCenter = { x: centerX, y: centerY };
    }
    
    renderAll();
    updateZoomLabel();
    return;
  }
  
  // Single touch
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    const fakeEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => e.preventDefault()
    };
    onMouseMove(fakeEvent);
    
    // Smooth painting on touch
    if (mode === "brush" || mode === "mask" || mode === "eraser") {
      if (lastTouchPos) {
        drawTouchLine(
          lastTouchPos.x, lastTouchPos.y,
          touch.clientX, touch.clientY
        );
      }
      lastTouchPos = { x: touch.clientX, y: touch.clientY };
    }
  }
}

function onTouchEnd(e) {
  e.preventDefault();
  touchStartDist = 0;
  touchStartCenter = null;
  lastTouchPos = null;
  onMouseUp(e);
}
