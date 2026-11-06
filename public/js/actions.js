/* ── Inline eseménykezelők helyett (CSP script-src-attr 'none') ──
   Az onclick="fn(1, 'x')" helyett:
     <button data-on-click="fn" data-args='[1,"x"]'>   (HTML-ben)
     `<button ${act("fn", 1, "x")}>`                    (JS-ből generált HTML-ben)
   Csak a PadliActions.register()-rel felvett függvények hívhatók (nem
   bármilyen window.* függvény), így egy beinjektált attribútum sem tud
   tetszőleges kódot indítani.
   Különleges argumentumok: "$el" = az elem, "$value" = az elem értéke,
   "$event" = az esemény.
   Kattintásnál csak a legközelebbi data-on-click elem fut le (mint a
   stopPropagation); data-on-click="stop" = semmit nem csinál, csak elnyeli. */
(function () {
  if (window.PadliActions) return;

  const registry = Object.create(null);
  registry.stop = () => {};
  registry.hideSelf = (el) => { el.style.display = "none"; };
  registry.hideById = (id) => { const el = document.getElementById(id); if (el) el.style.display = "none"; };
  // Modális háttérre kattintás: csak ha magára az elemre (nem a tartalmára) kattintottak
  registry.hideIfTarget = (el, event) => { if (event.target === el) el.style.display = "none"; };

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function run(el, type, event) {
    const name = el.getAttribute(`data-on-${type}`);
    const fn = registry[name];
    if (!fn) { console.warn(`[actions] ismeretlen művelet: ${name}`); return; }
    let args = [];
    const raw = el.getAttribute("data-args");
    if (raw) {
      try { args = JSON.parse(raw); } catch { console.warn("[actions] hibás data-args", raw); return; }
    }
    args = args.map(a => a === "$el" ? el : a === "$value" ? el.value : a === "$event" ? event : a);
    return fn.apply(el, args);
  }

  // A célelemtől felfelé a legközelebbi kezelős elem (a document-ig)
  function closestWith(target, attr) {
    return target instanceof Element ? target.closest(`[${attr}]`) : null;
  }

  for (const type of ["click", "input", "change", "keydown"]) {
    document.addEventListener(type, (event) => {
      const el = closestWith(event.target, `data-on-${type}`);
      if (el) run(el, type, event);
    });
  }
  // Az error/load nem buborékol → elkapó (capture) fázisban
  for (const type of ["error", "load"]) {
    document.addEventListener(type, (event) => {
      const el = event.target;
      if (el instanceof Element && el.hasAttribute(`data-on-${type}`)) run(el, type, event);
    }, true);
  }

  window.PadliActions = {
    register(map) { Object.assign(registry, map); },
  };
  // Attribútum-szöveg generált HTML-hez: act("fn", 1, "x")
  // → data-on-click="fn" data-args="[1,&quot;x&quot;]"
  window.act = function (name, ...args) {
    return `data-on-click="${esc(name)}"` + (args.length ? ` data-args="${esc(JSON.stringify(args))}"` : "");
  };
  // Más eseménytípushoz: actOn("input", "fn", "$value")
  window.actOn = function (type, name, ...args) {
    return `data-on-${esc(type)}="${esc(name)}"` + (args.length ? ` data-args="${esc(JSON.stringify(args))}"` : "");
  };
})();
