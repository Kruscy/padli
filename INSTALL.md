# Telepítési útmutató

## Gyors telepítés Dockerrel (ajánlott)

Kell hozzá egy Linux-szerver Dockerrel (https://docs.docker.com/engine/install/).

```bash
git clone https://github.com/Kruscy/padli.git
cd padli
./install.sh
```

A szkript:
1. megkérdezi az oldal címét (pl. `https://pelda.hu`) és a manga-mappák helyét,
2. létrehozza a `.env` fájlt véletlenszerű jelszavakkal és titkos kulcsokkal,
3. előkészíti a mappákat, és elindítja az oldalt és az adatbázist,
4. kiírja a **telepítőkódot**.

Ezután nyisd meg a böngészőben a `/setup.html` oldalt (az oldal magától oda
irányít): add meg a telepítőkódot, az oldal nevét és az első admin
(tulajdonosi) fiókot. Kész — a többi a `⚙️ Oldal beállításai` fülön és a
`.env`-ben állítható (levélküldés `MAIL_*`, képtárolás `R2_*`, Stripe,
Patreon, Discord stb. — mind opcionális).

**Saját logó:** tedd a `logo.png` és `favico.png` fájlokat a `branding/`
mappába (lásd `branding/README.md`).

**Frissítés:** `./update.sh` — részletek: [UPDATING.md](UPDATING.md).

### Tudnivalók

- A telepítőkód később is megnézhető: `docker compose logs app | grep Telepítőkód`.
  Saját kódot a `SETUP_TOKEN` változóval adhatsz meg.
- Az app induláskor magától létrehozza az adatbázis-sémát és lefuttatja a még
  nem alkalmazott migrációkat — frissítés után is. Kikapcsolás:
  `AUTO_MIGRATE=false`; kézi futtatás: `docker compose exec app npm run migrate`.
- Az app konténer a `node` (uid 1000) felhasználóként fut: a bind mountolt
  mappák (uploads, logs, public/blog, padlicrome, a feltöltők mappája) legyenek
  az övéi — az `install.sh` ezt beállítja.
- Éles módban (`NODE_ENV=production`, HTTPS-címnél az `install.sh` beállítja)
  a sütik csak HTTPS-en mennek: az oldal elé kell egy HTTPS-t adó fordított
  proxy (Cloudflare, nginx, Caddy — lásd lent).
- Állapot: `docker compose ps` (healthcheck: `GET /api/health`).

```bash
docker compose down      # leállítás (az adatok megmaradnak)
docker compose restart   # újraindítás
docker compose logs -f   # naplók követése
```

---

## Kézi telepítés

### Előfeltételek

| Szoftver | Minimális verzió |
|----------|-----------------|
| Node.js  | 22 LTS (min. 20.9) |
| PostgreSQL | 15+           |
| npm      | 10+             |

Opcionális (integráció alapján):
- Cloudflare R2 fiók (képtárolás)
- SMTP szerver (email küldés)
- Stripe fiók (shop)
- Patreon fejlesztői fiók

---

## 1. Klónozás

```bash
git clone https://github.com/felhasznaloned/padlizsanfansub.git
cd padlizsanfansub
npm install
```

---

## 2. Adatbázis létrehozása

```bash
# PostgreSQL-ben hozz létre egy felhasználót és adatbázist:
psql -U postgres -c "CREATE USER padli WITH PASSWORD 'valtozz_meg';"
psql -U postgres -c "CREATE DATABASE padli OWNER padli;"
```

A sémát nem kell kézzel betölteni: a szerver első indításkor létrehozza
(és frissítés után a migrációkat is lefuttatja). Kézzel: `npm run migrate`.

---

## 3. Környezeti változók beállítása

```bash
cp .env.example .env
```

Majd nyisd meg a `.env` fájlt és töltsd ki a kötelező mezőket:

| Változó | Leírás | Kötelező |
|---------|--------|----------|
| `SITE_URL` | Az oldal teljes URL-je (pl. `https://pelda.hu`) | ✅ |
| `SITE_NAME` | Az oldal neve (emailekben jelenik meg) | ✅ |
| `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | PostgreSQL adatok | ✅ |
| `SESSION_SECRET` | Hosszú véletlenszerű string | ✅ |
| `SERVER_ADMIN_PASSWORD` | Admin panel Szerver fül jelszava | ✅ |
| `MAIL_HOST` / `MAIL_USER` / `MAIL_PASS` | SMTP adatok | ✅ |
| `R2_*` | Cloudflare R2 (képtárolás) | Ha R2-t használsz |
| `CF_*` | Cloudflare (cache purge) | Ha Cloudflare CDN-t használsz |
| `STRIPE_*` | Stripe (shop funkció) | Ha shoppot használsz |
| `PATREON_*` | Patreon integráció | Ha Patreon szinkront használsz |

Random `SESSION_SECRET` generálás:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. Manga könyvtár beállítása

A `MANGA_ROOT` változó mutat arra a mappára ahol a manga képek vannak.
Minden manga egy almappa, azon belül fejezetek:

```
/mnt/manga/
  KönyvtárNév/
    MangaCím/
      1. fejezet/
        001.jpg
        002.jpg
      2. fejezet/
        001.jpg
```

Az admin panelen (Könyvtárak fül) add hozzá a könyvtárakat, majd indítsd el a szkennelést.

---

## 5. Indítás

```bash
node server/index.js
```

Fejlesztéshez (automatikus újraindítás):
```bash
npm install -g nodemon
nodemon server/index.js
```

Alapértelmezett port: `3000` (módosítható a `PORT` env változóval).

---

## 6. Első admin felhasználó létrehozása

Az első indításkor az oldal a telepítő varázslóra (`/setup.html`) irányít:
a szerver naplójában megjelenő telepítőkóddal itt hozhatod létre az első
admin (tulajdonosi) fiókot és adhatod meg az oldal nevét.

---

## 7. Systemd szolgáltatás (Linux szerveren)

Hozz létre egy `/etc/systemd/system/padlizsanfansub.service` fájlt:

```ini
[Unit]
Description=PadlizsanFanSub
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/padlizsanfansub
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/padlizsanfansub/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable padlizsanfansub
systemctl start padlizsanfansub
```

---

## 8. Nginx reverse proxy (HTTPS)

```nginx
server {
    listen 80;
    server_name pelda.hu;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name pelda.hu;

    ssl_certificate     /etc/letsencrypt/live/pelda.hu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pelda.hu/privkey.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

SSL tanúsítvány Let's Encrypt-tel:
```bash
certbot --nginx -d pelda.hu
```
