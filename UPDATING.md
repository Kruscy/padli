# Frissítés

## Dockeres telepítés

```bash
./update.sh
```

Letölti a legújabb kiadás image-ét és újraindítja az oldalt. Az
adatbázis-változásokat (migrációkat) az app induláskor magától lefuttatja;
az adatok (adatbázis, feltöltések, beállítások) megmaradnak. A naplóban
látszik, mi futott le:

```
[migrate] 2026-10-19-site-settings.sql
🍆 Saját Fansub running on port 3000
```

Ha az adatbázis frissítése nem sikerül, a szerver **nem indul el** (a
naplóban `❌ Az adatbázis frissítése nem sikerült…`) — így nem fut hibás
sémával. Ilyenkor az előző verzióra visszaállás: `IMAGE_TAG=<előző verzió>`
a `.env`-ben, majd `docker compose up -d`.

Melyik verziót kövesse az oldal (`.env` → `IMAGE_TAG`):

| `IMAGE_TAG` | Mit jelent |
|---|---|
| `stable` | a legutóbbi kiadás — **ajánlott** (az `install.sh` ezt állítja be) |
| `1.2.0` | pontosan ez a verzió (nem frissül magától) |
| `latest` | a fejlesztői ág legfrissebb állapota (kevésbé tesztelt) |

Az admin felület **⚙️ Oldal beállításai** fülén látszik a futó verzió, és ha
van újabb kiadás, azt is jelzi (kikapcsolás: `UPDATE_CHECK=false`).

Saját módosításokkal (helyi build): `./update.sh --build` (`git pull`, majd
építés és újraindítás).

## Kézi (Docker nélküli) telepítés

```bash
git pull
npm ci --omit=dev
npm run migrate        # opcionális: induláskor magától is lefut
sudo systemctl restart padli
```

## Új kiadás készítése (karbantartóknak)

```bash
npm version minor      # vagy patch / major — package.json + git tag (v1.3.0)
git push --follow-tags
```

A `v*` tag hatására a GitHub Actions lefuttatja a teszteket, megépíti és
feltölti a `krusk/padlizsanfansub:<verzió>` és `:stable` image-et, majd
GitHub Release-t készít a változáslistával. A tag és a `package.json`
verziója egyezzen (a workflow ellenőrzi).

Adatbázis-változás: új fájl a `server/scripts/migrations/` mappába
(`ÉÉÉÉ-HH-NN-leiras.sql`). Ismételten futtathatónak kell lennie
(`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), mert egy félbeszakadt migráció a
következő induláskor elölről fut. Friss telepítéshez a `schema.sql`-t is
frissítsd.
