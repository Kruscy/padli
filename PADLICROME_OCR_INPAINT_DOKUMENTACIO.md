# PadliCrome / OCR / Inpaint – API dokumentáció

Ez a dokumentum két, **egymástól független** rendszert ír le, amit könnyű összekeverni, mert mindkettő manga-oldal szöveg-eltávolítással és fordítással foglalkozik:

1. **Kép-szerkesztő (bug-fix editor)** — `public/js/editor.js` + admin felület. Kézi, oldalankénti javításra való (pl. bug report javítás): OCR-rel kiolvassa a szöveget egy kijelölt buborékból, DeepL/Gemini-vel lefordítja, LaMa Cleaner-rel eltünteti az eredeti szöveget, a fordítást pedig a szerkesztő kézzel írja vissza a képre.
2. **PadliCrome** — `server/routes/padlicrome.js` + `public/js/padlicrome/*`. Automatikus, egész-oldalas fordító eszköz (weboldalon elérhető pontrendszerrel). **2026-08-19 óta a Torii felhő API-t használja**, nem a régi helyi `manga-image-translator` szervert.

Mindkettő a `server/.env`-ből olvassa a beállításait, kódmódosítás nélkül átállítható másik géphez/szolgáltatáshoz az env változók cseréjével.

---

## 1. Kép-szerkesztő (OCR + LaMa inpaint + DeepL/Gemini)

### 1.1 Architektúra

```
Böngésző (editor.js)
   │
   ├─ POST /api/ocr        → server/routes/ocr.js      → OCR_URL/ocr        (távoli gép)
   ├─ POST /api/translate  → server/routes/translate.js → DeepL API / Gemini
   └─ POST /api/inpaint    → server/routes/inpaint.js  → LAMA_URL/inpaint   (távoli gép)
```

**2026-08-20 óta a CT108 gépen (192.168.0.8) futnak** — a korábbi 192.168.0.90-es gépről költöztek át, EasyOCR (angol motor) és IOPaint (a régi LaMa Cleaner leváltója) alapokra, de **pontosan ugyanazt a HTTP szerződést** (kérés/válasz formátum) tartva, így a mi kódunkban (`ocr.js`, `inpaint.js`) semmit nem kellett módosítani, csak az env var-okat átállítani.

Ezek nem a mi kódunk részei — külön telepített szolgáltatások, amikhez a mi Node szerverünk csak HTTP kliensként kapcsolódik.

### 1.2 OCR (`server/routes/ocr.js`)

- **Env var:** `OCR_URL` — jelenlegi érték: `http://192.168.0.8:8081` (korábban `http://192.168.0.90:5001` volt; a kódban lévő `http://192.168.0.90:8001` csak egy nem használt fallback-alapérték)
- **Külső hívás:** `POST {OCR_URL}/ocr`
  - Request body: `{ "imageBase64": "data:image/png;base64,..." }` (a kijelölt szövegdoboz kivágott PNG-je)
  - Válasz: `{ "text": "felismert szöveg" }`
  - Timeout: 30 mp
- **Helyi (nekünk elérhető) endpoint:** `POST /api/ocr`, ugyanaz a body/válasz formátum.
- A CT108-on **EasyOCR** (angol motor) szolgálja ki — 2026-08-20-i élő teszttel ellenőrizve, a régi szerződés szerint működik.

### 1.3 Inpaint / LaMa Cleaner-kompatibilis réteg (`server/routes/inpaint.js`)

- **Env var:** `LAMA_URL` — jelenlegi érték: `http://192.168.0.8:8082` (korábban nem volt explicit beállítva, a kód alapértéke `http://192.168.0.90:8080` volt)
- A CT108-on a `:8082` port egy **kompatibilitási réteg**, ami befelé a régi LaMa Cleaner 1.2.5 multipart-szerződést beszéli, de a ténylegesen a képeket az **IOPaint** (LaMa Cleaner utódja) dolgozza fel a saját, új JSON-alapú API-ján (`:8080`) keresztül. A `:8080` port **csak belső használatra** való, a `:8082`-es réteg mögött — a mi szerverünknek soha nem kell közvetlenül hívnia.
- **Külső hívás:** `POST {LAMA_URL}/inpaint`, **multipart/form-data**, mezők:
  | mező | érték |
  |---|---|
  | `image` | a kivágott terület PNG-je |
  | `mask` | maszk PNG (fehér = eltávolítandó terület, fekete = megtartandó) |
  | `ldmSteps` | `25` |
  | `ldmSampler` | `plms` |
  | `hdStrategy` | `Crop` |
  | `zitsWireframe` | `true` |
  | `hdStrategyCropMargin` | `196` |
  | `hdStrategyCropTrigerSize` | `800` |
  | `hdStrategyResizeLimit` | `2048` |
  | `cv2Flag` | `INPAINT_NS` |
  | `cv2Radius` | `4` |
  | ...és a Stable Diffusion / ControlNet / paint-by-example paraméterek üresen/alapértéken (LaMa modellhez nincs rájuk szükség, de a LaMa Cleaner API megköveteli a jelenlétüket) |
  - Válasz: nyers PNG bytes.
- **Helyi endpoint:** `POST /api/inpaint`
  - Request body (JSON, NEM multipart): `{ "imageBase64": "...", "maskBase64": "...", "prompt": "..." }`
  - A szerver alakítja át multipart/form-data-vá a LaMa hívásához.
  - **Fontos:** a kliens küld egy `prompt` mezőt is, de a jelenlegi szerver kód ezt **nem továbbítja** a LaMa hívásban (`prompt` mindig üres string a multipart body-ban) — ha ezt más géphez telepítve is szeretnéd használni, ellenőrizd, hogy szükséges-e pótolni.
  - Válasz: `{ "image": "data:image/png;base64,..." }`
  - Timeout: 600 mp (10 perc) — nagy/lassú LaMa feldolgozásokhoz.
- LaMa Cleaner verzió: **1.2.5** (a fájl fejléce szerint).

### 1.4 Szöveg-fordítás (`server/routes/translate.js` + `server/lib/translate.js`)

- Elsőként **DeepL Free API**-t próbálja (`DEEPL_API_KEY` env var szükséges hozzá).
- Ha nincs kulcs, vagy a DeepL hibázik/kvóta elfogyott (HTTP 456), automatikusan **Gemini fallback**-re vált (`gemini-3.1-flash-lite`, a meglévő Gemini kulcs-rotációs rendszeren keresztül, ld. `server/lib/gemini-client.js`).
- **Helyi endpoint:** `POST /api/translate`, body: `{ "text": "...", "source": "en", "target": "hu" }` (a `source`/`target` mezőket a kliens küldi, de a szerver mindig magyarra fordít, ezeket nem használja fel).
- Válasz: `{ "translatedText": "..." }`

### 1.5 Használat-naplózás

Az OCR és inpaint hívások sikerét/hibáját a `remote_service_usage` tábla rögzíti (`service`, `success`, `status_code`, `duration_ms`, `error_message`, `created_at`) — ezt jeleníti meg az admin felület **"🖥️ 192.168.0.8 (CT108) használat"** panelje (`admin.html`, `tab-remote-usage`).

---

## 2. PadliCrome — Torii API (2026-08-19 óta)

### 2.1 Architektúra

```
Böngésző (padlicrome.html + app.js)
   │
   └─ POST /api/padlicrome/translate/:id  → server/routes/padlicrome.js
                                              → https://api.toriitranslate.com/api/v2/upload
```

A régi helyi `manga-image-translator` szerver (`MANGA_TRANSLATOR_URL` env var) **már nincs használatban** — a teljes OCR+fordítás+inpaint+tipográfia egy lépésben történik a Torii felhő API-n keresztül.

### 2.2 Env var

```
TORII_API_KEY=<kulcs>
```

Ez van beállítva a live (`/opt/padli/.env`) és a dev (`/opt/padli-dev/.env`) szerveren is.

### 2.3 Külső hívás

- **Endpoint:** `POST https://api.toriitranslate.com/api/v2/upload`
- **Auth:** `Authorization: Bearer <TORII_API_KEY>`
- **Body:** multipart/form-data:
  | mező | érték |
  |---|---|
  | `file` | a kép (JPEG) |
  | `target_lang` | `hu` |
  | `translator` | `gemini-3.1-flash-lite` |
  | `font` | `wildwords` |
  | `text_align` | `auto` |
  | `stroke_disabled` | `false` |
  | `min_font_size` | `6` |
  | `bubbles_only` | `false` |
- **Válasz:** a `success` **response header** értéke `"true"` sikeres híváskor (nem a JSON body-ban van!), a body JSON: `{ "image": "data:image/jpeg;base64,..." }`.
- A `server/routes/padlicrome.js`-ben lévő `translateViaTorii()` függvény végzi ezt a hívást — lásd ott, ha módosítani kell.

### 2.4 Helyi endpointok

- `POST /api/padlicrome/translate/:id` — projektben lévő kép fordítása (pontlevonással)
- `POST /api/padlicrome/translate` — régi addon-kompatibilis, közvetlen fájl/URL alapú fordítás

### 2.5 Egyéb kapcsolódó beállítások

| Env var | Mire való |
|---|---|
| `MANGA_JWT_SECRET` | PadliCrome JWT auth (böngésző-extension kompatibilitáshoz) |
| `GEMINI_API_KEY_*` | A `gemini-3.1-flash-lite` modellhez (Torii ezt a kulcs-rotációs rendszertől függetlenül, saját maga hívja a Torii szerverén — a mi Gemini kulcsainkat ehhez **nem** használja, mert a Torii saját backendje fut) |

---

## 3. Env változók — teljes összefoglaló (ehhez a két rendszerhez)

| Env var | Alapérték, ha üres | Rendszer |
|---|---|---|
| `OCR_URL` | `http://192.168.0.8:8081` (jelenlegi élő érték) | Kép-szerkesztő |
| `LAMA_URL` | `http://192.168.0.8:8082` (jelenlegi élő érték) | Kép-szerkesztő |
| `DEEPL_API_KEY` | *(nincs, Gemini fallback fut)* | Kép-szerkesztő |
| `TORII_API_KEY` | *(kötelező, nincs alapérték)* | PadliCrome |
| `MANGA_JWT_SECRET` | *(kötelező)* | PadliCrome |

---

## 4. Áttelepítés másik szerverre

**Kódmódosítás nem szükséges** — mindkét rendszer teljesen env var-vezérelt:

1. **OCR/LaMa új géphez kötése:** csak állítsd át `OCR_URL`/`LAMA_URL` értékét az új gép címére a `.env`-ben, majd `systemctl restart` a szervert (Node egyszer tölti be a route-fájlokat induláskor, fájl-módosítás önmagában nem elég).
2. **Torii API az új szerveren:** másold be a `TORII_API_KEY`-t az új szerver `.env`-jébe.
3. **Ellenőrzés indítás után:**
   - Kép-szerkesztő: admin felület → "192.168.0.8 (CT108) használat" panel, vagy közvetlen teszt: `curl -X POST http://<OCR_HOST>:8081/ocr -d '{"imageBase64":"..."}'`
   - PadliCrome: `curl -X POST https://api.toriitranslate.com/api/v2/upload -H "Authorization: Bearer $TORII_API_KEY" -F "file=@teszt.jpg" -F "target_lang=hu" ...`
4. Emlékeztető: **mindig előbb a dev szerveren** (`/opt/padli-dev`, port 3002) teszteld az új beállításokat, csak utána a live-on (`/opt/padli`, port 3000).
