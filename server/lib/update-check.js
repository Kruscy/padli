/* ── Verzió és frissítés-ellenőrzés ────────────────────────────
   A futó verzió a package.json-ból; a legújabb kiadást a GitHub
   releases API-ból kérdezzük le (UPDATE_CHECK_REPO, alapértelmezés az
   eredeti tároló), 6 óránként legfeljebb egyszer. Kikapcsolás:
   UPDATE_CHECK=false. Hálózati hiba esetén csak "ismeretlen" az eredmény,
   az oldal működését nem érinti. ── */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const CACHE_MS = 6 * 60 * 60 * 1000;
let cached = null; // { at, latest, url }

// "1.10.0" > "1.9.3"; az előtag (v) és a -pre rész nem számít
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split("-")[0].split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export async function checkForUpdate({ fetchImpl = fetch } = {}) {
  const base = { current: APP_VERSION, latest: null, updateAvailable: false, releaseUrl: null };
  if (process.env.UPDATE_CHECK === "false") return { ...base, disabled: true };
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const repo = process.env.UPDATE_CHECK_REPO || "Kruscy/padli";
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "padli-update-check" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const rel = await res.json();
      cached = { at: Date.now(), latest: String(rel.tag_name || "").replace(/^v/, "") || null, url: rel.html_url || null };
    } catch (err) {
      // rövid ideig ne próbálkozzunk újra minden admin-oldalbetöltésnél
      cached = { at: Date.now() - CACHE_MS + 10 * 60 * 1000, latest: null, url: null, error: err.message };
    }
  }
  return {
    ...base,
    latest: cached.latest,
    releaseUrl: cached.url,
    updateAvailable: !!cached.latest && compareVersions(cached.latest, APP_VERSION) > 0,
  };
}

export function resetUpdateCache() { cached = null; }
