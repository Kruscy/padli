#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Frissítés a legújabb kiadásra:   ./update.sh
#
# Letölti az új image-et és újraindítja az oldalt. Az adatbázis-
# változásokat (migrációkat) az app induláskor magától lefuttatja; az
# adatok (adatbázis, feltöltések, beállítások) megmaradnak.
# Saját buildnél (módosított kód): ./update.sh --build
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\033[1;35m▶\033[0m %s\n' "$*"; }

if [ "${1:-}" = "--build" ]; then
  if [ -d .git ]; then say "Kód frissítése (git pull)…"; git pull --ff-only; fi
  say "Építés és újraindítás…"
  docker compose up -d --build
else
  say "Új verzió letöltése…"
  docker compose pull app
  say "Újraindítás…"
  docker compose up -d
fi

say "Indulás és adatbázis-frissítés naplója:"
sleep 5
docker compose logs --tail 30 app | grep -E "migrate|running on port|❌" || true
say "Kész."
