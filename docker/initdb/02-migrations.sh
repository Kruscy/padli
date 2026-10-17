#!/bin/sh
# Első indításkor (üres adatbázisnál) a schema.sql után a migrációk is
# lefutnak — enélkül pl. a security_events tábla és a teljesítmény-indexek
# hiányoznának egy friss Docker-telepítésből. Meglévő adatbázisnál a
# postgres image ezt nem futtatja újra; ott a migrációkat kézzel kell
# alkalmazni (lásd INSTALL.md).
set -e
for f in /migrations/*.sql; do
  echo "migráció: $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -q -f "$f"
done
