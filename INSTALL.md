# Telepítési útmutató

## Előfeltételek

| Szoftver | Minimális verzió |
|----------|-----------------|
| Node.js  | 20+             |
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

# Töltsd be a sémát:
psql -U padli -d padli -f schema.sql
```

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

1. Regisztrálj az oldalon
2. A PostgreSQL-ben állítsd be az admin szerepkört:

```sql
UPDATE users SET role = 'admin' WHERE email = 'sajat@email.com';
```

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
