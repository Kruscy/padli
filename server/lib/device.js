/* Készüléktípus a User-Agent alapján (2026-11-15): mit ajánljunk letöltésre.
   android → Android-app; ios → egyik sem (se APK, se Windows-telepítő); desktop → Padlizsan Studio (Windows). */
export function deviceOf(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Mobile|Opera Mini|IEMobile/i.test(ua)) return "mobile";
  return "desktop";
}
/* Hír (announcements.platform) megjelenhet-e ezen a készüléken: all | desktop | android | mobile */
export function platformMatches(platform, device) {
  if (!platform || platform === "all") return true;
  if (platform === "desktop") return device === "desktop";
  if (platform === "android") return device === "android";
  if (platform === "mobile") return device !== "desktop";
  return true;
}
