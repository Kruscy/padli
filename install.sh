#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Egyparancsos telepítés Dockerrel:   ./install.sh
#
# Létrehozza a .env fájlt (véletlenszerű jelszavakkal és titkos
# kulcsokkal), a szükséges mappákat, majd elindítja az oldalt. Utána a
# böngészőben a telepítő varázsló kéri az oldal nevét és az első admin
# fiókot. Meglévő .env fájlt nem ír felül.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\033[1;35m▶\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Nincs telepítve a Docker: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Nincs Docker Compose (docker compose) — frissítsd a Dockert."

secret() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# KULCS=érték beállítása a .env-ben (meglévő sor cseréje vagy hozzáfűzés)
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" .env; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > "$tmp"
  else
    cp .env "$tmp"; printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" .env
}

if [ -f .env ]; then
  say "Már van .env fájl — azt használom (nem írom felül)."
else
  [ -f .env.example ] || fail "Hiányzik a .env.example — a projekt mappájából futtasd."
  read -r -p "Az oldal címe, ahol a látogatók elérik (pl. https://pelda.hu) [http://localhost:3000]: " SITE_URL
  SITE_URL="${SITE_URL:-http://localhost:3000}"
  SITE_URL="${SITE_URL%/}"
  read -r -p "A manga-mappák helye a szerveren [/mnt/manga]: " MANGA_ROOT
  MANGA_ROOT="${MANGA_ROOT:-/mnt/manga}"

  cp .env.example .env
  set_env SITE_URL "$SITE_URL"
  set_env BASE_URL "$SITE_URL"
  set_env MANGA_ROOT "$MANGA_ROOT"
  set_env UPLOADER_BASE_DIR "$MANGA_ROOT/feltoltok"
  set_env PGPASSWORD "$(secret)"
  set_env SESSION_SECRET "$(secret)"
  set_env SERVER_ADMIN_PASSWORD "$(secret)"
  set_env MANGA_JWT_SECRET "$(secret)"
  set_env IMAGE_TAG "stable"
  # A minta DATABASE_URL-je a régi minta-jelszót tartalmazza — nem kell (PG* változók)
  sed -i.bak 's/^DATABASE_URL=/# DATABASE_URL=/' .env && rm -f .env.bak
  # Éles mód (biztonságos sütik, HTTPS-átirányítás) csak HTTPS-címmel
  case "$SITE_URL" in https://*) set_env NODE_ENV production ;; esac
  chmod 600 .env
  say ".env létrehozva (jelszavak és kulcsok véletlenszerűen generálva)."
fi

say "Mappák előkészítése…"
mkdir -p uploads logs public/blog padlicrome branding
# Az app konténer a "node" (uid 1000) felhasználóként fut
if [ "$(id -u)" = "0" ]; then
  chown -R 1000:1000 uploads logs public/blog padlicrome
else
  sudo chown -R 1000:1000 uploads logs public/blog padlicrome 2>/dev/null \
    || say "Figyelem: nem sikerült a mappák tulajdonosát 1000-re állítani (sudo chown -R 1000:1000 uploads logs public/blog padlicrome)."
fi

MANGA_DIR="$(grep '^MANGA_ROOT=' .env | cut -d= -f2-)"
UPLOAD_DIR="$(grep '^UPLOADER_BASE_DIR=' .env | cut -d= -f2-)"
for d in "$MANGA_DIR" "$UPLOAD_DIR"; do
  [ -n "$d" ] || continue
  mkdir -p "$d" 2>/dev/null || sudo mkdir -p "$d" || say "Figyelem: nem sikerült létrehozni: $d"
done
[ -n "$UPLOAD_DIR" ] && { chown 1000:1000 "$UPLOAD_DIR" 2>/dev/null || sudo chown 1000:1000 "$UPLOAD_DIR" 2>/dev/null || true; }

say "Indítás (az első alkalommal a letöltés eltarthat pár percig)…"
if docker compose pull app; then
  docker compose up -d
else
  say "Az image nem tölthető le — helyben építem."
  docker compose up -d --build
fi

say "Várakozás az indulásra…"
for _ in $(seq 1 60); do
  if docker compose logs app 2>/dev/null | grep -q "running on port"; then break; fi
  sleep 2
done

TOKEN="$(docker compose logs app 2>/dev/null | grep -o 'Telepítőkód: [A-Za-z0-9_-]*' | tail -1 | cut -d' ' -f2 || true)"
URL="$(grep '^SITE_URL=' .env | cut -d= -f2-)"
echo
say "Kész! Nyisd meg: ${URL}/setup.html"
if [ -n "$TOKEN" ]; then
  say "Telepítőkód: $TOKEN"
else
  say "A telepítőkódot itt találod: docker compose logs app | grep Telepítőkód"
fi
say "Frissítés később: ./update.sh"
