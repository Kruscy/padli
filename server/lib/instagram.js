/* ── Instagram-posztolás (2026-11-15) ──
   Az Instagram API a képet csak nyilvános URL-ről tölti le, ezért előbb az R2-re
   (R2_PUBLIC_URL / social/…) töltjük fel, utána: média-konténer → várakozás → közzététel.
   Kell: FB_PAGE_TOKEN (instagram_basic + instagram_content_publish joggal), IG_USER_ID. */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET } from "../r2.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export function instagramConfigured() {
  return !!(process.env.IG_USER_ID && process.env.FB_PAGE_TOKEN && process.env.R2_PUBLIC_URL && BUCKET);
}

/* A Facebook-szövegből Instagram-szöveg: a link nem kattintható, helyette „link a bióban”. */
export function toInstagramCaption(fbCaption) {
  return String(fbCaption || "")
    .replace(/👉[^\n]*https?:\/\/\S+/g, "🔗 Olvasd nálunk magyarul — link a bióban: padlizsanfansub.hu")
    .replace(/https?:\/\/\S+/g, "padlizsanfansub.hu")
    .replace(/(#PadlizsanFanSub)\s*$/, "$1 #manhwaajánló #webtoon #magyarmanga #mangamagyarul #olvasnivaló")
    .slice(0, 2200);
}

async function graph(pathPart, params) {
  const body = new URLSearchParams({ ...params, access_token: process.env.FB_PAGE_TOKEN });
  const r = await fetch(`${GRAPH}/${pathPart}`, { method: "POST", body, signal: AbortSignal.timeout(60000) });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(`Instagram: ${d.error?.message || r.status}`);
  return d;
}

/* A konténer feldolgozása pár másodperc */
async function waitContainer(container) {
  for (let i = 0; i < 30; i++) {
    const s = await (await fetch(`${GRAPH}/${container}?fields=status_code,status&access_token=${process.env.FB_PAGE_TOKEN}`)).json();
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram feldolgozás: ${s.status || s.status_code}`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

export async function uploadPublicImage(image, name) {
  const key = `social/${name.replace(/[^a-z0-9._-]/gi, "-")}`;
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: image, ContentType: "image/jpeg",
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
}

/* Kép + szöveg az Instagramra. Visszaad: { id, permalink }. */
export async function postPhotoToInstagram(image, caption, name = `ig-${Date.now()}.jpg`) {
  if (!instagramConfigured()) throw new Error("Instagram nincs beállítva (IG_USER_ID / FB_PAGE_TOKEN / R2)");
  const ig = process.env.IG_USER_ID;
  const imageUrl = await uploadPublicImage(image, name);
  const { id: container } = await graph(`${ig}/media`, { image_url: imageUrl, caption });
  await waitContainer(container);
  const { id } = await graph(`${ig}/media_publish`, { creation_id: container });
  let permalink = null;
  try {
    permalink = (await (await fetch(`${GRAPH}/${id}?fields=permalink&access_token=${process.env.FB_PAGE_TOKEN}`)).json()).permalink || null;
  } catch {}
  return { id, permalink };
}

/* Lapozós (carousel) poszt: 2–10 kép. */
export async function postCarouselToInstagram(images, caption, prefix = `ig-${Date.now()}`) {
  if (!instagramConfigured()) throw new Error("Instagram nincs beállítva (IG_USER_ID / FB_PAGE_TOKEN / R2)");
  const ig = process.env.IG_USER_ID;
  const children = [];
  for (let i = 0; i < images.length; i++) {
    const url = await uploadPublicImage(images[i], `${prefix}-${i + 1}.jpg`);
    const { id } = await graph(`${ig}/media`, { image_url: url, is_carousel_item: "true" });
    children.push(id);
  }
  const { id: container } = await graph(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
  await waitContainer(container);
  const { id } = await graph(`${ig}/media_publish`, { creation_id: container });
  let permalink = null;
  try {
    permalink = (await (await fetch(`${GRAPH}/${id}?fields=permalink&access_token=${process.env.FB_PAGE_TOKEN}`)).json()).permalink || null;
  } catch {}
  return { id, permalink };
}
