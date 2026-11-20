/* ── Médiás posztolás főkapcsoló (2026-11-20) ──
   .env: SOCIAL_MEDIA_DISABLED=1 → semmi nem megy ki Facebookra / Instagramra / TikTokra,
   előnézet sem készül, a #media visszajelzést sem dolgozzuk fel. Visszakapcsolás:
   a sor törlése (vagy =0) + szerver-restart. */
export function socialDisabled() {
  return /^(1|true|yes|igen)$/i.test(String(process.env.SOCIAL_MEDIA_DISABLED || "").trim());
}
export function assertSocialEnabled(what = "Médiás posztolás") {
  if (socialDisabled()) throw new Error(`${what} leállítva (SOCIAL_MEDIA_DISABLED)`);
}
