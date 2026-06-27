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

Ez a projekt szorosan kötődik specifikus infrastruktúrához (Kavita könyvtár útvonalak, Cloudflare R2, Billingo HU, Patreon, Stripe). Nem általános célú, önállóan üzemeltethető olvasónak terveztük, de a kód nyitott referenciaként és tanuláshoz.

Szükséges környezeti változók: lásd `.env.example` (nem szerepel a repóban — keresd a karbantartót).

## Licenc

A forráskód referenciaként elérhető. Minden lefordított tartalom az eredeti szerzőké.
