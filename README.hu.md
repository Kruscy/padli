# PadlizsanFanSub

**Magyar manga és manhwa fordítói olvasóplatform.**

Élő oldal: [padlizsanfansub.hu](https://padlizsanfansub.hu)

---

## Mi ez?

A PadlizsanFanSub egy teljes körű webes platform, amelyet egy magyar manga/manhwa fordítócsoport számára fejlesztettünk. Egyszerre szolgál olvasófelületként a lefordított fejezetekhez, és belső eszközként a fordítócsapat számára.

## Funkciók

### Olvasóknak
- **Manga/manhwa olvasó** — görgetős és könyv (lapozós) mód, mobil swipe, billentyűzetes navigáció
- **Olvasási haladás mentése** — automatikusan menti és folytatja ahol abbahagytad, fejezetek szerint
- **AniList szinkronizáció** — nyomon követi az olvasási haladásodat az AniList-en
- **Kívánságlista** — elmenthetők a megnézni kívánt sorozatok
- **Szavazások** — közösségi szavazás arról, melyik sorozatot fordítsák le következőnek
- **Toplista és pontok** — jutalmazási rendszer közösségi közreműködőknek
- **Hibajelentés** — fordítási hibák vagy képhibák jelzése közvetlenül az olvasóból
- **Patreon integráció** — korai hozzáférésű fejezetek a támogatóknak

### A fordítócsapatnak
- **PadliCrome** — böngészőalapú, AI-támogatott manga fordítóeszköz
  - Fejezetek importálása közvetlenül az olvasóból vagy URL alapján (MangaDex, WordPress-alapú oldalak)
  - Szövegbuborékok automatikus gépi fordítása
  - Képösszefűzés (több panel egy képbe)
  - Javítások visszaküldése a hibajelentő rendszerbe
- **Admin panel** — manga, fejezetek, hibajelentések, bejelentések, felhasználói szerepkörök kezelése
- **Fejezet feltöltő** — új fejezetek feltöltése automatikus Kavita könyvtár szinkronizációval
- **Billingo integráció** — automatikus számlaküldés shop vásárlásoknál
- **R2/Cloudflare** — minden fejezet kép Cloudflare R2-n tárolva, cache purge-dzsel

## Tech stack

| Réteg | Technológia |
|-------|-------------|
| Backend | Node.js + Express (ES modules) |
| Adatbázis | PostgreSQL |
| Képtárolás | Cloudflare R2 (S3-kompatibilis) |
| CDN | Cloudflare |
| Képfeldolgozás | sharp |
| Auth | express-session + bcrypt |
| Fizetés | Stripe |
| Számlázás | Billingo v3 |
| AI fordítás | Egyedi ML szolgáltatás + OpenAI |
| OCR | Tesseract.js |
| Értesítések | Discord bot (discord.js) |
| Email | Nodemailer |

## Önálló üzemeltetés

### Docker (ajánlott)

Docker Hub: [`krusk/padlizsanfansub`](https://hub.docker.com/r/krusk/padlizsanfansub)

```bash
git clone https://github.com/Kruscy/padli.git
cd padli
cp .env.example .env
# Töltsd ki legalább: PGPASSWORD, SITE_URL, SESSION_SECRET, MAIL_*
nano .env

docker compose up -d
```

Az adatbázis séma automatikusan betöltődik az első indításkor. Az első admin beállítása:

```bash
docker compose exec db psql -U padli -d padli \
  -c "UPDATE users SET role='admin' WHERE email='sajat@email.com';"
```

### Kézi telepítés

Node.js 20+ és PostgreSQL 15+ szükséges. Részletes lépések — adatbázis létrehozástól az nginx konfigig — az [INSTALL.md](INSTALL.md) fájlban.

### Megjegyzés

Ez a projekt szorosan kötődik specifikus infrastruktúrához (Kavita könyvtár útvonalak, Cloudflare R2, Billingo HU, Patreon, Stripe). Az integrációk nagy része opcionális — az alap olvasó nélkülük is működik. Az összes beállítási lehetőséget a `.env.example` tartalmazza.

## Licenc

A forráskód referenciaként elérhető. Minden lefordított tartalom az eredeti szerzőké.
