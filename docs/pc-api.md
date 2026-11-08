# PadliCrome külső API (v1)

Alap URL: `https://padlizsanfansub.hu/api/pc/v1`

## Hitelesítés

Felhasználónkénti API-kulcs. Létrehozása: **Beállítások → 🔑 API-kulcsok**. A kulcsot csak egyszer mutatjuk meg; egy fiókhoz legfeljebb 5 aktív kulcs tartozhat.

Minden kérésben küldd el az alábbi két forma egyikében:

```
X-API-Key: pdl_xxxxxxxx…
Authorization: Bearer pdl_xxxxxxxx…
```

- A kérés a kulcs tulajdonosának nevében fut:
  - a fordítás az ő pontjaiból megy;
  - csak azokat a fejezeteket importálhatja, amelyeket az oldalon is olvashat (zárolt fejezet csak támogatónak, 18+ csak igazoltan nagykorúnak).
- Hibakódok:
  - `401`: hiányzó, hibás vagy visszavont kulcs.
  - `402`: nincs elég pont.
  - `403`: nincs hozzáférés a fejezethez.
  - `429`: túl sok kérés.
- Korlátok:
  - 300 kérés/perc kulcsonként;
  - 30 hibás kulcs / 15 perc IP-címenként.
- CORS: bármely eredetről hívható.

## Végpontok

| Metódus | Útvonal | Leírás |
|---|---|---|
| GET | `/me` | `{ username, points, subscriber, role }` |
| GET | `/library/manga?q=&limit=1..100&offset=` | Sorozatok: `{ total, items:[{ slug, title, cover_url, status, adult, chapters, updated_at }] }` |
| GET | `/library/manga/:slug/chapters` | `{ slug, chapters:[{ chapter, title, locked, unlocks_at, accessible, updated_at }] }` |
| POST | `/import-chapter` | `{ mangaSlug, chapter }` → a fejezet képei a projektbe: `{ added, skipped, total }` |
| POST | `/scrape` | `{ url }` → külső fejezetoldal képei: `{ urls, count, tooMany }` |
| POST | `/upload` | multipart, `images` mező (max 30 kép, egyenként 5 MB) |
| POST | `/project/start` | `{ url }` → projekt indítása külső fejezetből |
| GET / DELETE | `/project` | aktuális projekt (képlista) lekérése / törlése |
| PATCH | `/image/:id` | `{ active: bool }` |
| DELETE | `/image/:id` | kép törlése a projektből |
| POST | `/merge` | `{ imageIds:[…] }` → képek összefűzése |
| POST | `/translate/:id` | Torii-fordítás, 1 pont; a válasz fejlécében `X-Points-Remaining` |
| POST | `/translate-gemini/:id` | Gemini-fordítás (szegmensek) |
| POST | `/translate` | egy kép azonnali fordítása (multipart `image` vagy `{ imageUrl }`) |
| GET | `/image/:type/:filename` | előnézet; `type` = `originals` \| `translated` \| `merged` |
| GET | `/download/:type/:filename` | letöltés |

A hibajegy-javítási végpontok (`import-bug-image`, `submit-bug-fix`, `fix-status`) kulccsal nem érhetők el, csak a weboldalról.

A régi bővítmény-belépés (`POST /api/padlicrome/login`, JWT) 2026-11-08 óta megszűnt, `410`-et ad.
