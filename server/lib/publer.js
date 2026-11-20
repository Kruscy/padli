/* ── Publer API → TikTok (2026-11-15) ──
   Publer Business csomag; .env: PUBLER_API_KEY, PUBLER_WORKSPACE_ID, PUBLER_TIKTOK_ACCOUNT_ID.
   Folyamat: képek feltöltése (multipart, /media) → poszt azonnali közzététele
   (/posts/schedule/publish) → job_status lekérdezése, amíg kész. */
import { assertSocialEnabled, socialDisabled } from "./social-switch.js";
const API = "https://app.publer.com/api/v1";

export function publerConfigured() {
  return !!(process.env.PUBLER_API_KEY && process.env.PUBLER_WORKSPACE_ID && process.env.PUBLER_TIKTOK_ACCOUNT_ID);
}

function headers(json = true) {
  return {
    Authorization: `Bearer-API ${process.env.PUBLER_API_KEY}`,
    "Publer-Workspace-Id": process.env.PUBLER_WORKSPACE_ID,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function call(method, pathPart, body, json = true) {
  const r = await fetch(`${API}${pathPart}`, {
    method, headers: headers(json), body: body && json ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(120000),
  });
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch { d = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`Publer ${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

export async function uploadMedia(image, name) {
  const fd = new FormData();
  fd.append("file", new Blob([image], { type: "image/jpeg" }), name);
  fd.append("direct_upload", "true");
  fd.append("in_library", "false");
  const d = await call("POST", "/media", fd, false);
  if (!d.id) throw new Error(`Publer feltöltés: nincs média-azonosító (${JSON.stringify(d).slice(0, 200)})`);
  return { id: d.id, path: d.path, thumbnail: d.thumbnail };
}

export async function waitJob(jobId, maxSec = 300) {
  for (let t = 0; t < maxSec; t += 5) {
    const d = await call("GET", `/job_status/${jobId}`);
    const st = d.data?.status || d.status;
    const result = d.data?.result || d.result || d;
    if (st === "complete" || st === "completed") {
      const payload = result?.payload;
      const fails = Array.isArray(payload) ? payload.filter(x => x.status === "failed" || x.type === "error") : Object.values(payload?.failures || {});
      if (fails.length) throw new Error(`Publer: ${fails.map(f => f.failure?.message || JSON.stringify(f)).join("; ").slice(0, 300)}`);
      return result || d;
    }
    if (st === "failed") throw new Error(`Publer job hiba: ${JSON.stringify(d).slice(0, 300)}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("Publer: a feladat nem fejeződött be időben");
}

/* TikTok lapozós fotó-poszt, automatikus zenével. privacy: PUBLIC_TO_EVERYONE | SELF_ONLY */
export async function postTikTokCarousel(images, caption, { privacy = "PUBLIC_TO_EVERYONE", prefix = `tt-${Date.now()}`, title = "" } = {}) {
  assertSocialEnabled("TikTok-posztolás");
  if (!publerConfigured()) throw new Error("Publer nincs beállítva");
  const media = [];
  for (let i = 0; i < images.length; i++) media.push(await uploadMedia(images[i], `${prefix}-${i + 1}.jpg`));
  const body = {
    bulk: {
      state: "scheduled",
      posts: [{
        networks: {
          tiktok: {
            // A Publer-dokumentáció példája szerint: type "photo", media[] = { id, path } (a „carousel”
            // típusra és path nélkül a Publer belső hibát adott: undefined method 'first' for nil)
            type: "photo",
            title: title.slice(0, 90),
            text: caption.slice(0, 2200),
            media: media.map(m => ({ id: m.id, path: m.path })),
            details: { privacy, auto_add_music: true, comment: true, promotional: false, paid: false, reminder: false },
          },
        },
        accounts: [{ id: process.env.PUBLER_TIKTOK_ACCOUNT_ID }],
      }],
    },
  };
  const d = await call("POST", "/posts/schedule/publish", body);
  const jobId = d.data?.job_id || d.job_id;
  if (!jobId) throw new Error(`Publer: nincs job_id (${JSON.stringify(d).slice(0, 200)})`);
  const result = await waitJob(jobId);
  return { jobId, result };
}

/* TikTok-szöveg az Instagram-szövegből */
export function toTikTokCaption(caption) {
  return String(caption || "")
    .replace(/#manhwa #manga #webtoon #magyarmanga #mangamagyarul #PadlizsanFanSub\s*$/, "#manhwa #manga #webtoon #manhwaajánló #magyartiktok #animemagyarul #PadlizsanFanSub");
}
