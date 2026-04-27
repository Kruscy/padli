/* ============================================================
   ai.js - AI funkciók: OCR, fordítás, inpaint (FIXED)
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   SEGÉD: biztonságos JSON parse
   ══════════════════════════════════════════════════════════ */

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Szerver nem JSON-t adott vissza (404 / PHP hiba?)");
  }
}

/* ══════════════════════════════════════════════════════════
   OCR
   ══════════════════════════════════════════════════════════ */

async function runOCR() {
  if (!selectedTb || !imgEl) return;

  const btn = document.getElementById("ocrBtn");
  const status = document.getElementById("ocrStatus");

  btn.disabled = true;
  btn.textContent = "⏳ OCR...";
  status.style.display = "block";
  status.textContent = "Feldolgozás...";

  try {
    const tmpCanvas = document.createElement("canvas");
    const margin = 10;

    tmpCanvas.width = selectedTb.w + margin * 2;
    tmpCanvas.height = selectedTb.h + margin * 2;

    const ctx = tmpCanvas.getContext("2d");

    ctx.drawImage(
      imgEl,
      selectedTb.x - margin,
      selectedTb.y - margin,
      tmpCanvas.width,
      tmpCanvas.height,
      0,
      0,
      tmpCanvas.width,
      tmpCanvas.height
    );

    const imageBase64 = tmpCanvas.toDataURL("image/png");

    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ imageBase64 })
    });

    const data = await safeJson(res);

    if (!res.ok || data.error) {
      throw new Error(data.error || "OCR hiba");
    }

    if (data.text) {
      selectedTb.text = data.text;
      document.getElementById("tb-text").value = data.text;

      renderOverlay();
      updateTbList();

      status.textContent = "✅ OCR kész";
      status.style.color = "#86efac";
    } else {
      status.textContent = "⚠️ Nem talált szöveget";
      status.style.color = "#fca5a5";
    }

  } catch (err) {
    console.error("OCR error:", err);
    status.textContent = "❌ " + err.message;
    status.style.color = "#fca5a5";
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 OCR";

    setTimeout(() => {
      status.style.display = "none";
    }, 3000);
  }
}

/* ══════════════════════════════════════════════════════════
   TRANSLATE
   ══════════════════════════════════════════════════════════ */

async function translateText() {
  if (!selectedTb) return;

  const btn = document.getElementById("translateBtn");
  const status = document.getElementById("translateStatus");

  btn.disabled = true;
  btn.textContent = "⏳ Fordítás...";
  status.style.display = "block";
  status.textContent = "Fordítás...";

  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: selectedTb.text,
        source: "en",
        target: "hu"
      })
    });

    const data = await safeJson(res);

    if (!res.ok || data.error) {
      throw new Error(data.error || "Fordítás hiba");
    }

    if (data.translatedText) {
      selectedTb.text = data.translatedText;
      document.getElementById("tb-text").value = data.translatedText;

      renderOverlay();
      updateTbList();

      status.textContent = "✅ Fordítva";
      status.style.color = "#86efac";
    }

  } catch (err) {
    console.error("Translation error:", err);
    status.textContent = "❌ " + err.message;
    status.style.color = "#fca5a5";
  } finally {
    btn.disabled = false;
    btn.textContent = "🌐 Fordítás";

    setTimeout(() => {
      status.style.display = "none";
    }, 3000);
  }
}

/* ══════════════════════════════════════════════════════════
   INPAINT
   ══════════════════════════════════════════════════════════ */

function getMaskBoundingBox(mC, padding = 80) {
  const mCtx = mC.getContext("2d");
  const w = mC.width, h = mC.height;
  const data = mCtx.getImageData(0, 0, w, h).data;
  
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let hasPixels = false;
  
  // Keressük a piros pixeleket (maszk)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Alpha csatorna ellenőrzés (maszk átlátszatlanság)
      if (data[i + 3] > 20) {
        hasPixels = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  
  if (!hasPixels) return null;
  
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(w - 1, maxX + padding);
  maxY = Math.min(h - 1, maxY + padding);
  
  // JAVÍTOTT: SD kompatibilis méret (64 többszöröse, min 512×512)
  const align = 64;
  const minSize = 512;
  let bw = Math.max(minSize, Math.ceil((maxX - minX) / align) * align);
  let bh = Math.max(minSize, Math.ceil((maxY - minY) / align) * align);
  
  // Középre igazítás
  const cx = Math.floor((minX + maxX) / 2);
  const cy = Math.floor((minY + maxY) / 2);
  let x = Math.max(0, cx - Math.floor(bw / 2));
  let y = Math.max(0, cy - Math.floor(bh / 2));
  
  // Ne lógjon ki
  if (x + bw > w) x = Math.max(0, w - bw);
  if (y + bh > h) y = Math.max(0, h - bh);
  bw = Math.min(bw, w - x);
  bh = Math.min(bh, h - y);
  
  return { x, y, w: bw, h: bh };
}
 
async function runInpaint() {
  if (!imgEl) {
    setStatus("Nincs kép!", "err");
    return;
  }
  
  const mC = getMaskCanvas();
  const mD = mC.getContext("2d").getImageData(0, 0, mC.width, mC.height);
  
  // Maszk ellenőrzés
  let has = false;
  for (let i = 3; i < mD.data.length; i += 4) {
    if (mD.data[i] > 20) {
      has = true;
      break;
    }
  }
  
  if (!has) {
    setStatus("Rajzolj maszkot!", "err");
    return;
  }
  
  const bbox = getMaskBoundingBox(mC);
  if (!bbox) {
    setStatus("Rajzolj maszkot!", "err");
    return;
  }
  
  showProgress(true, `🎨 Padli művész éppen fest... (${bbox.w}×${bbox.h}px)`);
  
  // Undo mentése
  beforeInpaint = document.createElement("canvas");
  beforeInpaint.width = origCanvas.width;
  beforeInpaint.height = origCanvas.height;
  beforeInpaint.getContext("2d").drawImage(origCanvas, 0, 0);
  
  try {
    // 1. Cropped kép
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = bbox.w;
    cropCanvas.height = bbox.h;
    cropCanvas.getContext("2d").drawImage(
      origCanvas, bbox.x, bbox.y, bbox.w, bbox.h,
      0, 0, bbox.w, bbox.h
    );
    
    // 2. Cropped maszk (FEHÉR=javítandó, nem piros!)
    const maskCrop = document.createElement("canvas");
    maskCrop.width = bbox.w;
    maskCrop.height = bbox.h;
    const maskCtx = maskCrop.getContext("2d");
    maskCtx.fillStyle = "#000";
    maskCtx.fillRect(0, 0, bbox.w, bbox.h);
    
    const srcData = mC.getContext("2d").getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    const dstData = maskCtx.getImageData(0, 0, bbox.w, bbox.h);
    
    for (let i = 3; i < srcData.data.length; i += 4) {
      if (srcData.data[i] > 20) {
        const p = i - 3;
        dstData.data[p] = 255;     // R
        dstData.data[p + 1] = 255; // G
        dstData.data[p + 2] = 255; // B
        dstData.data[p + 3] = 255; // A
      }
    }
    maskCtx.putImageData(dstData, 0, 0);
    
    const imageBase64 = cropCanvas.toDataURL("image/png");
    const maskBase64 = maskCrop.toDataURL("image/png");
    const prompt = document.getElementById("prompt")?.value || "clean background, smooth";
    
    // 3. API hívás - JAVÍTOTT: /api/inpaint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 perc timeout
    
    let res;
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
      showProgress(false);
      return;
    }
    
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setStatus("❌ Szerver hiba (nem JSON) - nézd a journalctl-t", "err");
      showProgress(false);
      return;
    }
    
    if (!res.ok || data.error) {
      setStatus("❌ " + (data.error || "Ismeretlen hiba"), "err");
      showProgress(false);
      return;
    }
    
    // 4. Eredmény visszaillesztése
    const resultImg = new Image();
    resultImg.onload = () => {
      origCanvas.getContext("2d").drawImage(
        resultImg, 0, 0, bbox.w, bbox.h,
        bbox.x, bbox.y, bbox.w, bbox.h
      );
      
      clearMask();
      renderImage();
      
      const undoBtn = document.getElementById("undo-btn");
      if (undoBtn) undoBtn.style.display = "inline-flex";
      
      showProgress(false);
      setStatus("✅ Inpaint kész!", "ok");
    };
    
    resultImg.onerror = () => {
      showProgress(false);
      setStatus("❌ Kép betöltése sikertelen!", "err");
    };
    
    resultImg.src = data.image;
    
  } catch (err) {
    showProgress(false);
    console.error("Inpaint error:", err);
    setStatus("❌ " + err.message, "err");
  }
}
 
function undoInpaint() {
  if (!beforeInpaint || !origCanvas) return;
  
  const ctx = origCanvas.getContext("2d");
  ctx.clearRect(0, 0, origCanvas.width, origCanvas.height);
  ctx.drawImage(beforeInpaint, 0, 0);
  
  beforeInpaint = null;
  renderImage();
  
  const undoBtn = document.getElementById("undo-btn");
  if (undoBtn) undoBtn.style.display = "none";
  
  setStatus("↩ Inpaint visszavonva", "info");
}
