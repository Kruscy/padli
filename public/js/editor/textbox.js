/* ============================================================
   editor-textbox.js - Szövegdoboz kezelés
   ============================================================ */

// Textbox változók (core.js-ből)
// const textBoxes = [];
// let selectedTb = null, nextTbId = 1;
// let tbDragging = false, tbDragStart = null;
// let tbResizing = false, tbResizeStart = null;
// const HS = 10;

/* ══════════════════════════════════════════════════════════
   TEXTBOX RENDERING
   ══════════════════════════════════════════════════════════ */

function renderOverlay() {
  octx.clearRect(0, 0, oc.width, oc.height);
  if (!imgEl) return;
  
  octx.save();
  octx.translate(offX, offY);
  octx.scale(scale, scale);
  
  // Textbox-ok rajzolása
  textBoxes.forEach(tb => drawTb(tb));
  
  octx.restore();
}

function wrapLines(ctx, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  
  for (const w of words) {
    const test = line + (line ? " " : "") + w;
    if (ctx.measureText(test).width <= maxW) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTb(tb) {
  // Keret
  octx.strokeStyle = tb === selectedTb ? "#7c3aed" : "#ffffff88";
  octx.lineWidth = 2 / scale;
  octx.strokeRect(tb.x, tb.y, tb.w, tb.h);
  
  // Resize handles (csak selected textbox-on)
  if (tb === selectedTb) {
    const handles = [
      [tb.x - HS/2, tb.y - HS/2],
      [tb.x + tb.w - HS/2, tb.y - HS/2],
      [tb.x - HS/2, tb.y + tb.h - HS/2],
      [tb.x + tb.w - HS/2, tb.y + tb.h - HS/2]
    ];
    
    octx.fillStyle = "#7c3aed";
    handles.forEach(([hx, hy]) => {
      octx.fillRect(hx, hy, HS, HS);
    });
  }
  
  // Szöveg rendering
  octx.fillStyle = tb.color;
  octx.font = `${tb.fontStyle} ${tb.fontSize}px "${tb.fontFamily}"`;
  octx.textAlign = tb.align;
  octx.textBaseline = "middle";
  
  // Stroke (körvonal)
  if (tb.strokeWidth > 0) {
    octx.strokeStyle = tb.strokeColor;
    octx.lineWidth = tb.strokeWidth;
  }
  
  // Line wrapping
  const lines = wrapLines(octx, tb.text, tb.w - 10);
  const lineH = tb.fontSize * 1.2;
  const totalH = lines.length * lineH;
  const startY = tb.y + (tb.h - totalH) / 2 + lineH / 2;
  
  lines.forEach((line, i) => {
    const textX = tb.align === "center" ? tb.x + tb.w/2 :
                  tb.align === "right" ? tb.x + tb.w - 5 : tb.x + 5;
    const textY = startY + i * lineH;
    
    if (tb.strokeWidth > 0) {
      octx.strokeText(line, textX, textY);
    }
    octx.fillText(line, textX, textY);
  });
}

/* ══════════════════════════════════════════════════════════
   TEXTBOX MANAGEMENT
   ══════════════════════════════════════════════════════════ */

function makeTb(ix, iy) {
  const tb = {
    id: nextTbId++,
    x: ix, y: iy,
    w: 200, h: 60,
    text: "Szöveg",
    fontSize: 20,
    fontFamily: "Wild Words",
    fontStyle: "normal",
    color: "#000000",
    strokeWidth: 0,
    strokeColor: "#ffffff",
    align: "center"
  };
  textBoxes.push(tb);
  selectTb(tb);
  updateTbList();
  renderOverlay();
}

function selectTb(tb) {
  selectedTb = tb;
  
  // UI update
  document.getElementById("tb-fontsize").value = tb.fontSize;
  document.getElementById("tb-fontstyle").value = tb.fontStyle;
  document.getElementById("tb-color").value = tb.color;
  document.getElementById("tb-stroke-w").value = tb.strokeWidth;
  document.getElementById("tb-stroke-c").value = tb.strokeColor;
  document.getElementById("tb-font").value = tb.fontFamily;
  document.getElementById("tb-text").value = tb.text;
  
  // Align buttons
  document.querySelectorAll(".tb-align-btn").forEach(b => {
    b.classList.toggle("act", b.dataset.align === tb.align);
  });
  
  // Show properties panel
  document.getElementById("tb-props").style.display = "block";
  renderOverlay();
}

function updateSelectedTb() {
  if (!selectedTb) return;
  
  selectedTb.fontSize = +document.getElementById("tb-fontsize").value;
  selectedTb.fontStyle = document.getElementById("tb-fontstyle").value;
  selectedTb.color = document.getElementById("tb-color").value;
  selectedTb.strokeWidth = +document.getElementById("tb-stroke-w").value;
  selectedTb.strokeColor = document.getElementById("tb-stroke-c").value;
  selectedTb.fontFamily = document.getElementById("tb-font").value;
  
  renderOverlay();
  updateTbList();
}

function updateTbText() {
  if (!selectedTb) return;
  selectedTb.text = document.getElementById("tb-text").value;
  renderOverlay();
  updateTbList();
}

function setTbAlign(align) {
  if (!selectedTb) return;
  selectedTb.align = align;
  
  document.querySelectorAll(".tb-align-btn").forEach(b => {
    b.classList.toggle("act", b.dataset.align === align);
  });
  
  renderOverlay();
}

function deleteSelectedTb() {
  if (!selectedTb) return;
  removeTb(selectedTb.id);
}

function removeTb(id) {
  const idx = textBoxes.findIndex(t => t.id === id);
  if (idx !== -1) textBoxes.splice(idx, 1);
  selectedTb = null;
  document.getElementById("tb-props").style.display = "none";
  updateTbList();
  renderOverlay();
}

function updateTbList() {
  const list = document.getElementById("text-boxes-list");
  if (!list) return;
  
  if (textBoxes.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.75rem">Nincs szövegdoboz</div>';
    return;
  }
  
  list.innerHTML = textBoxes.map(tb => 
    `<div class="tb-item ${tb === selectedTb ? 'selected' : ''}" onclick="selectTb(textBoxes.find(t=>t.id===${tb.id}))">
      <span class="tb-preview">${tb.text.substring(0, 20)}${tb.text.length > 20 ? '...' : ''}</span>
      <button class="tb-del" onclick="event.stopPropagation();removeTb(${tb.id})">×</button>
    </div>`
  ).join('');
}

function tbAt(vx, vy) {
  const ip = viewToImg(vx, vy);
  
  for (let i = textBoxes.length - 1; i >= 0; i--) {
    const tb = textBoxes[i];
    
    // Check resize handles
    if (tb === selectedTb) {
      const corners = [
        { x: tb.x, y: tb.y, cursor: "nw" },
        { x: tb.x + tb.w, y: tb.y, cursor: "ne" },
        { x: tb.x, y: tb.y + tb.h, cursor: "sw" },
        { x: tb.x + tb.w, y: tb.y + tb.h, cursor: "se" }
      ];
      
      for (const c of corners) {
        const dist = Math.sqrt((ip.x - c.x)**2 + (ip.y - c.y)**2);
        if (dist < 12) {
          return { tb, type: 'resize', corner: c.cursor };
        }
      }
    }
    
    // Check body
    if (ip.x >= tb.x && ip.x <= tb.x + tb.w &&
        ip.y >= tb.y && ip.y <= tb.y + tb.h) {
      return { tb, type: 'drag' };
    }
  }
  
  return null;
}

function burnTextBoxes() {
  if (!origCanvas || textBoxes.length === 0) return;
  
  const ctx = editCtx;
  
  textBoxes.forEach(tb => {
    ctx.fillStyle = tb.color;
    ctx.font = `${tb.fontStyle} ${tb.fontSize}px "${tb.fontFamily}"`;
    ctx.textAlign = tb.align;
    ctx.textBaseline = "middle";
    
    if (tb.strokeWidth > 0) {
      ctx.strokeStyle = tb.strokeColor;
      ctx.lineWidth = tb.strokeWidth;
    }
    
    const lines = wrapLines(ctx, tb.text, tb.w - 10);
    const lineH = tb.fontSize * 1.2;
    const totalH = lines.length * lineH;
    const startY = tb.y + (tb.h - totalH) / 2 + lineH / 2;
    
    lines.forEach((line, i) => {
      const textX = tb.align === "center" ? tb.x + tb.w/2 :
                    tb.align === "right" ? tb.x + tb.w - 5 : tb.x + 5;
      const textY = startY + i * lineH;
      
      if (tb.strokeWidth > 0) {
        ctx.strokeText(line, textX, textY);
      }
      ctx.fillText(line, textX, textY);
    });
  });
  
  // Clear textboxes
  textBoxes.length = 0;
  selectedTb = null;
  document.getElementById("tb-props").style.display = "none";
  updateTbList();
  renderImage();
  renderOverlay();
  
  setStatus("✅ Szövegek ráégetve", "ok");
}
