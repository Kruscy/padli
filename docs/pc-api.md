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
| POST | `/translate-text` | **Buborékszövegek fordítása (gpt-5.4-mini)**, lásd lent |
| POST | `/translate/:id` | Torii-fordítás, 1 pont; a válasz fejlécében `X-Points-Remaining` |
| POST | `/translate-gemini/:id` | Gemini-fordítás (szegmensek) |
| POST | `/translate` | egy kép azonnali fordítása (multipart `image` vagy `{ imageUrl }`) |
| GET | `/image/:type/:filename` | előnézet; `type` = `originals` \| `translated` \| `merged` |
| GET | `/download/:type/:filename` | letöltés |

## Szövegfordítás: `POST /translate-text`

Ezt arra az esetre használd, ha a képet a Torii elemzi és szerkeszti, és nálunk csak a kiolvasott szöveget kell lefordítani.

```json
{
  "pages": [["Hey!", "I'm not done yet.", ""], ["WHOOSH"]],
  "mangaSlug": "overgeared",
  "glossary": { "Impenetrable Truth": "Áthatolhatatlan Igazság" },
  "notes": "Grid és a céhtagok tegeződnek."
}
```

- **Mezők:**
  - `pages`: oldalanként a buborékok szövege, a Torii sorrendjében. Egy kérésben egy egész fejezet is elküldhető. A modell így látja az összefüggéseket, ezért jobb és olcsóbb is.
  - `mangaSlug`: nem kötelező. Ha megadod, a mű címe is bekerül a fordítás hátterébe.
  - `glossary`: nem kötelező, kötelezően betartandó szójegyzék. Lehet objektum vagy `[{source, target}]` tömb, legfeljebb 200 elem.
  - `notes`: nem kötelező megjegyzés a fordítónak.
- **Válasz:**
  ```json
  { "ok": true, "pages": [["Hé!", "Még nem végeztem.", ""], ["SUHH"]], "pointsCharged": 2, "pointsRemaining": 118, "model": "gpt-5.4-mini" }
  ```
  - Az oldalak és a buborékok száma pontosan megegyezik a bemenetével, az üres buborék üres marad.
- **Ár:** oldalanként 1 pont. A szövegtelen oldal ingyenes.
  - A pontot a fordítás előtt vonjuk le, hiba esetén (`502`) visszaadjuk.
  - Ha nincs elég pont, a válasz `402`, a `needed` és a `balance` mezővel.
- **Korlátok egy kérésre:**
  - legfeljebb 80 oldal;
  - oldalanként legfeljebb 80 buborék;
  - buborékonként legfeljebb 1000 karakter;
  - összesen legfeljebb 60 000 karakter.

A hibajegy-javítási végpontok (`import-bug-image`, `submit-bug-fix`, `fix-status`) kulccsal nem érhetők el, csak a weboldalról.

A régi bővítmény-belépés (`POST /api/padlicrome/login`, JWT) 2026-11-08 óta megszűnt, `410`-et ad.

## Helyi motor szövegfordítója (Padlizsan Studio): OpenAI-kompatibilis

- `GET /llm/v1/models`
  - Az engedélyezett modelleket adja vissza, árakkal együtt: `points_per_1m_input`, `points_per_1m_output`, `est_points_per_page`.
- `POST /llm/v1/chat/completions`
  - Szabványos Chat Completions kérés.
  - A kulcs `Authorization: Bearer pdl_…` vagy `X-API-Key` fejlécben is jöhet.
  - A `max_tokens` mezőt a szerver `max_completion_tokens`-re alakítja, legfeljebb 16 384-re.
  - A `reasoning_effort` csak azoknál a modelleknél megy tovább, amelyek ismerik. Ismeretlen érték, például `auto` helyett `none` megy.
  - `stream: true` esetén a válasz egyetlen SSE-darabban jön.
- **Modellek:**
  - `gpt-5.4-nano`
  - `gpt-4.1-mini`
  - `gpt-5.4-mini` (ajánlott)
  - `gpt-4.1`
  - `gpt-5.5`

  Más modellnévre a válasz `400 model_not_found`.
- **Ár:** pont = valós OpenAI-költség × 340 Ft/USD × 2 / 2,5 Ft. A szorzó 2, vagyis a költségünk mellé ugyanannyi haszon jön.
  - A tört pontok egy mérőben gyűlnek, és egész pontonként vonódnak le.
  - Hívás előtt a szerver ellenőrzi, hogy az elérhető pont fedezi-e a kérés becsült árát. Ha nem, a válasz `402 insufficient_points`.
- **Visszajelzés:**
  - A válasz fejlécében: `X-Points-Used` (tört szám) és `X-Points-Remaining`.
  - A válasz törzsében: `padlizsan: { points_used, points_remaining }`.
  - A `GET /me` is visszaadja a `points_pending` (még le nem vont rész) és a `points_available` mezőt.

## A felhős mód (`POST /translate`) 2026-11-08 óta

- **Figyelembe veszi** a következő mezőket: `target_lang`, `font`, `text_align`, `min_font_size`, `bubbles_only`, `stroke_disabled`, `custom_prompt` (legfeljebb 1000 karakter), `context`.
- **A modell rögzített:** Torii `gemini-3.1-flash-lite`. A `translator` mezőt a szerver figyelmen kívül hagyja, mert a drágább Torii-modellek mellett az 1 pont/oldal árból nem maradna haszon.
- **A válaszban:**
  - valódi `Content-Type`;
  - `X-Points-Used: 1`;
  - `X-Context` (URL-kódolva), ha a Torii visszaadja és elfér a fejlécben.
