// Integrációs tesztekhez: az alkalmazás elindítása véletlen porton egy
// (külön, tesztcélú!) PostgreSQL-adatbázison. A PG* változókat a hívó
// adja meg (CI: GitHub Actions postgres service); ha hiányoznak, a
// tesztek kihagyódnak — éles adatbázisra soha ne mutasson.

import os from "os";
import path from "path";

export const hasDb = !!(process.env.PGDATABASE && process.env.PGHOST);

const defaults = {
  NODE_ENV: "test",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  MANGA_JWT_SECRET: "test-jwt-secret",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
  WS_PORT: "0",
  R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test",
  R2_BUCKET_NAME: "test", R2_PUBLIC_URL: "http://127.0.0.1:9",
  SITE_URL: "http://localhost", BASE_URL: "http://localhost",
  PADLICROME_DIR: path.join(os.tmpdir(), "padli-test-padlicrome"),
  UPDATE_CHECK: "false", // ne hívja a GitHubot
};
for (const [k, v] of Object.entries(defaults)) if (process.env[k] === undefined) process.env[k] = v;

export async function startApp() {
  const { default: app } = await import("../../server/app.js");
  const { pool } = await import("../../server/db.js");
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    pool,
    async close() {
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
      await pool.end().catch(() => {});
    },
  };
}

// Egyszerű, sütit megőrző kliens (egy "böngésző")
export function client(baseUrl) {
  let cookie = "";
  async function request(path, { method = "GET", json, body, headers = {} } = {}) {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
    const res = await fetch(baseUrl + path, { method, headers: h, body, redirect: "manual" });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) if (c.startsWith("padlizsan.sid=")) cookie = c.split(";")[0];
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, headers: res.headers, data };
  }
  return {
    request,
    login: (login, password) => request("/api/auth/login", { method: "POST", json: { login, password } }),
    get cookie() { return cookie; },
  };
}
