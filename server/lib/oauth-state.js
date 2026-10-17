import { randomBytes, timingSafeEqual } from "crypto";

/* ── OAuth "state" paraméter (login-CSRF ellen) ───────────────
   Nélküle egy támadó a SAJÁT authorization code-jával ellátott callback-
   linket küldhetett az áldozatnak, és az áldozat fiókjához a támadó
   AniList/Patreon fiókja kapcsolódott (AniListnél így a támadó látta az
   áldozat olvasási adatait). A state a sessionben tárolódik, és a
   callbackben csak egyszer használható fel. ── */

export function issueOAuthState(req, name) {
  const state = randomBytes(16).toString("hex");
  req.session[`oauthState_${name}`] = state;
  return state;
}

export function consumeOAuthState(req, name, received) {
  const key = `oauthState_${name}`;
  const expected = req.session?.[key];
  if (req.session) delete req.session[key];
  if (typeof expected !== "string" || typeof received !== "string") return false;
  const a = Buffer.from(expected), b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
