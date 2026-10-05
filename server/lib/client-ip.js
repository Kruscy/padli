import net from "net";

/* ── Valódi kliens-IP ─────────────────────────────────────────
   Minden kérés a fordított proxyn keresztül érkezik (192.168.0.20),
   előtte Cloudflare áll. A req.ip ("trust proxy" = 1) ezért csak az
   X-Forwarded-For legutolsó elemét adja, ami a proxy/Cloudflare címe
   lehet — így a kérésszám-korlátok rossz kulcsot kaptak.
   A Cloudflare a valódi címet a CF-Connecting-IP fejlécben küldi. Ezt
   CSAK akkor fogadjuk el, ha a kérés a megbízható proxytól jött
   (különben bárki hamisíthatná egy közvetlen kéréssel). ── */
const TRUSTED_PROXIES = new Set(
  (process.env.TRUSTED_PROXY_IPS || "192.168.0.20,127.0.0.1,::1")
    .split(",").map(s => s.trim()).filter(Boolean)
);

const strip = ip => (ip || "").replace(/^::ffff:/, "");

export function getClientIp(req) {
  if (req._clientIp) return req._clientIp;
  const peer = strip(req.socket?.remoteAddress);
  let ip = null;
  if (TRUSTED_PROXIES.has(peer)) {
    const cf = String(req.headers["cf-connecting-ip"] || "").trim();
    if (net.isIP(cf)) ip = cf;
  }
  ip = ip || strip(req.ip) || peer || "unknown";
  req._clientIp = ip;
  return ip;
}
