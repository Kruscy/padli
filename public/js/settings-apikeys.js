/* Beállítások → API-kulcsok (külső PadliCrome), 2026-11-08 */
(() => {
  const listEl = document.getElementById("apiKeyList");
  if (!listEl) return;
  const statusEl = document.getElementById("apiKeyStatus");
  const labelEl = document.getElementById("apiKeyLabel");
  const newBox = document.getElementById("apiKeyNew");
  const newVal = document.getElementById("apiKeyNewValue");

  const fmt = d => d ? new Date(d).toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" }) : "még nem használt";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const setStatus = (msg, err) => { statusEl.textContent = msg || ""; statusEl.style.color = err ? "#fca5a5" : ""; };

  async function load() {
    try {
      const r = await fetch("/api/user/api-keys", { credentials: "include" });
      if (r.status === 401) { listEl.innerHTML = "<p>Jelentkezz be a kulcsok kezeléséhez.</p>"; return; }
      const { keys } = await r.json();
      if (!keys.length) { listEl.innerHTML = '<p style="color:#888">Még nincs API-kulcsod.</p>'; return; }
      listEl.innerHTML = keys.map(k => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #1f2937">
          <div>
            <div><b>${esc(k.label || "Névtelen kulcs")}</b> <code style="color:#888">${esc(k.prefix)}…</code></div>
            <div style="font-size:0.8rem;color:#888">Létrehozva: ${fmt(k.created_at)} · Utoljára használva: ${fmt(k.last_used_at)}</div>
          </div>
          <button class="disconnect-btn" type="button" data-revoke="${k.id}">Visszavonás</button>
        </div>`).join("");
    } catch {
      setStatus("Nem sikerült betölteni a kulcsokat.", true);
    }
  }

  document.getElementById("apiKeyCreateBtn").addEventListener("click", async () => {
    setStatus("");
    try {
      const r = await fetch("/api/user/api-keys", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelEl.value }),
      });
      const data = await r.json();
      if (!r.ok) return setStatus(data.error || "Hiba történt.", true);
      newVal.textContent = data.key;
      newBox.classList.remove("hidden");
      labelEl.value = "";
      load();
    } catch {
      setStatus("Hálózati hiba.", true);
    }
  });

  document.getElementById("apiKeyCopyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(newVal.textContent); setStatus("Kimásolva ✔"); }
    catch { setStatus("Jelöld ki és másold kézzel.", true); }
  });

  listEl.addEventListener("click", async e => {
    const id = e.target.closest("[data-revoke]")?.dataset.revoke;
    if (!id || !confirm("Biztosan visszavonod ezt a kulcsot? Az ezt használó program azonnal kiesik.")) return;
    const r = await fetch(`/api/user/api-keys/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { setStatus("Kulcs visszavonva."); newBox.classList.add("hidden"); load(); }
    else setStatus("Nem sikerült visszavonni.", true);
  });

  load();
})();
