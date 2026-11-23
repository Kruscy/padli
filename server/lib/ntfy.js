/* ── Riasztás a user otthoni ntfy-témájára (2026-11-23) ──
   NTFY_URL=http://192.168.0.6:2586/home-alerts (.env). JSON-közzététel a
   szerver gyökerére, mert a fejlécekben (Title) nem lehet ékezet.
   Soha nem dob hibát: a riasztás ne akassza meg a hívót.
   priority: 1–5 (5 = sürgős, a telefon hangosan jelez). */
export async function notifyNtfy(message, { title = "PadlizsanFanSub", priority = 4, tags = ["warning"] } = {}) {
  const url = process.env.NTFY_URL;
  if (!url) return false;
  try {
    const u = new URL(url);
    const topic = u.pathname.replace(/^\/+|\/+$/g, "");
    const res = await fetch(`${u.origin}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, title, message: String(message).replace(/\*\*|`/g, "").slice(0, 3500), priority, tags }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error("[ntfy] küldési hiba:", err.message);
    return false;
  }
}
