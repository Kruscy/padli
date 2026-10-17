import Layer from "express/lib/router/layer.js";

/* ── Async hibakezelés Express 4 alatt ────────────────────────
   Az Express 4 csak a szinkron módon dobott hibát adja tovább a
   hibakezelőnek; egy async handlerből (rejected promise) jövő hiba
   kezeletlen marad, Node ≥15 alatt pedig ez az EGÉSZ folyamatot leállítja
   — egyetlen hibás bemenetű kérés (pl. chat content: []) vagy egy DB-hiba
   elég volt hozzá. Itt minden route-/middleware-réteg visszatérési
   értékét figyeljük: ha promise és elutasítódik, next(err)-rel a
   hibakezelőhöz kerül (ugyanaz, amit az express-async-errors csomag tesz).
   Elég egyszer, a szerver indulásakor importálni. ── */
if (!Layer.prototype.__padliAsyncPatched) {
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // hibakezelő middleware, nem kérés-handler

    let nextCalled = false;
    const guardedNext = (err) => { nextCalled = true; next(err); };

    try {
      const ret = fn(req, res, guardedNext);
      if (ret && typeof ret.then === "function") {
        ret.then(undefined, (err) => {
          if (nextCalled) {
            // A handler már továbbadta a kérést, utána hibázott — csak naplózzuk
            console.error(`[async-errors] hiba next() után: ${req.method} ${req.originalUrl}:`, err);
            return;
          }
          nextCalled = true;
          next(err || new Error("Ismeretlen async hiba"));
        });
      }
    } catch (err) {
      if (!nextCalled) next(err);
      else console.error(`[async-errors] hiba next() után: ${req.method} ${req.originalUrl}:`, err);
    }
  };
  Layer.prototype.__padliAsyncPatched = true;
}

/* ── Egységes, utolsó hibakezelő ──────────────────────────────
   Belső hibánál (5xx) nem adunk ki részleteket a kliensnek, csak naplózunk.
   4xx-nél (pl. hibás JSON, túl nagy törzs, multer-limit) a csomagok saját,
   kiadható üzenetét adjuk vissza. */
export function errorHandler(err, req, res, _next) {
  let status = Number(err?.status || err?.statusCode) || 500;
  if (err?.name === "MulterError") status = 400;
  if (status < 400 || status > 599) status = 500;

  if (status >= 500) {
    console.error(`[HIBA] ${req.method} ${req.originalUrl}:`, err);
  }

  if (res.headersSent) {
    // A válasz már elindult — befejezni nem tudjuk, a kapcsolatot lezárjuk
    if (!res.writableEnded) res.destroy();
    return;
  }

  const message = status >= 500
    ? "Szerver hiba"
    : (err?.expose || err?.name === "MulterError") && err.message ? err.message : "Hibás kérés";

  if (req.originalUrl.startsWith("/api/")) {
    res.status(status).json({ error: message });
  } else {
    res.status(status).type("text").send(message);
  }
}

// Router-on kívüli (pl. időzített, háttérben futó) promise-hibák: naplózzuk,
// de ne állítsák le a folyamatot.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
