import fetch from "node-fetch";
import { localPathToR2Key } from "../r2.js";

// Egy fejezet képeinek törlése a Cloudflare gyorsítótárából. Fejezet-
// törléskor kell: ha ugyanazokkal a fájlnevekkel töltik fel újra (pl.
// manhwa_0001.jpg), a CF különben napokig a régi képet adná ki.
// Az olvasó a ?r2=1-es URL-t kéri, a CF ezt külön tárolja az alap URL-től.
export async function purgeChapterImages({ libraryName, libraryPath, mangaSlug, mangaFolder, chapterFolder, files }) {
  const CF_ZONE = process.env.CF_ZONE_ID;
  const CF_TOKEN = process.env.CF_API_TOKEN;
  const CF_DOMAIN = process.env.CF_DOMAIN || "http://localhost:3000";
  const R2_PUBLIC = process.env.R2_PUBLIC_URL;
  if (!CF_ZONE || !CF_TOKEN) return { skipped: true, reason: "Nincs CF konfig" };
  if (!files?.length) return { skipped: true, reason: "Üres képlista" };

  const urls = [];
  for (const f of files) {
    const base = `${CF_DOMAIN}/api/image/${encodeURIComponent(libraryName)}/${encodeURIComponent(mangaSlug)}/${encodeURIComponent(chapterFolder)}/${encodeURIComponent(f)}`;
    urls.push(base, `${base}?r2=1`);
    if (R2_PUBLIC) {
      try {
        urls.push(`${R2_PUBLIC}/${localPathToR2Key(`${libraryPath}/${mangaFolder}/${chapterFolder}/${f}`.replace(/\/+/g, "/"))}`);
      } catch {}
    }
  }

  let purged = 0;
  for (let i = 0; i < urls.length; i += 30) {
    const batch = urls.slice(i, i + 30);
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files: batch }),
      });
      const result = await r.json();
      if (result.success) purged += batch.length;
      else console.warn("[CF purge] batch hiba:", result.errors);
    } catch (err) {
      console.warn("[CF purge] hiba:", err.message);
    }
  }
  return { total: urls.length, purged };
}
