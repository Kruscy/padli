/* ============================================================
   editor.js v2 - Manga képszerkesztő
   Canvas alapú szövegdobozok (mozognak a képpel)
   ============================================================ */

const urlParams     = new URLSearchParams(location.search);
const BUG_SLUG      = urlParams.get("slug");
const BUG_CHAPTER   = urlParams.get("chapter");
const BUG_INDEX     = urlParams.get("image_index");
const BUG_URL       = urlParams.get("image_url");
const BUG_PROVIDER  = urlParams.get("provider");
const BUG_FIX_ID    = urlParams.get("fix_id"); // ha beállított, korrekció módban fut

// Képlista navigáció
let allImages = [];        // Fejezet összes képe
let currentImageIndex = -1; // Jelenlegi kép indexe
let imageHasBugReport = {}; // { imageIndex: boolean } - melyik képnek van bug reportja
let isEditingBlocked = false; // Blokkolás ha nincs bug report

const vp   = document.getElementById("viewport");
const vc   = document.getElementById("view-canvas");
const mc   = document.getElementById("mask-canvas");
const oc   = document.getElementById("overlay-canvas");
const vctx = vc.getContext("2d");
const mctx = mc.getContext("2d");
const octx = oc.getContext("2d");

let imgEl = null, origCanvas = null, beforeInpaint = null;
let scale = 1, offX = 0, offY = 0;
let mode = "mask", bs = 22;
let painting = false, maskHistory = [];
let panStart = null, panOffset = null;
let brushColor = "#000000";

/* ── SZÖVEGDOBOZOK (képkoordinátában) ─── */
const textBoxes = [];
let selectedTb = null, nextTbId = 1;
let tbDragging = false, tbDragStart = null;
let tbResizing = false, tbResizeStart = null;
const HS = 10; // handle méret (view px)

window.addEventListener("DOMContentLoaded", () => {
  resizeCanvases();
  setMode("mask");
  if (BUG_URL) loadImageFromUrl(BUG_URL);
  if (!BUG_SLUG && !BUG_FIX_ID) document.getElementById("saveBtn").style.display = "none";
});

/* ── BETÖLTÉS ─── */
async function loadImageFromUrl(url) {
  setStatus("⏳ Betöltés...", "info");
  try {
    const blob = await (await fetch(url)).blob();
    const burl = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => { initImage(img); URL.revokeObjectURL(burl); };
    img.src = burl;
  } catch (e) { setStatus("❌ " + e.message, "err"); }
}

function initImage(img) {
  imgEl = img;
  origCanvas = document.createElement("canvas");
  origCanvas.width = img.width; origCanvas.height = img.height;
  origCanvas.getContext("2d").drawImage(img, 0, 0);
  maskHistory = []; clearMask(); fitToViewport(); renderAll();
  document.getElementById("imgInfo").innerHTML =
    `${img.width}×${img.height}px<br>` +
    (BUG_SLUG ? `<span style="color:var(--accent2)">${BUG_SLUG}</span><br>${BUG_CHAPTER} | #${BUG_INDEX}` : "");
  setStatus(`✅ Kép betöltve (${img.width}×${img.height})`, "ok");
}

/* ── ZOOM / PAN ─── */
function VP_W() { return vp.clientWidth; }
function VP_H() { return vp.clientHeight; }

function resizeCanvases() {
  [vc, mc, oc].forEach(c => { c.width = VP_W(); c.height = VP_H(); });
  renderAll();
}

function fitToViewport() {
  if (!imgEl) return;
  scale = Math.min(VP_W() / imgEl.width, VP_H() / imgEl.height, 1);
  offX = (VP_W() - imgEl.width  * scale) / 2;
  offY = (VP_H() - imgEl.height * scale) / 2;
  updateZoomLabel();
}

function zoom(delta, cx, cy) {
  cx = cx ?? VP_W()/2; cy = cy ?? VP_H()/2;
  const ns = Math.min(10, Math.max(0.05, scale + delta));
  offX = cx - (cx - offX) * (ns / scale);
  offY = cy - (cy - offY) * (ns / scale);
  scale = ns; renderAll(); updateZoomLabel();
}

function resetZoom() { fitToViewport(); resizeCanvases(); }

function updateZoomLabel() {
  const p = Math.round(scale * 100) + "%";
  document.getElementById("zoom-lbl").textContent = p;
  document.getElementById("zoom-info").textContent = p;
}

function viewToImg(vx, vy) { return { x: (vx-offX)/scale, y: (vy-offY)/scale }; }
function imgToView(ix, iy) { return { vx: ix*scale+offX,   vy: iy*scale+offY  }; }

function eventPos(e) {
  const r = vp.getBoundingClientRect();
  if (e.touches) return { vx: e.touches[0].clientX-r.left, vy: e.touches[0].clientY-r.top };
  return { vx: e.clientX-r.left, vy: e.clientY-r.top };
}

/* ── RENDER ─── */
function renderAll() { renderImage(); renderMaskOverlay(); renderOverlay(); }

function renderImage() {
  vctx.clearRect(0,0,vc.width,vc.height);
  if (!imgEl) return;
  vctx.save(); vctx.translate(offX,offY); vctx.scale(scale,scale);
  vctx.drawImage(origCanvas,0,0); vctx.restore();
}

/* ── MASZK ─── */
let _maskC = null;
function getMaskCanvas() {
  if (!imgEl) return null;
  if (!_maskC || _maskC.width !== imgEl.width) {
    _maskC = document.createElement("canvas");
    _maskC.width = imgEl.width; _maskC.height = imgEl.height;
  }
  return _maskC;
}

function renderMaskOverlay() {
  mctx.clearRect(0,0,mc.width,mc.height);
  const m = getMaskCanvas(); if (!m) return;
  mctx.save(); mctx.translate(offX,offY); mctx.scale(scale,scale);
  mctx.drawImage(m,0,0); mctx.restore();
}

function saveMaskState() {
  const m = getMaskCanvas(); if (!m) return;
  const s = document.createElement("canvas");
  s.width=m.width; s.height=m.height; s.getContext("2d").drawImage(m,0,0);
  maskHistory.push(s); if (maskHistory.length>40) maskHistory.shift();
}

function clearMask() {
  const m = getMaskCanvas(); if (!m) return;
  m.getContext("2d").clearRect(0,0,m.width,m.height); renderMaskOverlay();
}

function undoMask() {
  if (!maskHistory.length) return;
  getMaskCanvas().getContext("2d").clearRect(0,0,imgEl.width,imgEl.height);
  getMaskCanvas().getContext("2d").drawImage(maskHistory.pop(),0,0);
  renderMaskOverlay();
}

/* ── OVERLAY (szövegdobozok) ─── */
function renderOverlay() {
  octx.clearRect(0,0,oc.width,oc.height);
  if (imgEl) {
    octx.save(); octx.strokeStyle="rgba(124,92,255,.35)"; octx.lineWidth=1;
    octx.strokeRect(offX,offY,imgEl.width*scale,imgEl.height*scale);
    octx.restore();
  }
  textBoxes.forEach(drawTb);
}

// Szöveg tördelése a doboz szélességéhez
function wrapLines(ctx, text, maxW) {
  const words = text.split(" ");
  const result = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxW && current) {
      result.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) result.push(current);
  return result;
}

function drawTb(tb) {
  const {vx:x, vy:y} = imgToView(tb.x, tb.y);
  const w = tb.w*scale, h = tb.h*scale;
  const PAD = 8 * scale;
  const maxTextW = w - PAD * 2;

  octx.save();

  // Font beállítás a méréshez
  const fstr = `${tb.fontStyle} ${tb.fontWeight} ${tb.fontSize*scale}px ${tb.fontFamily}`;
  octx.font = fstr;
  octx.textBaseline = "top";

  // Automatikus sortörés - minden kézi sortörésnél is tördelünk
  const rawLines = tb.text.split("\n");
  const wrappedLines = [];
  for (const raw of rawLines) {
    const wrapped = wrapLines(octx, raw, maxTextW);
    wrappedLines.push(...(wrapped.length ? wrapped : [""]));
  }

  // Dinamikus betűméret ha összenyomják a dobozt
  // (csak ha a tb-nek van rögzített mérete és a szöveg nem fér el)
  let fs = tb.fontSize * scale;
  const lineH = fs * 1.4;
  const totalH = wrappedLines.length * lineH + PAD * 2;

  // Ha a szöveg magasabb mint a doboz → növeljük a dobozt
  if (totalH > h) {
    const newH = totalH / scale;
    tb.h = newH;
  }

  // Ha szélesebb sor van mint a doboz → csökkentjük a fontméretet
  const maxLineW = Math.max(...wrappedLines.map(l => octx.measureText(l).width));
  if (maxLineW > maxTextW && wrappedLines.length === 1) {
    fs = fs * (maxTextW / maxLineW) * 0.95;
    octx.font = `${tb.fontStyle} ${tb.fontWeight} ${fs}px ${tb.fontFamily}`;
  }

  // Keret (frissített méret)
  const newH = tb.h * scale;
  octx.strokeStyle = tb.selected ? "#facc15" : "rgba(124,92,255,.7)";
  octx.lineWidth   = tb.selected ? 2 : 1;
  octx.setLineDash(tb.selected ? [] : [5,3]);
  octx.strokeRect(x, y, w, newH);
  octx.setLineDash([]);

  // Szöveg rajzolás
  octx.fillStyle = tb.color;
  octx.textAlign = tb.textAlign || "center";
  if (tb.strokeWidth > 0) {
    octx.strokeStyle = tb.strokeColor;
    octx.lineWidth   = tb.strokeWidth * scale * 2;
    octx.lineJoin    = "round";
  }

  const lh = fs * 1.4;
  const alignX = tb.textAlign === "right"  ? x + w - PAD :
                 tb.textAlign === "left"   ? x + PAD :
                 x + w / 2; // center

  wrappedLines.forEach((line, i) => {
    const ty = y + PAD + i * lh;
    if (tb.strokeWidth > 0) octx.strokeText(line, alignX, ty);
    octx.fillText(line, alignX, ty);
  });
  octx.textAlign = "left"; // reset

  // Resize handle
  if (tb.selected) {
    octx.fillStyle = "#facc15";
    octx.strokeStyle = "#000"; octx.lineWidth = 1;
    octx.fillRect(x+w-HS, y+newH-HS, HS, HS);
    octx.strokeRect(x+w-HS, y+newH-HS, HS, HS);
  }

  octx.restore();
}

/* ── TB MŰVELETEK ─── */
function makeTb(ix, iy) {
  const tb = { id: nextTbId++, x:ix, y:iy, w:180, h:50,
    text:"Szöveg", fontSize:18, fontStyle:"normal", fontWeight:"normal",
    fontFamily:"Wild Words", color:"#000000", strokeWidth:0, strokeColor:"#ffffff",
    textAlign:"center", selected:false };
  textBoxes.push(tb); selectTb(tb); updateTbList(); return tb;
}

function selectTb(tb) {
  textBoxes.forEach(t => t.selected = false);
  selectedTb = tb;
  if (tb) tb.selected = true;
  const p = document.getElementById("tb-props");
  if (tb) {
    p.style.display = "block";
    document.getElementById("tb-fontsize").value  = tb.fontSize;
    document.getElementById("tb-color").value     = tb.color;
    document.getElementById("tb-stroke-w").value  = tb.strokeWidth;
    document.getElementById("tb-stroke-c").value  = tb.strokeColor;
    document.getElementById("tb-font").value      = tb.fontFamily;
    document.getElementById("tb-text").value      = tb.text;
    const sty = (tb.fontWeight==="bold"?"bold ":"")+(tb.fontStyle==="italic"?"italic":"");
    document.getElementById("tb-fontstyle").value = sty.trim()||"normal";
    document.querySelectorAll(".tb-align-btn").forEach(b => {
      b.classList.toggle("act", b.dataset.align === (tb.textAlign || "center"));
    });
  } else { p.style.display = "none"; }
  renderOverlay(); updateTbList();
}

function updateSelectedTb() {
  if (!selectedTb) return;
  const sty = document.getElementById("tb-fontstyle").value;
  selectedTb.fontSize    = +document.getElementById("tb-fontsize").value || 18;
  selectedTb.color       = document.getElementById("tb-color").value;
  selectedTb.fontWeight  = sty.includes("bold")   ? "bold"   : "normal";
  selectedTb.fontStyle   = sty.includes("italic")  ? "italic" : "normal";
  selectedTb.strokeWidth = +document.getElementById("tb-stroke-w").value || 0;
  selectedTb.strokeColor = document.getElementById("tb-stroke-c").value;
  selectedTb.fontFamily  = document.getElementById("tb-font").value;
  renderOverlay();
}

function updateTbText() {
  if (!selectedTb) return;
  selectedTb.text = document.getElementById("tb-text").value;
  renderOverlay(); updateTbList();
}

function setTbAlign(align) {
  if (!selectedTb) return;
  selectedTb.textAlign = align;
  document.querySelectorAll(".tb-align-btn").forEach(b => {
    b.classList.toggle("act", b.dataset.align === align);
  });
  renderOverlay();
}

/* ── FORDÍTÁS ─── */
async function runOCR() {
  if (!selectedTb) { setStatus("Válassz ki egy szövegdobozt!", "err"); return; }

  const ocrBtn    = document.getElementById("ocrBtn");
  const ocrStatus = document.getElementById("ocrStatus");
  ocrBtn.disabled = true;
  ocrStatus.style.display = "";
  ocrStatus.textContent   = "🔍 Felismerés folyamatban...";

  try {
    // A szövegdoboz területét kivágjuk az origCanvas-ból
    const tb  = selectedTb;
    const crop = document.createElement("canvas");
    crop.width  = tb.w;
    crop.height = tb.h;
    crop.getContext("2d").drawImage(origCanvas, tb.x, tb.y, tb.w, tb.h, 0, 0, tb.w, tb.h);
    const imageBase64 = crop.toDataURL("image/png");

    const res = await fetch("/api/ocr", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ imageBase64 })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      ocrStatus.textContent = "❌ " + (data.error || "Hiba");
      return;
    }

    const text = data.text?.trim();
    if (!text) { ocrStatus.textContent = "⚠️ Nem találtam szöveget."; return; }

    document.getElementById("tb-text").value = text;
    selectedTb.text = text;
    renderAll();
    ocrStatus.textContent = "✅ Kész!";
    setTimeout(() => { ocrStatus.style.display = "none"; }, 2000);

  } catch (e) {
    ocrStatus.textContent = "❌ " + e.message;
  } finally {
    ocrBtn.disabled = false;
  }
}

async function translateText() {
  if (!selectedTb) return;
  const text = document.getElementById("tb-text").value.trim();
  if (!text) return;

  const btn    = document.getElementById("translateBtn");
  const status = document.getElementById("translateStatus");

  btn.textContent = "⏳ Fordítás...";
  btn.disabled    = true;
  status.style.display = "block";
  status.textContent   = "";
  status.style.color   = "var(--muted)";

  try {
    const res = await fetch("/api/translate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text, source: "en", target: "hu" })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      status.textContent = "❌ " + (data.error || "Hiba");
      status.style.color = "var(--red)";
    } else {
      // Szöveg cseréje
      document.getElementById("tb-text").value = data.translatedText;
      selectedTb.text = data.translatedText;
      const lines = selectedTb.text.split("\n").length;
      selectedTb.h = Math.max(40, lines * selectedTb.fontSize * 1.4 + 14);
      renderOverlay(); updateTbList();
      status.textContent = "✅ Fordítva";
      status.style.color = "var(--green)";
      setTimeout(() => { status.style.display = "none"; }, 2000);
    }
  } catch (err) {
    status.textContent = "❌ Szerver hiba";
    status.style.color = "var(--red)";
  }

  btn.textContent = "🌐 Fordítás magyarra";
  btn.disabled    = false;
}

function deleteSelectedTb() {
  if (!selectedTb) return;
  textBoxes.splice(textBoxes.indexOf(selectedTb), 1);
  selectTb(null); renderOverlay(); updateTbList();
}

function removeTb(id) {
  const idx = textBoxes.findIndex(t => t.id === id);
  if (idx > -1) { if (textBoxes[idx]===selectedTb) selectTb(null); textBoxes.splice(idx,1); }
  renderOverlay(); updateTbList();
}

function updateTbList() {
  const list = document.getElementById("text-boxes-list");
  list.innerHTML = "";
  textBoxes.forEach(tb => {
    const d = document.createElement("div");
    d.className = "tb-item"+(tb===selectedTb?" selected":"");
    d.innerHTML = `<span class="tb-item-text">💬 ${tb.text.slice(0,18)}</span>
      <button class="tb-del" onclick="event.stopPropagation();removeTb(${tb.id})">✕</button>`;
    d.addEventListener("click", () => selectTb(tb));
    list.appendChild(d);
  });
}

/* ── HIT TEST ─── */
function tbAt(vx, vy) {
  for (let i = textBoxes.length-1; i >= 0; i--) {
    const tb = textBoxes[i];
    const {vx:tx, vy:ty} = imgToView(tb.x, tb.y);
    if (vx>=tx && vx<=tx+tb.w*scale && vy>=ty && vy<=ty+tb.h*scale) return tb;
  }
  return null;
}

function isHandle(tb, vx, vy) {
  const {vx:tx, vy:ty} = imgToView(tb.x, tb.y);
  const tw=tb.w*scale, th=tb.h*scale;
  return vx>=tx+tw-HS && vx<=tx+tw+3 && vy>=ty+th-HS && vy<=ty+th+3;
}

/* ── SZÖVEG RÁÉGETÉS ─── */
function burnTextBoxes() {
  if (!textBoxes.length) { setStatus("Nincs szövegdoboz.", "err"); return; }
  const ctx = origCanvas.getContext("2d");
  [...textBoxes].forEach(tb => {
    const fs = tb.fontSize;
    const PAD = 8;
    const maxTextW = tb.w - PAD * 2;
    ctx.save();
    ctx.font = `${tb.fontStyle} ${tb.fontWeight} ${fs}px ${tb.fontFamily}`;
    ctx.fillStyle = tb.color; ctx.textBaseline = "top";
    if (tb.strokeWidth > 0) {
      ctx.strokeStyle = tb.strokeColor; ctx.lineWidth = tb.strokeWidth*2; ctx.lineJoin = "round";
    }
    // Ugyanolyan tördelés mint drawTb-ben
    const rawLines = tb.text.split("\n");
    const wrappedLines = [];
    for (const raw of rawLines) {
      const wrapped = wrapLines(ctx, raw, maxTextW);
      wrappedLines.push(...(wrapped.length ? wrapped : [""]));
    }
    ctx.textAlign = tb.textAlign || "center";
    const alignX = tb.textAlign === "right"  ? tb.x + tb.w - PAD :
                   tb.textAlign === "left"   ? tb.x + PAD :
                   tb.x + tb.w / 2;
    wrappedLines.forEach((line, i) => {
      const ty = tb.y + PAD + i * fs * 1.4;
      if (tb.strokeWidth > 0) ctx.strokeText(line, alignX, ty);
      ctx.fillText(line, alignX, ty);
    });
    ctx.textAlign = "left";
    ctx.restore();
  });
  textBoxes.length = 0; selectTb(null); updateTbList(); renderAll();
  setStatus("✅ Szöveg ráégetve!", "ok");
}

/* ── MÓD ─── */
function setMode(m) {
  mode = m;
  ["mask","brush","pan","text","pipette"].forEach(id => {
    const b = document.getElementById("btn-"+id);
    if (b) b.classList.toggle("act", id===m);
  });
  const c={mask:"crosshair",brush:"crosshair",pan:"grab",text:"copy",pipette:"crosshair"};
  oc.style.cursor = c[m]||"crosshair";
  setStatus({mask:"🖌 Rajzold be a javítandó területet.",brush:"✏️ Ecset festés.",
    pipette:"💉 Kattints a képre szín felvételéhez.",pan:"✋ Húzd a képet.",
    text:"💬 Kattints a képre szövegdoboz helyéhez."}[m]||"");
}

/* ── FESTÉS ─── */
function paintMask(vx, vy) {
  const {x,y} = viewToImg(vx,vy);
  const m = getMaskCanvas().getContext("2d");
  m.fillStyle = "rgba(255,80,80,.55)";
  m.beginPath(); m.arc(x,y,bs,0,Math.PI*2); m.fill();
  renderMaskOverlay();
}

function paintBrush(vx, vy) {
  const {x,y} = viewToImg(vx,vy);
  const ctx = origCanvas.getContext("2d");
  ctx.fillStyle = brushColor;
  ctx.beginPath(); ctx.arc(x,y,bs,0,Math.PI*2); ctx.fill();
  renderImage();
}

function pickColor(vx, vy) {
  const {x,y} = viewToImg(vx,vy);
  const px=Math.floor(x), py=Math.floor(y);
  if (!origCanvas||px<0||py<0||px>=origCanvas.width||py>=origCanvas.height) return;
  const d = origCanvas.getContext("2d").getImageData(px,py,1,1).data;
  const hex = "#"+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,"0")).join("");
  brushColor = hex;
  document.getElementById("brushColor").value = hex;
  setMode("brush"); setStatus("✅ Szín: "+hex, "ok");
}

/* ── POINTER EVENTS ─── */
oc.addEventListener("mousedown", e => {
  const {vx, vy} = eventPos(e);

  if (mode === "text" || mode === "pan") {
    const hit = tbAt(vx, vy);
    if (hit) {
      selectTb(hit);
      if (hit.selected && isHandle(hit, vx, vy)) {
        tbResizing = true; tbResizeStart = {vx, vy, w:hit.w, h:hit.h}; return;
      }
      tbDragging = true; tbDragStart = {vx, vy, ox:hit.x, oy:hit.y}; return;
    }
    if (mode === "text") {
      selectTb(null);
      const {x,y} = viewToImg(vx,vy); makeTb(x,y); return;
    }
    // pan - nincs szövegdoboz találat
    panStart = {x:e.clientX, y:e.clientY}; panOffset = {x:offX, y:offY};
    oc.style.cursor = "grabbing"; return;
  }

  if (mode==="pipette") { pickColor(vx,vy); return; }
  if (mode==="brush")   { painting=true; paintBrush(vx,vy); return; }
  if (mode==="mask")    { saveMaskState(); painting=true; paintMask(vx,vy); }
});

oc.addEventListener("mousemove", e => {
  const {vx, vy} = eventPos(e);

  if (tbDragging && selectedTb) {
    selectedTb.x = tbDragStart.ox + (vx-tbDragStart.vx)/scale;
    selectedTb.y = tbDragStart.oy + (vy-tbDragStart.vy)/scale;
    renderOverlay(); return;
  }
  if (tbResizing && selectedTb) {
    selectedTb.w = Math.max(60, tbResizeStart.w + (vx-tbResizeStart.vx)/scale);
    selectedTb.h = Math.max(30, tbResizeStart.h + (vy-tbResizeStart.vy)/scale);
    renderOverlay(); return;
  }
  if (panStart) {
    offX = panOffset.x + (e.clientX-panStart.x);
    offY = panOffset.y + (e.clientY-panStart.y);
    renderAll(); return;
  }

  // Kurzor
  if (mode==="text"||mode==="pan") {
    const hit = tbAt(vx,vy);
    oc.style.cursor = hit ? (hit.selected&&isHandle(hit,vx,vy)?"se-resize":"move") :
      (mode==="pan"?"grab":"copy");
  }

  if (!painting) return;
  if (mode==="brush") paintBrush(vx,vy);
  if (mode==="mask")  paintMask(vx,vy);
});

oc.addEventListener("mouseup",    () => { painting=tbDragging=tbResizing=false; panStart=null; lastPaintPoint=null; oc.style.cursor=mode==="pan"?"grab":"crosshair"; });
oc.addEventListener("mouseleave", () => { painting=false; lastPaintPoint=null; if (!tbDragging&&!tbResizing) panStart=null; });

// Touch support - folyamatos rajzolás + 2 ujjas zoom/pan
let lastPaintPoint = null;
let lastPinchDistance = 0;
let lastTouchCenter = null;

oc.addEventListener("touchstart", e => {
  const touches = Array.from(e.touches);
  
  // 2 ujj = zoom/pan, ne legyen rajzolás
  if (touches.length === 2) {
    e.preventDefault();
    const touch1 = touches[0];
    const touch2 = touches[1];
    const r = vp.getBoundingClientRect();
    
    // Távolság számítása
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    lastPinchDistance = Math.sqrt(dx * dx + dy * dy);
    
    // Középpont számítása
    lastTouchCenter = {
      x: (touch1.clientX + touch2.clientX) / 2 - r.left,
      y: (touch1.clientY + touch2.clientY) / 2 - r.top
    };
    return;
  }
  
  // 1 ujj = normál kezelés
  e.preventDefault();
  const touch = e.touches[0];
  const r = vp.getBoundingClientRect();
  const vx = touch.clientX - r.left;
  const vy = touch.clientY - r.top;

  if (mode === "text" || mode === "pan") {
    const hit = tbAt(vx, vy);
    if (hit) {
      selectTb(hit);
      if (hit.selected && isHandle(hit, vx, vy)) {
        tbResizing = true; tbResizeStart = {vx, vy, w:hit.w, h:hit.h}; return;
      }
      tbDragging = true; tbDragStart = {vx, vy, ox:hit.x, oy:hit.y}; return;
    }
    if (mode === "text") {
      selectTb(null);
      const {x,y} = viewToImg(vx,vy); makeTb(x,y); return;
    }
    panStart = {x:touch.clientX, y:touch.clientY}; panOffset = {x:offX, y:offY};
    return;
  }

  if (mode === "pipette") { pickColor(vx, vy); return; }
  if (mode === "brush")   { painting=true; lastPaintPoint={vx,vy}; paintBrush(vx,vy); return; }
  if (mode === "mask")    { saveMaskState(); painting=true; lastPaintPoint={vx,vy}; paintMask(vx,vy); }
}, {passive:false});

oc.addEventListener("touchmove", e => {
  const touches = Array.from(e.touches);
  
  // 2 ujj = zoom/pan
  if (touches.length === 2) {
    e.preventDefault();
    const touch1 = touches[0];
    const touch2 = touches[1];
    const r = vp.getBoundingClientRect();
    
    // Új távolság
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    const newDistance = Math.sqrt(dx * dx + dy * dy);
    
    // Új középpont
    const newCenter = {
      x: (touch1.clientX + touch2.clientX) / 2 - r.left,
      y: (touch1.clientY + touch2.clientY) / 2 - r.top
    };
    
    if (lastPinchDistance > 0 && lastTouchCenter) {
      // Távolság változás (zoom)
      const distanceChange = Math.abs(newDistance - lastPinchDistance);
      
      // Középpont mozgás (pan)
      const centerDx = newCenter.x - lastTouchCenter.x;
      const centerDy = newCenter.y - lastTouchCenter.y;
      const centerMove = Math.sqrt(centerDx * centerDx + centerDy * centerDy);
      
      // Döntés: zoom vagy pan?
      if (distanceChange > centerMove * 1.5) {
        // ZOOM - ujjak szét/össze mozognak
        const delta = (newDistance - lastPinchDistance) * 0.01;
        zoom(delta, newCenter.x, newCenter.y);
      } else if (centerMove > 5) {
        // PAN - ujjak együtt mozognak
        offX += centerDx;
        offY += centerDy;
        renderAll();
      }
    }
    
    lastPinchDistance = newDistance;
    lastTouchCenter = newCenter;
    return;
  }
  
  // 1 ujj = normál kezelés
  e.preventDefault();
  const touch = e.touches[0];
  const r = vp.getBoundingClientRect();
  const vx = touch.clientX - r.left;
  const vy = touch.clientY - r.top;

  if (tbDragging && selectedTb) {
    selectedTb.x = tbDragStart.ox + (vx-tbDragStart.vx)/scale;
    selectedTb.y = tbDragStart.oy + (vy-tbDragStart.vy)/scale;
    renderOverlay(); return;
  }
  if (tbResizing && selectedTb) {
    selectedTb.w = Math.max(60, tbResizeStart.w + (vx-tbResizeStart.vx)/scale);
    selectedTb.h = Math.max(30, tbResizeStart.h + (vy-tbResizeStart.vy)/scale);
    renderOverlay(); return;
  }
  if (panStart) {
    offX = panOffset.x + (touch.clientX-panStart.x);
    offY = panOffset.y + (touch.clientY-panStart.y);
    renderAll(); return;
  }

  if (!painting) return;
  
  // Folyamatos rajzolás - interpoláció az előző ponttól
  if (lastPaintPoint) {
    drawTouchLine(lastPaintPoint.vx, lastPaintPoint.vy, vx, vy);
  }
  lastPaintPoint = {vx, vy};
}, {passive:false});

oc.addEventListener("touchend", () => { 
  painting=tbDragging=tbResizing=false; 
  panStart=null; 
  lastPaintPoint=null;
  lastPinchDistance=0;
  lastTouchCenter=null;
});

oc.addEventListener("touchcancel", () => { 
  painting=false; 
  lastPaintPoint=null;
  lastPinchDistance=0;
  lastTouchCenter=null;
  if (!tbDragging&&!tbResizing) panStart=null; 
});

// Vonal rajzolása két pont között (folyamatos ecset touch-hoz)
function drawTouchLine(vx1, vy1, vx2, vy2) {
  const dx = Math.abs(vx2 - vx1);
  const dy = Math.abs(vy2 - vy1);
  const steps = Math.max(dx, dy);
  
  if (steps === 0) return;
  
  const stepCount = Math.max(1, Math.ceil(steps / 2));
  
  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;
    const vx = vx1 + (vx2 - vx1) * t;
    const vy = vy1 + (vy2 - vy1) * t;
    if (mode === "mask") paintMask(vx, vy);
    if (mode === "brush") paintBrush(vx, vy);
  }
}

// Desktop görgő: CTRL+görgő = zoom, sima görgő = scroll
oc.addEventListener("wheel", e => {
  // Csak CTRL+görgő esetén zoom
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const r=vp.getBoundingClientRect();
    zoom(e.deltaY<0?0.15:-0.15, e.clientX-r.left, e.clientY-r.top);
  }
  // Egyébként hagyjuk hogy scrollozzon (nincs preventDefault)
}, {passive:false});

window.addEventListener("resize", () => { if (imgEl) resizeCanvases(); });
document.getElementById("brushColor").addEventListener("input", e => { brushColor = e.target.value; });

/* ── MASZK BOUNDING BOX kiszámítása ─── */
function getMaskBoundingBox(mC, padding = 80) {
  const mData = mC.getContext("2d").getImageData(0, 0, mC.width, mC.height);
  let minX = mC.width, minY = mC.height, maxX = 0, maxY = 0;
  for (let y = 0; y < mC.height; y++) {
    for (let x = 0; x < mC.width; x++) {
      const a = mData.data[(y * mC.width + x) * 4 + 3];
      if (a > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX === 0 && maxY === 0) return null;

  // padding hozzáadása
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(mC.width - 1, maxX + padding);
  maxY = Math.min(mC.height - 1, maxY + padding);

  // SD kompatibilis: 64 többszöröse, minimum 512×512
  const align = 64;
  const minSize = 512;
  let w = Math.max(minSize, Math.ceil((maxX - minX) / align) * align);
  let h = Math.max(minSize, Math.ceil((maxY - minY) / align) * align);

  // Középre igazítás a maszkolt terület körül
  const cx = Math.floor((minX + maxX) / 2);
  const cy = Math.floor((minY + maxY) / 2);
  let x = Math.max(0, cx - Math.floor(w / 2));
  let y = Math.max(0, cy - Math.floor(h / 2));

  // Ne lógjon ki a képből
  if (x + w > mC.width)  x = Math.max(0, mC.width  - w);
  if (y + h > mC.height) y = Math.max(0, mC.height - h);
  w = Math.min(w, mC.width  - x);
  h = Math.min(h, mC.height - y);

  return { x, y, w, h };
}

/* ── AI INPAINT - csak a maszkolt terület ─── */
async function runInpaint() {
  if (!imgEl) { setStatus("Nincs kép!", "err"); return; }
  const mC = getMaskCanvas();
  const mD = mC.getContext("2d").getImageData(0, 0, mC.width, mC.height);
  let has = false;
  for (let i = 3; i < mD.data.length; i += 4) if (mD.data[i] > 20) { has = true; break; }
  if (!has) { setStatus("Rajzolj maszkot!", "err"); return; }

  // Bounding box meghatározása
  const bbox = getMaskBoundingBox(mC);
  if (!bbox) { setStatus("Rajzolj maszkot!", "err"); return; }

  showProgress(true, `🎨 Padli művész éppen fest... (${bbox.w}×${bbox.h}px)`);

  // Undo mentése
  beforeInpaint = document.createElement("canvas");
  beforeInpaint.width = origCanvas.width; beforeInpaint.height = origCanvas.height;
  beforeInpaint.getContext("2d").drawImage(origCanvas, 0, 0);

  try {
    // ── 1. Cropped kép ──
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = bbox.w; cropCanvas.height = bbox.h;
    cropCanvas.getContext("2d").drawImage(
      origCanvas, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h
    );

    // ── 2. Cropped maszk (fehér=javítandó) ──
    const maskCrop = document.createElement("canvas");
    maskCrop.width = bbox.w; maskCrop.height = bbox.h;
    const maskCtx = maskCrop.getContext("2d");
    maskCtx.fillStyle = "#000";
    maskCtx.fillRect(0, 0, bbox.w, bbox.h);

    const srcData  = mC.getContext("2d").getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    const dstData  = maskCtx.getImageData(0, 0, bbox.w, bbox.h);
    for (let i = 3; i < srcData.data.length; i += 4) {
      if (srcData.data[i] > 20) {
        const p = i - 3;
        dstData.data[p] = 255; dstData.data[p+1] = 255;
        dstData.data[p+2] = 255; dstData.data[p+3] = 255;
      }
    }
    maskCtx.putImageData(dstData, 0, 0);

    const imageBase64 = cropCanvas.toDataURL("image/png");
    const maskBase64  = maskCrop.toDataURL("image/png");
    const prompt      = document.getElementById("prompt")?.value || "clean background, smooth";

    // ── 3. API hívás ──
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 600000);

    let res, data;
    try {
      res = await fetch("/api/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, maskBase64, prompt }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      setStatus(fetchErr.name === "AbortError"
        ? "❌ Timeout - ComfyUI nem válaszolt 10 percen belül"
        : "❌ Hálózati hiba: " + fetchErr.message, "err");
      showProgress(false); return;
    }

    const text = await res.text();
    try { data = JSON.parse(text); }
    catch {
      setStatus("❌ Szerver hiba (nem JSON) - nézd a journalctl-t", "err");
      showProgress(false); return;
    }

    if (!res.ok || data.error) {
      setStatus("❌ " + (data.error || "Ismeretlen hiba"), "err");
      showProgress(false); return;
    }

    // ── 4. Eredmény visszaillesztése a crop helyére ──
    const resultImg = new Image();
    resultImg.onload = () => {
      origCanvas.getContext("2d").drawImage(
        resultImg, 0, 0, bbox.w, bbox.h,
        bbox.x, bbox.y, bbox.w, bbox.h
      );
      document.getElementById("undo-btn").style.display = "";
      clearMask(); renderAll();
      setStatus("✅ Inpaint kész!", "ok");
      showProgress(false);
    };
    resultImg.src = data.image;

  } catch (e) {
    setStatus("❌ " + e.message, "err");
    showProgress(false);
  }
}



function undoInpaint() {
  if (!beforeInpaint) return;
  origCanvas.getContext("2d").drawImage(beforeInpaint,0,0);
  renderAll(); document.getElementById("undo-btn").style.display="none";
  setStatus("↩ Visszavonva.");
}

/* ── MENTÉS ─── */
function openSaveModal() {
  if (!origCanvas) { setStatus("Nincs kép.", "err"); return; }
  document.getElementById("saveModalInfo").textContent =
    BUG_FIX_ID ? `Korrekció mentése (fix #${BUG_FIX_ID})` :
    BUG_SLUG ? `${BUG_SLUG} / ${BUG_CHAPTER} / kép #${BUG_INDEX}` : "Letöltés az Export gombokkal.";
  document.getElementById("saveModal").classList.add("open");
}

function closeSaveModal() { document.getElementById("saveModal").classList.remove("open"); }

async function saveAsFixed() {
  if (!origCanvas || (!BUG_SLUG && !BUG_FIX_ID)) return;
  closeSaveModal(); showProgress(true,"Feltöltés...");
  try {
    if (textBoxes.length) burnTextBoxes();
    const blob = await new Promise(r=>origCanvas.toBlob(r,"image/jpeg",0.95));
    const fd = new FormData();
    fd.append("image", blob, `${BUG_INDEX || "fix"}.jpg`);

    if (BUG_FIX_ID) {
      const res = await fetch(`/api/bug-reports/fix/${BUG_FIX_ID}/correct`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      showProgress(false); setStatus("✅ Korrigálva!", "ok");
      setTimeout(() => window.close(), 1500);
    } else {
      fd.append("manga_slug", BUG_SLUG); fd.append("chapter", BUG_CHAPTER);
      fd.append("image_index", BUG_INDEX); fd.append("provider", BUG_PROVIDER || "unknown");
      const res = await fetch("/api/bug-reports/fix/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      showProgress(false); setStatus("✅ Elmentve!", "ok");
      setTimeout(() => { location.href="/bug-reports.html"; }, 1500);
    }
  } catch(e) { showProgress(false); setStatus("❌ "+e.message,"err"); }
}

function exportPNG() { if(!origCanvas)return; if(textBoxes.length)burnTextBoxes(); const a=document.createElement("a"); a.download="javitott.png"; a.href=origCanvas.toDataURL("image/png"); a.click(); }
function exportJPG() { if(!origCanvas)return; if(textBoxes.length)burnTextBoxes(); const a=document.createElement("a"); a.download="javitott.jpg"; a.href=origCanvas.toDataURL("image/jpeg",0.95); a.click(); }

function showProgress(on, msg="Feldolgozás...") {
  document.getElementById("progress").style.display=on?"flex":"none";
  document.getElementById("prog-msg").textContent=msg;
}

/* ══════════════════════════════════════════════════════════
   KÉPLISTA NAVIGÁCIÓ
   ══════════════════════════════════════════════════════════ */

// Képlista betöltése a fejezetből
async function loadImageList() {
  if (!BUG_SLUG || !BUG_CHAPTER) return;
  
  try {
    const res = await fetch(`/api/pages/${BUG_SLUG}/${BUG_CHAPTER}`);
    if (!res.ok) throw new Error("Képlista nem tölthető be");
    
    const data = await res.json();
    allImages = data.pages || [];
    
    // Aktuális kép indexének megkeresése
    if (BUG_INDEX !== null) {
      currentImageIndex = parseInt(BUG_INDEX);
    }
    
    // Bug reportok lekérése
    await loadBugReportsStatus();
    
    // Képlista renderelése
    renderImageList();
    
    // Aktuális kép ellenőrzése
    checkCurrentImageBugReport();
    
  } catch (err) {
    console.error("Image list load error:", err);
  }
}

// Bug report állapotok lekérése az összes képhez
async function loadBugReportsStatus() {
  if (!BUG_SLUG || !BUG_CHAPTER) return;
  
  try {
    const res = await fetch(`/api/bug-reports?manga_slug=${encodeURIComponent(BUG_SLUG)}&chapter=${encodeURIComponent(BUG_CHAPTER)}&closed=false`);
    if (!res.ok) return;
    
    const reports = await res.json();
    
    // Indexeljük melyik képnek van bug reportja
    imageHasBugReport = {};
    reports.forEach(report => {
      if (report.image_index !== null && report.image_index !== undefined) {
        imageHasBugReport[report.image_index] = true;
      }
    });
    
  } catch (err) {
    console.error("Bug reports status load error:", err);
  }
}

// Képlista UI renderelése
function renderImageList() {
  const container = document.getElementById("imageListScroll");
  if (!container) return;
  
  container.innerHTML = "";
  
  allImages.forEach((imageFile, index) => {
    const item = document.createElement("div");
    item.className = "image-list-item";
    
    if (index === currentImageIndex) {
      item.classList.add("current");
    }
    
    if (imageHasBugReport[index]) {
      item.classList.add("has-bug-report");
    }
    
    // Thumbnail URL
    const thumbUrl = `/api/image/${BUG_PROVIDER}/${BUG_SLUG}/${BUG_CHAPTER}/${encodeURIComponent(imageFile)}`;
    
    item.innerHTML = `
      <img class="image-thumb-mini" src="${thumbUrl}" alt="${index}" loading="lazy">
      <div class="image-list-info">
        <div class="image-list-name">#${index}</div>
        <div class="image-list-status ${imageHasBugReport[index] ? 'reported' : ''}">
          ${imageHasBugReport[index] ? '✓ Bejelentve' : 'Nincs jegy'}
        </div>
      </div>
    `;
    
    item.addEventListener("click", () => {
      switchToImage(index);
    });
    
    container.appendChild(item);
  });
  
  // Navigációs gombok állapota
  updateNavButtons();
}

// Navigációs gombok engedélyezése/letiltása
function updateNavButtons() {
  const prevBtn = document.getElementById("prevImageBtn");
  const nextBtn = document.getElementById("nextImageBtn");
  
  if (prevBtn) prevBtn.disabled = currentImageIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentImageIndex >= allImages.length - 1;
}

// Váltás másik képre
function navigateImage(direction) {
  const newIndex = currentImageIndex + direction;
  
  if (newIndex < 0 || newIndex >= allImages.length) return;
  
  switchToImage(newIndex);
}

// Kép váltás (index alapján)
async function switchToImage(newIndex) {
  if (newIndex < 0 || newIndex >= allImages.length) return;
  
  currentImageIndex = newIndex;
  const imageFile = allImages[newIndex];
  const imageUrl = `/api/image/${BUG_PROVIDER}/${BUG_SLUG}/${BUG_CHAPTER}/${encodeURIComponent(imageFile)}`;
  
  // URL frissítése (history.pushState nélkül, hogy ne kelljen back kezelés)
  const newUrl = new URL(location.href);
  newUrl.searchParams.set("image_index", newIndex);
  newUrl.searchParams.set("image_url", imageUrl);
  history.replaceState({}, "", newUrl);
  
  // Kép betöltése
  await loadImageFromUrl(imageUrl);
  
  // UI frissítés
  renderImageList();
  checkCurrentImageBugReport();
}

// Aktuális kép bug report állapotának ellenőrzése
function checkCurrentImageBugReport() {
  const hasBugReport = imageHasBugReport[currentImageIndex];
  const banner = document.getElementById("fix-request-banner");
  
  if (hasBugReport) {
    // Van bug report - szerkesztés engedélyezve
    isEditingBlocked = false;
    if (banner) banner.classList.remove("show");
    enableEditing();
  } else {
    // Nincs bug report - szerkesztés blokkolva
    isEditingBlocked = true;
    if (banner) banner.classList.add("show");
    disableEditing();
  }
}

// Szerkesztés engedélyezése
function enableEditing() {
  // Gombok aktiválása
  document.querySelectorAll("#topbar .btn").forEach(btn => {
    if (!btn.id.includes("nav") && !btn.id.includes("zoom")) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });
}

// Szerkesztés letiltása
function disableEditing() {
  // Csak zoom/pan és vissza gombok maradjanak aktívak
  document.querySelectorAll("#topbar .btn").forEach(btn => {
    if (!btn.id.includes("zoom") && !btn.id.includes("pan") && 
        btn.textContent !== "← Vissza" && btn.textContent !== "Illeszkedj") {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    }
  });
  
  // Maszk és szöveg módokat is tiltjuk
  if (mode !== "pan") {
    setMode("pan");
  }
}

// "Ezt is javítom" gomb - automatikus bug report létrehozása
async function reportCurrentImage() {
  if (currentImageIndex < 0) return;
  
  const imageFile = allImages[currentImageIndex];
  const imageUrl = `/api/image/${BUG_PROVIDER}/${BUG_SLUG}/${BUG_CHAPTER}/${encodeURIComponent(imageFile)}`;
  
  try {
    showProgress(true, "Hibajegy létrehozása...");
    
    const res = await fetch("/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        description: "Ezt is javítani kell"
      })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Hibajegy létrehozása sikertelen");
    }
    
    // Sikeres létrehozás
    imageHasBugReport[currentImageIndex] = true;
    renderImageList();
    checkCurrentImageBugReport();
    
    setStatus("✅ Hibajegy létrehozva!", "ok");
    showProgress(false);
    
  } catch (err) {
    showProgress(false);
    setStatus("❌ " + err.message, "err");
    alert("Hiba a hibajegy létrehozásakor: " + err.message);
  }
}

// Panel nyitás/csukás
function toggleImageListPanel() {
  const panel = document.getElementById("image-list-panel");
  const toggle = panel.querySelector(".panel-toggle");
  
  if (panel.classList.contains("open")) {
    panel.classList.remove("open");
    toggle.textContent = "▶";
  } else {
    panel.classList.add("open");
    toggle.textContent = "◀";
  }
}

// Inicializálás - képlista betöltése
window.addEventListener("DOMContentLoaded", () => {
  if (BUG_SLUG && BUG_CHAPTER) {
    loadImageList();
  }
});

function setStatus(msg, type) {
  const el=document.getElementById("status-text");
  el.textContent=msg; el.className=type?"status-"+type:"";
}
