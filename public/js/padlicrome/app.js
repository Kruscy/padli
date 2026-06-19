/* padlicrome/app.js - Inicializálás, állapot, API */

const API = "/api/padlicrome";

export const state = {
  user: null,
  role: "user",
  points: 0,
  subscriber: false,
  project: null,
  translating: false,
  stopRequested: false,
  forceStop: false,
};

/* ── API WRAPPER ─────────────────────────────────────────── */
export async function api(method, path, body, isFormData = false) {
  const opts = { method, credentials: "include" };
  if (body && !isFormData) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  } else if (body && isFormData) {
    opts.body = body;
  }
  const res = await fetch(API + path, opts);
  if (res.status === 204) return {};
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/* ── USER INFO ───────────────────────────────────────────── */
export async function loadMe() {
  try {
    const data = await api("GET", "/me");
    state.user = data.username;
    state.points = data.points;
    state.subscriber = data.subscriber;
    state.role = data.role || "user";
    updatePointsDisplay();
  } catch {
    // Nem bejelentkezett - az auth-check.js kezeli
  }
}

export function updatePointsDisplay() {
  const el = document.getElementById("pcPoints");
  if (el) el.textContent = state.points;
  const sub = document.getElementById("pcSubscriberBadge");
  if (sub) sub.style.display = state.subscriber ? "inline-flex" : "none";
}

/* ── STATUS ÜZENETEK ─────────────────────────────────────── */
export function showStatus(msg, type = "info", container = "pcStatus") {
  const el = document.getElementById(container);
  if (!el) return;
  const icons = { info: "ℹ️", success: "✅", error: "❌", warn: "⚠️" };
  el.className = `pc-status ${type}`;
  el.innerHTML = `<span>${icons[type] || "ℹ️"}</span> ${msg}`;
  el.style.display = "flex";
}

export function hideStatus(container = "pcStatus") {
  const el = document.getElementById(container);
  if (el) el.style.display = "none";
}

/* ── PROJEKT INDÍTÁS URL-BŐL ─────────────────────────────── */
export async function startProjectFromUrl(url) {
  if (!url) return;
  showStatus("⏳ Kép URL-ek kinyerése...", "info");
  try {
    const data = await api("POST", "/project/start", { url });
    showStatus(
      `✅ ${data.downloading} kép letöltése folyamatban (${data.found} találat)${data.tooMany ? " - csak az első 30 töltődik le" : ""}`,
      data.tooMany ? "warn" : "success"
    );
    return data;
  } catch (err) {
    showStatus(`❌ ${err.message}`, "error");
    throw err;
  }
}

/* ── INIT ────────────────────────────────────────────────── */
export async function init() {
  await loadMe();
}
