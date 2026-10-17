/* ═══════════════════════════════════════════════════════════
   FILE-BASED CACHE - FIXED PATH
   ═══════════════════════════════════════════════════════════ */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ✅ ABSZOLÚT ÚTVONAL (ESM-kompatibilis)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, "new-manga.json");

// Ensure cache directory exists
if (!fs.existsSync(path.dirname(CACHE_FILE))) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
}

export function getNewMangaCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return null;
    }
    
    const data = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(data);
    
    return parsed.data;
  } catch (err) {
    console.error("❌ Failed to read new manga cache:", err);
    return null;
  }
}

export function setNewMangaCache(data) {
  try {
    const cache = {
      data,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
    console.log(`✅ New manga cache saved to: ${CACHE_FILE}`);
  } catch (err) {
    console.error("❌ Failed to write new manga cache:", err);
  }
}

export function clearNewMangaCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
  } catch (err) {
    console.error("❌ Failed to clear new manga cache:", err);
  }
}
