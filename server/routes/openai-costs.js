/* ── OpenAI-költségek kulcsonként (admin → GPT-API fül, 2026-11-08) ──
   GET /api/admin/openai-costs?month=YYYY-MM — csak a tulajdonos (Ascyra).
   Forrás: az OpenAI Admin API (OPENAI_ADMIN_KEY, .env):
   • /organization/costs — a VALÓDI számlatételek projekt + tétel szerint
     („gpt-5.6-terra, output” stb.), ezek összege egyezik a számlával;
   • /organization/usage/completions — kulcsonkénti tokenek modellenként.
   A számlatételeket a kulcsok között a megfelelő tokenfajta arányában
   osztjuk szét (bemenet / gyorsítótárazott bemenet / kimenet); így a
   kulcsonkénti forint arányos, az összesen pedig pontosan a számla.
   Amit nem lehet kulcshoz kötni (pl. ha nincs hozzá használati adat),
   „projektszintű” sorba kerül. ── */
import express from "express";
import { SCAN_OWNER_USER_ID } from "../lib/scan-runner.js";
import { pool } from "../db.js";

const router = express.Router();
const API = "https://api.openai.com/v1";
const USD_HUF = Number(process.env.PC_REPORT_USD_HUF) || 326;
// Csak ezek a projektek (név szerint) számítanak (2026-11-08, a user kérése:
// csak a „Manga fordítás”, a többi — Kamrafy, Metin — nem tartozik ide)
// Havi költési keret (az OpenAI-szervezeté), a csíkhoz: 80%-tól narancs, 95%-tól piros
const SPEND_LIMIT_USD = Number(process.env.OPENAI_SPEND_LIMIT_USD) || 200;
const REPORT_PROJECTS = (process.env.OPENAI_REPORT_PROJECTS || "Manga fordítás").split(",").map(x => x.trim()).filter(Boolean);

router.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin" || req.session.user.id !== SCAN_OWNER_USER_ID) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

async function oa(path) {
  const r = await fetch(API + path, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY}` },
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${j.error?.message || j.error || "ismeretlen hiba"}`);
  return j;
}

// Lapozott bucket-lista (napi bontás, egy hónap ≤ 31 bucket)
async function buckets(path) {
  const out = [];
  let page = null;
  for (let i = 0; i < 20; i++) {
    const j = await oa(path + (page ? `&page=${encodeURIComponent(page)}` : ""));
    out.push(...(j.data || []));
    if (!j.has_more || !j.next_page) break;
    page = j.next_page;
  }
  return out;
}

// „gpt-5.6-terra, output” → { model: "gpt-5.6-terra", kind: "output" }
function parseLineItem(li) {
  const s = String(li || "");
  const i = s.lastIndexOf(", ");
  return i < 0 ? { model: s, kind: "" } : { model: s.slice(0, i), kind: s.slice(i + 2) };
}
// A számlatétel modellneve dátumos lehet („gpt-5.4-2026-03-05”, „gpt-image-2-2026-04-21 image”)
const sameModel = (billModel, usageModel) => {
  const a = billModel.replace(/ (image|text|audio)$/, ""), b = String(usageModel || "");
  return a === b || a.startsWith(b + "-") || b.startsWith(a + "-");
};
// melyik tokenfajta arányában osszuk szét a tételt
function weightOf(kind, u) {
  const cached = u.cached || 0;
  if (/cached input/.test(kind)) return cached;
  if (/cache write/.test(kind)) return u.input;
  if (/input/.test(kind)) return Math.max(0, u.input - cached);
  if (/output/.test(kind)) return u.output;
  return u.requests;
}

const cache = new Map(); // month → { at, data }

async function build(month) {
  const [y, m] = month.split("-").map(Number);
  // az OpenAI csak az elmúlt 1 év adatait adja (régebbire 400-at) → levágjuk
  const earliest = Math.floor(Date.now() / 1000) - 364 * 86400;
  if (Math.floor(Date.UTC(y, m, 1) / 1000) <= earliest) {
    const e = new Error("Az OpenAI csak az elmúlt egy év költségadatait adja ki.");
    e.tooOld = true;
    throw e;
  }
  const start = Math.max(Math.floor(Date.UTC(y, m - 1, 1) / 1000), earliest);
  const endFull = Math.floor(Date.UTC(y, m, 1) / 1000);
  const end = Math.min(endFull, Math.floor(Date.now() / 1000));
  if (end <= start) return { month, rate: USD_HUF, projectsShown: REPORT_PROJECTS, orgTotalUsd: 0, spendLimitUsd: SPEND_LIMIT_USD, limitPct: 0, totalHuf: 0, persons: [], keys: [], models: [], days: [], projects: [] };
  const q = `start_time=${start}&end_time=${end}&bucket_width=1d&limit=31`;

  const [costB, useB] = await Promise.all([
    buckets(`/organization/costs?${q}&group_by=project_id&group_by=line_item`),
    buckets(`/organization/usage/completions?${q}&group_by=project_id&group_by=api_key_id&group_by=model`),
  ]);

  // használat: projekt → kulcs → modell
  // projektnevek → csak a kért projektek azonosítói maradnak
  const allProjects = [...new Set([...useB, ...costB].flatMap(b => (b.results || []).map(r => r.project_id)).filter(Boolean))];
  const projName = new Map();
  await Promise.all(allProjects.map(async p => {
    try { projName.set(p, (await oa(`/organization/projects/${p}`)).name); } catch { projName.set(p, p); }
  }));
  const allowed = new Set(allProjects.filter(p => REPORT_PROJECTS.includes(projName.get(p))));
  const orgTotalUsd = costB.reduce((a, b) => a + (b.results || []).reduce((x, r) => x + Number(r.amount?.value || 0), 0), 0);
  for (const b of [...useB, ...costB]) b.results = (b.results || []).filter(r => allowed.has(r.project_id));

  const usage = []; // { project, key, model, input, cached, output, requests }
  const uIdx = new Map();
  for (const b of useB) for (const r of b.results || []) {
    const k = `${r.project_id}|${r.api_key_id}|${r.model}`;
    let u = uIdx.get(k);
    if (!u) { u = { project: r.project_id, key: r.api_key_id, model: r.model, input: 0, cached: 0, output: 0, requests: 0 }; uIdx.set(k, u); usage.push(u); }
    u.input += r.input_tokens || 0;
    u.cached += r.input_cached_tokens || 0;
    u.output += r.output_tokens || 0;
    u.requests += r.num_model_requests || 0;
  }

  // számlatételek szétosztása
  const keyCost = new Map();   // `${project}|${key}` → { usd, models: Map(model → usd) }
  const dayUsd = new Map();
  const modelUsd = new Map();
  const projUsd = new Map();
  const addKey = (project, key, model, usd, day) => {
    const id = `${project}|${key}`;
    const e = keyCost.get(id) || { usd: 0, models: new Map(), days: new Map() };
    e.usd += usd;
    e.models.set(model, (e.models.get(model) || 0) + usd);
    e.days.set(day, (e.days.get(day) || 0) + usd);
    keyCost.set(id, e);
  };
  for (const b of costB) {
    const day = new Date(b.start_time * 1000).toISOString().slice(0, 10);
    for (const r of b.results || []) {
      const usd = Number(r.amount?.value || 0);
      if (!usd) continue;
      dayUsd.set(day, (dayUsd.get(day) || 0) + usd);
      projUsd.set(r.project_id || "?", (projUsd.get(r.project_id || "?") || 0) + usd);
      const { model, kind } = parseLineItem(r.line_item);
      const base = model.replace(/ (image|text|audio)$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
      modelUsd.set(base, (modelUsd.get(base) || 0) + usd);
      const cands = usage.filter(u => u.project === r.project_id && sameModel(model, u.model));
      const ws = cands.map(u => weightOf(kind, u));
      const sum = ws.reduce((a, b) => a + b, 0);
      if (!sum) { addKey(r.project_id || "?", "_project", base, usd, day); continue; }
      cands.forEach((u, i) => ws[i] && addKey(u.project, u.key, base, usd * ws[i] / sum, day));
    }
  }

  // kulcsok és projektek adatai
  const projects = [...allowed];
  const keyInfo = new Map();
  await Promise.all(projects.map(async p => {
    try {
      const list = await oa(`/organization/projects/${p}/api_keys?limit=100`);
      for (const k of list.data || []) keyInfo.set(k.id, {
        name: k.name || "(név nélkül)",
        last4: String(k.redacted_value || "").slice(-4),
        owner: k.owner?.user?.name || k.owner?.user?.email || k.owner?.service_account?.name || k.owner?.type || "",
        ownerEmail: k.owner?.user?.email || "",
        lastUsed: k.last_used_at ? new Date(k.last_used_at * 1000).toISOString() : null,
      });
    } catch { /* nincs joga a kulcslistához: csak azonosító lesz */ }
  }));

  // Kézi címkék (openai_key_labels): a projektlistában nem szereplő kulcsokhoz
  // (szolgáltatásfiók, törölt kulcs) név, és hogy kinek a kulcsa (összevonáshoz)
  const labels = new Map();
  try {
    const { rows } = await pool.query("SELECT key_id, name, owner_key_id FROM openai_key_labels");
    for (const r of rows) labels.set(r.key_id, r);
  } catch { /* tábla nélkül is működjön */ }
  // személy = a kulcs NEVE szám és zárójeles rész nélkül („Ascyra2” → „Ascyra”).
  // NEM a létrehozó e-mailje: a tulajdonos hozta létre mások kulcsát is
  // (pl. Sempai), így az e-mail szerint összemosódnának. Kézi címkénél az
  // owner_key_id kulcsának a neve dönt.
  const baseName = n => String(n || "").replace(/\s*\(.*\)$/, "").replace(/\d+$/, "").trim();
  const personOf = (keyId, info) => {
    const lab = labels.get(keyId);
    if (lab?.owner_key_id && keyInfo.get(lab.owner_key_id)) return baseName(keyInfo.get(lab.owner_key_id).name).toLowerCase();
    // név nélküli / ismeretlen kulcs: mindegyik külön személy (különben egybemosódnának)
    if (!keyInfo.get(keyId) && !lab) return keyId;
    return baseName(info.name).toLowerCase() || keyId;
  };
  const personName = new Map(); // személy-azonosító → megjelenített név (a legelső ismert kulcs neve)

  const keys = [...keyCost].map(([id, e]) => {
    const [project, key] = id.split("|");
    const us = usage.filter(u => u.project === project && u.key === key);
    const requests = us.reduce((a, u) => a + u.requests, 0);
    const input = us.reduce((a, u) => a + u.input, 0), output = us.reduce((a, u) => a + u.output, 0);
    const info = key === "_project" ? { name: "Projektszintű (kulcshoz nem köthető)", last4: "", owner: "" }
      : keyInfo.get(key)
        || (labels.get(key) && { name: labels.get(key).name, last4: "", owner: keyInfo.get(labels.get(key).owner_key_id)?.owner || "", note: "kézi címke" })
        || { name: `Ismeretlen / törölt kulcs (${key})`, last4: "", owner: "" };
    const person = key === "_project" ? "_project" : personOf(key, info);
    if (!personName.has(person) || keyInfo.get(key)) personName.set(person, key === "_project" || person === key ? info.name : baseName(keyInfo.get(key)?.name || info.name));
    const huf = e.usd * USD_HUF;
    return {
      id: key, person, project: projName.get(project) || project, ...info,
      requests, input, output,
      huf: +huf.toFixed(0),
      hufPerRequest: requests ? +(huf / requests).toFixed(2) : null,
      hufPer1kTokens: input + output ? +(huf / ((input + output) / 1000)).toFixed(2) : null,
      models: [...e.models].map(([model, usd]) => ({ model, huf: +(usd * USD_HUF).toFixed(0) })).sort((a, b) => b.huf - a.huf),
      days: [...e.days].sort().map(([day, usd]) => ({ day, huf: +(usd * USD_HUF).toFixed(0) })),
    };
  }).filter(k => k.huf > 0 || k.requests > 0).sort((a, b) => b.huf - a.huf);

  // modellenként: mennyibe kerül egy kérés és 1000 token (ár-érték)
  const models = [...modelUsd].map(([model, usd]) => {
    const us = usage.filter(u => sameModel(model, u.model));
    const requests = us.reduce((a, u) => a + u.requests, 0);
    const tokens = us.reduce((a, u) => a + u.input + u.output, 0);
    const huf = usd * USD_HUF;
    return { model, huf: +huf.toFixed(0), requests, hufPerRequest: requests ? +(huf / requests).toFixed(2) : null, hufPer1kTokens: tokens ? +(huf / (tokens / 1000)).toFixed(3) : null };
  }).filter(x => x.huf > 0).sort((a, b) => b.huf - a.huf);

  // személyenként (egy ember több kulcsa egy sorban)
  const people = new Map();
  for (const k of keys) {
    const p = people.get(k.person) || { id: k.person, keyIds: [], name: personName.get(k.person) || k.name, huf: 0, requests: 0, keys: [] };
    p.keyIds.push(k.id);
    p.huf += k.huf; p.requests += k.requests; p.keys.push(k.name + (k.last4 ? ` …${k.last4}` : ""));
    people.set(k.person, p);
  }
  const persons = [...people.values()].map(p => ({ ...p, hufPerRequest: p.requests ? +(p.huf / p.requests).toFixed(2) : null }))
    .sort((a, b) => b.huf - a.huf);

  const totalUsd = [...dayUsd.values()].reduce((a, b) => a + b, 0);
  return {
    month, rate: USD_HUF, projectsShown: REPORT_PROJECTS,
    orgTotalUsd: +orgTotalUsd.toFixed(2), spendLimitUsd: SPEND_LIMIT_USD,
    limitPct: +(100 * orgTotalUsd / SPEND_LIMIT_USD).toFixed(1),
    totalHuf: +(totalUsd * USD_HUF).toFixed(0), totalUsd: +totalUsd.toFixed(2),
    projects: [...projUsd].map(([p, usd]) => ({ name: projName.get(p) || p, huf: +(usd * USD_HUF).toFixed(0) })).sort((a, b) => b.huf - a.huf),
    days: [...dayUsd].sort().map(([day, usd]) => ({ day, huf: +(usd * USD_HUF).toFixed(0) })),
    persons, keys, models,
  };
}

const curMonth = () => { const n = new Date(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`; };
const parseMonth = q => /^\d{4}-(0[1-9]|1[0-2])$/.test(q || "") ? q : curMonth();

// Gyorsítótárazott havi kimutatás (az admin fül és a profilok közösen használják)
const inflight = new Map();
async function getReport(month, refresh = false) {
  const ttl = month === curMonth() ? 10 * 60_000 : 24 * 3600_000;
  const hit = cache.get(month);
  if (hit && Date.now() - hit.at < ttl && !refresh) return { ...hit.data, cachedAt: new Date(hit.at).toISOString() };
  // egyszerre több kérés ne indítson párhuzamos OpenAI-lekérdezést ugyanarra a hónapra
  if (!inflight.has(month)) inflight.set(month, build(month).finally(() => inflight.delete(month)));
  const data = await inflight.get(month);
  cache.set(month, { at: Date.now(), data });
  return { ...data, cachedAt: new Date().toISOString() };
}

// Az elérhető hónapok (az elmúlt 1 év), a legrégebbitől
function availableMonths() {
  const out = [];
  const first = new Date(Date.now() - 364 * 86400_000);
  let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1;
  const cur = curMonth();
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= cur) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Személyenkénti összesítés: a választott hónap és az elmúlt 12 hónap együtt.
// A személyhez az oldal felhasználóneve tartozik, ha a kulcsa hozzá van rendelve.
async function totals(month) {
  const months = availableMonths();
  const reports = [];
  for (let i = 0; i < months.length; i += 3) {   // egyszerre legfeljebb 3 hónap az OpenAI felé
    reports.push(...await Promise.all(months.slice(i, i + 3).map(m => getReport(m).catch(() => null))));
  }
  let owners = new Map();
  try {
    const { rows } = await pool.query("SELECT k.key_id, u.username FROM openai_key_users k JOIN users u ON u.id = k.user_id");
    owners = new Map(rows.map(r => [r.key_id, r.username]));
  } catch { /* hozzárendelés nélkül a kulcsnév marad */ }
  const nameOf = p => p.keyIds.map(id => owners.get(id)).find(Boolean)
    || (/^Ismeretlen/.test(p.name) ? "Törölt / ismeretlen kulcsok" : p.name);
  const all = new Map();
  let monthRows = [];
  reports.forEach((d, i) => {
    if (!d) return;
    for (const p of d.persons || []) {
      if (p.id === "_project") continue;
      const name = nameOf(p);
      const e = all.get(name) || { name, huf: 0, requests: 0, monthHuf: 0, monthRequests: 0 };
      e.huf += p.huf; e.requests += p.requests;
      if (months[i] === month) { e.monthHuf += p.huf; e.monthRequests += p.requests; }
      all.set(name, e);
    }
    if (months[i] === month) monthRows = d.persons;
  });
  const rows = [...all.values()].filter(r => r.huf > 0).sort((a, b) => b.monthHuf - a.monthHuf || b.huf - a.huf);
  return {
    month, since: months[0],
    monthTotal: rows.reduce((a, r) => a + r.monthHuf, 0),
    allTotal: rows.reduce((a, r) => a + r.huf, 0),
    rows,
    unassignedMonth: monthRows.filter(p => p.id === "_project").reduce((a, p) => a + p.huf, 0),
  };
}

router.get("/totals", async (req, res) => {
  if (!process.env.OPENAI_ADMIN_KEY) return res.status(503).json({ error: "Nincs beállítva OPENAI_ADMIN_KEY a szerveren." });
  try { res.json(await totals(parseMonth(req.query.month))); }
  catch (err) { console.error("[openai-costs] totals:", err.message); res.status(502).json({ error: err.message }); }
});

router.get("/", async (req, res) => {
  if (!process.env.OPENAI_ADMIN_KEY) return res.status(503).json({ error: "Nincs beállítva OPENAI_ADMIN_KEY a szerveren." });
  const month = parseMonth(req.query.month);
  if (month > curMonth()) return res.status(400).json({ error: "Jövőbeli hónap" });
  try {
    res.json(await getReport(month, req.query.refresh === "1"));
  } catch (err) {
    if (!err.tooOld) console.error("[openai-costs]", err.message);
    res.status(err.tooOld ? 400 : 502).json({ error: err.message });
  }
});

/* ── Felhasználói nézet: GET /api/user/gpt-usage?month=YYYY-MM ──────
   A feltöltő a profilján csak a SAJÁT kulcsainak (openai_key_users)
   költését látja. Akinek nincs hozzárendelt kulcsa: { hasKeys: false }. */
export const userRouter = express.Router();
userRouter.get("/totals", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Login required" });
  const { rows } = await pool.query("SELECT 1 FROM openai_key_users WHERE user_id = $1 LIMIT 1", [req.session.user.id]).catch(() => ({ rows: [] }));
  if (!rows.length) return res.status(403).json({ error: "Forbidden" });   // csak kulccsal rendelkező feltöltő
  try {
    const t = await totals(parseMonth(req.query.month));
    // CSAK a saját sor: a többi feltöltő költése nem látszik a profilon
    const mine = t.rows.find(r => r.name === req.session.user.username);
    res.json({ month: t.month, since: t.since, monthHuf: mine?.monthHuf || 0, huf: mine?.huf || 0, requests: mine?.requests || 0 });
  } catch (err) {
    res.status(502).json({ error: "Az összesítő most nem érhető el." });
  }
});

userRouter.get("/", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Login required" });
  let ids;
  try {
    const { rows } = await pool.query("SELECT key_id FROM openai_key_users WHERE user_id = $1", [req.session.user.id]);
    ids = new Set(rows.map(r => r.key_id));
  } catch { ids = new Set(); }
  if (!ids.size) return res.json({ hasKeys: false });
  if (!process.env.OPENAI_ADMIN_KEY) return res.status(503).json({ error: "A költségadatok most nem érhetők el." });
  const month = parseMonth(req.query.month);
  if (month > curMonth()) return res.status(400).json({ error: "Jövőbeli hónap" });
  try {
    const d = await getReport(month);
    const keys = d.keys.filter(k => ids.has(k.id)).map(k => ({
      name: k.name, last4: k.last4, requests: k.requests, huf: k.huf,
      hufPerRequest: k.hufPerRequest, models: k.models, days: k.days, lastUsed: k.lastUsed || null,
    }));
    const dayMap = new Map();
    for (const k of keys) for (const x of k.days) dayMap.set(x.day, (dayMap.get(x.day) || 0) + x.huf);
    const totalHuf = keys.reduce((a, k) => a + k.huf, 0);
    const requests = keys.reduce((a, k) => a + k.requests, 0);
    res.json({
      hasKeys: true, month, rate: d.rate, totalHuf, requests,
      // a közös havi keret kihasználtsága (mindig az aktuális hónap), összeg nélkül
      limitPct: month === curMonth() ? d.limitPct : (await getReport(curMonth()).catch(() => null))?.limitPct ?? null,
      hufPerRequest: requests ? +(totalHuf / requests).toFixed(2) : null,
      days: [...dayMap].sort().map(([day, huf]) => ({ day, huf })),
      keys, cachedAt: d.cachedAt,
    });
  } catch (err) {
    if (err.tooOld) return res.status(400).json({ error: err.message });
    console.error("[gpt-usage]", err.message);
    res.status(502).json({ error: "A költségadatok most nem érhetők el, próbáld később." });
  }
});

export default router;
export { build as buildOpenAiCostReport };
