/* ============================================================
   editor-save.js - Mentés JAVÍTOTT endpoint-okkal
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   SAVE MODAL
   ══════════════════════════════════════════════════════════ */

function openSaveModal() {
  const modal = document.getElementById("saveModal");
  if (modal) modal.classList.add("open");
}

function closeSaveModal() {
  const modal = document.getElementById("saveModal");
  if (modal) modal.classList.remove("open");
}

/* ══════════════════════════════════════════════════════════
   SAVE AS FIXED (with edit layer support)
   ══════════════════════════════════════════════════════════ */

async function saveAsFixed() {
  if (!imgEl) {
    alert("Nincs kép betöltve!");
    return;
  }
  
  showProgress(true, "Mentés előkészítése...");
  
  try {
    // Kompozit kép létrehozása
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = imgEl.width;
    finalCanvas.height = imgEl.height;
    const finalCtx = finalCanvas.getContext('2d');
    
    // 1. Eredeti kép
    finalCtx.drawImage(origCanvas, 0, 0);
    
    // 2. Edit layer
    if (editCanvas) {
      finalCtx.drawImage(editCanvas, 0, 0);
    }
    
    // 3. Szövegdobozok ráégetése (ha vannak)
    if (textBoxes.length > 0) {
      textBoxes.forEach(tb => {
        finalCtx.fillStyle = tb.color;
        finalCtx.font = `${tb.fontStyle} ${tb.fontSize}px "${tb.fontFamily}"`;
        finalCtx.textAlign = tb.align;
        finalCtx.textBaseline = "middle";
        
        if (tb.strokeWidth > 0) {
          finalCtx.strokeStyle = tb.strokeColor;
          finalCtx.lineWidth = tb.strokeWidth;
        }
        
        const lines = wrapLines(finalCtx, tb.text, tb.w - 10);
        const lineH = tb.fontSize * 1.2;
        const totalH = lines.length * lineH;
        const startY = tb.y + (tb.h - totalH) / 2 + lineH / 2;
        
        lines.forEach((line, i) => {
          const textX = tb.align === "center" ? tb.x + tb.w/2 :
                        tb.align === "right" ? tb.x + tb.w - 5 : tb.x + 5;
          const textY = startY + i * lineH;
          
          if (tb.strokeWidth > 0) {
            finalCtx.strokeText(line, textX, textY);
          }
          finalCtx.fillText(line, textX, textY);
        });
      });
    }
    
    // Export as blob
    finalCanvas.toBlob(async (blob) => {
      if (!blob) {
        showProgress(false);
        alert("Mentés sikertelen!");
        return;
      }
      
      // JAVÍTOTT: /api/bug-reports/fix/upload endpoint
      const formData = new FormData();
      formData.append('image', blob, `fixed_${BUG_INDEX}.jpg`);
      formData.append('manga_slug', BUG_SLUG);
      formData.append('chapter', BUG_CHAPTER);
      formData.append('image_index', BUG_INDEX);
      formData.append('provider', BUG_PROVIDER || ''); // Provider support
      
      const res = await fetch('/api/bug-reports/fix/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      
      showProgress(false);
      
      if (res.ok) {
        const data = await res.json();
        console.log('Fix uploaded:', data);
        
        alert("✅ Javított kép sikeresen feltöltve!");
        closeSaveModal();
        
        // Frissítjük a képlista státuszát
        if (typeof imageHasBugReport !== 'undefined' && 
            typeof currentImageIndex !== 'undefined' &&
            typeof updateImageList === 'function') {
          imageHasBugReport[currentImageIndex] = true;
          updateImageList();
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('Save error:', errorData);
        alert("❌ Hiba történt a mentés során: " + (errorData.error || res.statusText));
      }
    }, 'image/jpeg', 0.95); // JPEG formátum, 95% minőség
    
  } catch (err) {
    showProgress(false);
    console.error("Save error:", err);
    alert("❌ Hiba: " + err.message);
  }
}

/* ══════════════════════════════════════════════════════════
   EXPORT FUNCTIONS
   ══════════════════════════════════════════════════════════ */

function exportPNG() {
  if (!origCanvas) return;
  
  // Kompozit kép létrehozása
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = origCanvas.width;
  exportCanvas.height = origCanvas.height;
  const ctx = exportCanvas.getContext('2d');
  
  // 1. Eredeti
  ctx.drawImage(origCanvas, 0, 0);
  
  // 2. Edit layer
  if (editCanvas) {
    ctx.drawImage(editCanvas, 0, 0);
  }
  
  // 3. Textboxes
  if (textBoxes && textBoxes.length > 0) {
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
  }
  
  const a = document.createElement("a");
  a.download = `javitott_${BUG_SLUG || 'image'}_${BUG_CHAPTER || 'ch'}_${BUG_INDEX || '0'}.png`;
  a.href = exportCanvas.toDataURL("image/png");
  a.click();
}

function exportJPG() {
  if (!origCanvas) return;
  
  // Kompozit kép létrehozása
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = origCanvas.width;
  exportCanvas.height = origCanvas.height;
  const ctx = exportCanvas.getContext('2d');
  
  // 1. Eredeti
  ctx.drawImage(origCanvas, 0, 0);
  
  // 2. Edit layer
  if (editCanvas) {
    ctx.drawImage(editCanvas, 0, 0);
  }
  
  // 3. Textboxes
  if (textBoxes && textBoxes.length > 0) {
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
  }
  
  const a = document.createElement("a");
  a.download = `javitott_${BUG_SLUG || 'image'}_${BUG_CHAPTER || 'ch'}_${BUG_INDEX || '0'}.jpg`;
  a.href = exportCanvas.toDataURL("image/jpeg", 0.95);
  a.click();
}
