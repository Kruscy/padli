// server/scripts/blog-auto-generator.js
// Automatikus blog poszt generátor — GPT-4o tartalom + DALL-E 3 borítókép
// Hívható: node server/scripts/blog-auto-generator.js
// Vagy cron-ból: import { generateBlogPost } from "./scripts/blog-auto-generator.js"

import OpenAI from "openai";
import { pool } from "../db.js";
import { generateStaticPost } from "../blog-static-generator.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../../.env") });

const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const COVERS_DIR = path.join(__dirname, "../../uploads/blog-covers");

// ── TÉMÁK LISTÁJA ────────────────────────────────────────────────────────────
// Az első mindig a legmagasabb prioritású SEO poszt, utána jönnek a heti poszt témák.
// A generátor sorban halad — ha egy téma már létezik (slug collision), átugorja.
export const BLOG_TOPICS = [
  {
    slug: "manga-magyarul-hol-lehet-olvasni",
    title: "Manga magyarul – Hol lehet magyar mangát és manhwát online olvasni?",
    imagePrompt: "anime girl sitting cross-legged, happily reading an open manga book, stack of manga volumes beside her",
    category: "ajanlo",
    tags: ["manga magyarul", "manhwa magyarul", "magyar manga", "magyar fansub"],
    keywords: ["manga magyarul", "manhwa magyarul", "magyar manga", "magyar manhwa", "magyar manga oldalak", "manga fansub", "online manga olvasás"],
    seoTitle: "Manga magyarul és manhwa magyarul – Magyar manga olvasás | Padlizsán Fansub",
    seoDesc: "Manga magyarul és manhwa magyarul egy helyen. Fedezd fel a Padlizsán Fansub magyar fordításait, online manga és manhwa olvasási lehetőségekkel.",
    prompt: `Írj egy 1400-1600 szavas, SEO-optimalizált magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra.

Cím: "Manga magyarul – Hol lehet magyar mangát és manhwát online olvasni?"

Kötelező felépítés (H2/H3 szekciók):
1. **Bevezető** (150-200 szó) — Ha manga magyarul vagy manhwa magyarul történeteket keresel, ma már több magyar fordítócsapat és fansub oldal is készít minőségi fordításokat. A Padlizsán Fansub célja, hogy a legjobb mangákat és manhwákat magyar nyelven olvashasd.
2. **Mi a különbség a manga és a manhwa között?** (300-400 szó) — Részletes magyarázat, természetesen beleszőve: manga magyarul, manhwa magyarul, magyar manga, magyar manhwa
3. **Hol lehet magyar mangát olvasni?** — online manga olvasás, magyar manga oldalak, magyar fansubok, magyar fordítások bemutatása
4. **Mi az a fansub?** — magyar fansub, manga fansub, magyar manga fordítás, magyar manhwa fordítás magyarázata
5. **Miért a Padlizsán Fansub?** — projektszám, frissítési sebesség, minőség, Discord közösség, ingyenesség
6. **Gyakori kérdések (FAQ)** — legalább 5 kérdés-válasz:
   - Hol lehet manga magyarul olvasni?
   - Hol lehet manhwa magyarul olvasni?
   - Melyek a legjobb magyar manga oldalak?
   - Mi az a magyar fansub?
   - Ingyenes a manga olvasás a Padlizsán Fansub-on?

Fontos megjegyzés a szövegbe természetesen beleszőve: "Sokan Padlizsan, Padlizsan.hu vagy Padlizsán.hu névvel keresnek minket a Google-ben — bármelyik keresést használod, ugyanazt a magyar manga- és manhwa-fordításokat készítő közösséget találod."

Kulcsszavak a szövegben természetesen, nem erőltetetten: manga magyarul, manhwa magyarul, magyar manga, magyar manhwa, magyar manga oldalak, manga fansub, online manga olvasás, magyar fansub.

Formázás: HTML (h2, h3, p, ul/li, strong tagek). Ne legyen benne html/body/head wrapper, csak a tartalom.`
  },
  {
    slug: "manhwa-magyarul-legjobb-koreai-webcomicok",
    title: "Manhwa magyarul – A legjobb koreai webcomicok magyar fordításban",
    imagePrompt: "anime character scrolling through a webtoon on a smartphone, vertical comic panels visible on the screen, excited expression",
    category: "ajanlo",
    tags: ["manhwa magyarul", "magyar manhwa", "koreai manhwa", "webtoon"],
    keywords: ["manhwa magyarul", "magyar manhwa", "koreai webcomic", "manhwa olvasás"],
    prompt: `Írj egy 1200-1500 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra a koreai manhwákról magyarul.
Téma: a manhwa műfaj bemutatása, miben különbözik a mangától, miért érdemes olvasni, milyen típusok léteznek (fantasy, romantika, akció, isekai), és hogyan olvasható magyarul a Padlizsán Fansub-on.
Kulcsszavak természetesen: manhwa magyarul, magyar manhwa, koreai manhwa, webtoon magyarul.
Formázás: HTML (h2, h3, p, ul/li). Legyen benne FAQ szekció 3-4 kérdéssel.`
  },
  {
    slug: "mi-az-a-fansub-manga-forditas",
    title: "Mi az a fansub? – A manga és manhwa fordítás világa magyarul",
    imagePrompt: "two anime characters working together at a desk, one translating text on paper, other editing manga panels on a monitor, translation work scene",
    category: "forditas",
    tags: ["fansub", "manga fordítás", "manhwa fordítás", "magyar fansub"],
    keywords: ["fansub", "manga fordítás", "magyar fansub", "manhwa fordítás"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra a fansub kultúráról.
Téma: mi az a fansub, honnan ered a szó, hogyan működik egy fansub csapat (fordító, lektor, tipográfus), milyen kihívásokkal jár a manga fordítás, miért végzik önkéntesek.
Mutasd be a Padlizsán Fansub munkáját és közösségét.
Formázás: HTML (h2, h3, p, ul/li). Legyen benne FAQ szekció.`
  },
  {
    slug: "manga-vs-manhwa-vs-manhua-kulonbseg",
    title: "Manga, manhwa, manhua – Mi a különbség? Teljes útmutató",
    imagePrompt: "three anime characters side by side each holding their country's comic book: Japanese manga (right to left), Korean manhwa (vertical scroll), Chinese manhua, comparison scene",
    category: "ajanlo",
    tags: ["manga", "manhwa", "manhua", "japán manga", "koreai manhwa", "kínai manhua"],
    keywords: ["manga vs manhwa", "manhwa különbség", "manhua magyarázat", "manga típusok"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű összehasonlító blogbejegyzést a Padlizsán Fansub weboldalra.
Téma: a manga (japán), manhwa (koreai) és manhua (kínai) képregények összehasonlítása — olvasási irány, stílus, témák, platformok, tipikus műfajok.
Legyen benne összehasonlító táblázat és FAQ szekció.
Formázás: HTML (h2, h3, p, ul/li, table).`
  },
  {
    slug: "legjobb-isekai-manga-magyarul",
    title: "A legjobb isekai manga és manhwa magyarul – Top ajánló",
    imagePrompt: "anime hero character falling through a glowing magical portal into a fantasy world, surprised expression, medieval fantasy landscape below",
    category: "ajanlo",
    tags: ["isekai", "manga ajánló", "manhwa ajánló", "fantasy manga"],
    keywords: ["isekai manga magyarul", "legjobb isekai", "fantasy manhwa", "manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb isekai mangákról és manhwákról.
Téma: mi az az isekai műfaj, miért olyan népszerű, top isekai ajánló (általánosan ismert címek), hogyan olvashatók magyarulon a Padlizsán Fansub-on.
Formázás: HTML (h2, h3, p, ul/li). Legyen benne legalább 5 ajánlott cím rövid leírással.`
  },
  {
    slug: "magyar-manga-kozosseg-discord",
    title: "Magyar manga közösség – Csatlakozz a Padlizsán Fansub Discord szerveréhez",
    imagePrompt: "group of cheerful anime characters gathered together chatting, speech bubbles, community feel, friends discussing manga",
    category: "kozosseg",
    tags: ["manga közösség", "discord", "magyar manga rajongók", "fansub közösség"],
    keywords: ["magyar manga közösség", "manga discord", "magyar fansub közösség"],
    prompt: `Írj egy 1000-1200 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra a közösség fontosságáról.
Téma: miért érdemes csatlakozni egy magyar manga közösséghez, mit kínál a Padlizsán Fansub Discord szervere (hírek, fordítás, viták, szavazások), hogyan lehet részt venni a fordítói munkában.
Formázás: HTML (h2, h3, p, ul/li).`
  },
  {
    slug: "fantasy-manhwa-ajanlok-magyarul",
    title: "Fantasy manhwa ajánlók – A legjobb koreai fantasy képregények magyarul",
    imagePrompt: "powerful anime warrior character in detailed fantasy armor holding a sword, magical aura, epic pose, fantasy setting",
    category: "ajanlo",
    tags: ["fantasy manhwa", "manhwa ajánló", "koreai fantasy", "manhwa magyarul"],
    keywords: ["fantasy manhwa magyarul", "koreai fantasy képregény", "manhwa ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb fantasy manhwákról.
Téma: a fantasy manhwa műfaj jellemzői, miért vonzó a koreai fantasy stílus, top ajánló általánosan ismert fantasy manhwa címekkel.
Formázás: HTML (h2, h3, p, ul/li). Legalább 5-6 cím rövid leírással.`
  },
  {
    slug: "manga-olvasas-kezdoknek-utmutato",
    title: "Manga olvasás kezdőknek – Teljes útmutató magyar olvasóknak",
    imagePrompt: "confused but curious beginner anime character holding a manga upside down, arrows showing right-to-left reading direction, manga panels around them",
    category: "ajanlo",
    tags: ["manga kezdőknek", "manga olvasás", "manga útmutató", "manga magyarul"],
    keywords: ["manga olvasás kezdőknek", "manga útmutató", "hogyan olvassunk mangát"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű kezdőknek szóló útmutató blogbejegyzést a Padlizsán Fansub weboldalra.
Téma: hogyan kell mangát olvasni (jobbról balra), mi az a tankōbon, chapter, volume, panel, speech bubble, miféle műfajok léteznek, hol kezdje egy kezdő (javasolt első mangák/manhwák), hogyan működik a Padlizsán Fansub oldala.
Formázás: HTML (h2, h3, p, ul/li). Legyen benne FAQ szekció.`
  },
  {
    slug: "legjobb-isekai-manga-manhwa-magyarul",
    title: "A legjobb isekai manga és manhwa – Top 10 ajánló magyar olvasóknak",
    category: "ajanlo",
    tags: ["isekai manga", "isekai manhwa", "manga ajánló", "manhwa ajánló", "isekai magyarul"],
    keywords: ["legjobb isekai manga", "isekai manhwa magyarul", "top isekai ajánló"],
    prompt: `Írj egy 1400-1600 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb isekai manga és manhwa címekről.
Téma: mi az az isekai műfaj és miért ilyen népszerű, a legjobb isekai mangák és manhwák részletes bemutatása (legalább 8-10 cím rövid leírással, miért érdemes olvasni, miben egyedi), az isekai különböző típusai (fantasy világ, játék világ, reinkarnáció, iskolaváltás).
A bemutatott títusok legyenek széles körben ismertek, ne csak egyet-kettőt emelj ki.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne egy "Mivel kezdjem?" ajánló és FAQ szekció.`
  },
  {
    slug: "dark-fantasy-manga-manhwa-ajanlok",
    title: "Dark fantasy manga és manhwa ajánlók – A legsötétebb, legjobb képregények",
    category: "ajanlo",
    tags: ["dark fantasy manga", "dark fantasy manhwa", "sötét manga", "dark manga", "manga ajánló"],
    keywords: ["dark fantasy manga magyarul", "sötét manga ajánló", "dark manhwa", "legjobb dark fantasy manga"],
    prompt: `Írj egy 1400-1600 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb dark fantasy manga és manhwa címekről.
Téma: mi a dark fantasy műfaj (horror elemek, sötét világ, antihős főszereplők, erőszak, morális dilemmák), miért vonzó ez a stílus, top ajánló legalább 8-10 cím részletes bemutatásával (miért sötét, mi teszi különlegessé). Különbség a sima fantasy és a dark fantasy között.
Megemlítendő típusok: dämon vadász, apokaliptikus világ, sötét isekai, horror elemekkel teli fantasy.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne figyelmeztetés hogy ez nem kezdőknek szóló stílus, és FAQ szekció.`
  },
  {
    slug: "romantikus-manga-manhwa-ajanlok",
    title: "Romantikus manga és manhwa ajánlók – A legjobb szerelmes képregények",
    category: "ajanlo",
    tags: ["romantikus manga", "romantikus manhwa", "shoujo manga", "romance manhwa", "szerelmes manga"],
    keywords: ["romantikus manga magyarul", "romance manhwa ajánló", "shoujo manga", "legjobb szerelmes manga"],
    prompt: `Írj egy 1400-1600 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb romantikus manga és manhwa címekről.
Téma: a romantikus manga/manhwa műfaj bemutatása, különböző altípusok (shoujo, josei, romance-fantasy, school romance, office romance), miért annyira népszerű a manga romantika a nyugati romantikus könyvekhez képest. Top ajánló legalább 8-10 cím részletes bemutatásával.
Legyen szó a klasszikus shoujo mangákról és a modern koreai romance manhwákról is, és arról hogyan fejlődött a műfaj.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne "Neked való ez a műfaj?" szekció és FAQ.`
  },

  // ── MŰFAJI AJÁNLÓK (SEO bővítés) ──────────────────────────────────────────
  {
    slug: "shounen-manga-ajanlok-magyarul",
    title: "Shounen manga ajánlók – A legnépszerűbb akció-kalandos sorozatok magyarul",
    category: "ajanlo",
    tags: ["shounen manga", "shounen ajánló", "akció manga", "manga magyarul"],
    keywords: ["shounen manga magyarul", "legjobb shounen manga", "shounen ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a shounen manga műfajról.
Téma: mi jellemzi a shounen mangát (fiatal főhős, barátság-erőfeszítés-győzelem téma, akciódús történetvezetés), miért ez a legnépszerűbb műfaj világszerte, top 8-10 általánosan ismert cím rövid bemutatással, hogyan olvasható magyarul a Padlizsán Fansub-on.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "seinen-manga-ajanlok-magyarul",
    title: "Seinen manga ajánlók – Komolyabb, felnőttebb történetek magyarul",
    category: "ajanlo",
    tags: ["seinen manga", "seinen ajánló", "felnőtt manga", "manga magyarul"],
    keywords: ["seinen manga magyarul", "legjobb seinen manga", "seinen ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a seinen manga műfajról.
Téma: mi a seinen (felnőttebb közönségnek szóló, komplexebb témák és morális szürkeárnyalatok), miben más mint a shounen, top 8-10 cím rövid bemutatással.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "shoujo-manga-ajanlok-magyarul",
    title: "Shoujo manga ajánlók – A legszebb, érzelmes történetek magyarul",
    category: "ajanlo",
    tags: ["shoujo manga", "shoujo ajánló", "érzelmes manga"],
    keywords: ["shoujo manga magyarul", "legjobb shoujo manga"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a shoujo manga műfajról.
Téma: mi a shoujo műfaj (érzelmek, kapcsolatok, karakterfejlődés a középpontban, nem kizárólag romantika), miben más mint a szűkebb romantikus kategória, top ajánló cím lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "josei-manga-ajanlok-magyarul",
    title: "Josei manga ajánlók – Felnőtt nőknek szóló realisztikus történetek",
    category: "ajanlo",
    tags: ["josei manga", "josei ajánló", "felnőtt manga nőknek"],
    keywords: ["josei manga magyarul", "legjobb josei manga"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a josei manga műfajról.
Téma: mi a josei (felnőtt nézőpont, munkahelyi és kapcsolati realizmus), miben más mint a shoujo, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "sci-fi-manga-manhwa-ajanlok",
    title: "Sci-fi manga és manhwa ajánlók – Jövő, technológia és világűr magyarul",
    category: "ajanlo",
    tags: ["sci-fi manga", "sci-fi manhwa", "tudományos-fantasztikus manga"],
    keywords: ["sci-fi manga magyarul", "sci-fi manhwa ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb sci-fi manga és manhwa címekről.
Téma: sci-fi altípusok bemutatása (cyberpunk, űropera, disztópia, mesterséges intelligencia témák), top ajánló cím lista részletes bemutatással.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "horror-manga-ajanlok-magyarul",
    title: "Horror manga ajánlók – A legfélelmetesebb sorozatok magyarul",
    category: "ajanlo",
    tags: ["horror manga", "horror ajánló", "ijesztő manga"],
    keywords: ["horror manga magyarul", "legjobb horror manga"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb horror manga címekről.
Téma: horror manga jellemzői, pszichológiai vs testi horror közötti különbség, kiknek ajánlott ez a műfaj, top ajánló lista, rövid figyelmeztetés érzékeny olvasóknak.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "sport-manga-ajanlok-magyarul",
    title: "Sport manga ajánlók – Motiváló csapatjátékos történetek magyarul",
    category: "ajanlo",
    tags: ["sport manga", "sport ajánló", "csapatsport manga"],
    keywords: ["sport manga magyarul", "legjobb sport manga"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb sport mangákról.
Téma: sport manga jellemzői (csapatmunka, kitartás, verseny), különböző sportágak bemutatása mangákban, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "vigjatek-humoros-manga-ajanlok",
    title: "Vígjáték manga ajánlók – A legviccesebb, legjobb hangulatú sorozatok",
    category: "ajanlo",
    tags: ["vígjáték manga", "humoros manga", "comedy manga"],
    keywords: ["vicces manga magyarul", "humoros manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb vígjáték mangákról.
Téma: comedy manga altípusok (paródia, slapstick, romantikus vígjáték), miért jó kikapcsolódás, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "pszichologiai-thriller-manga-ajanlok",
    title: "Pszichológiai thriller manga ajánlók – Feszült, elgondolkodtató sztorik",
    category: "ajanlo",
    tags: ["pszichológiai manga", "thriller manga", "psychological manga"],
    keywords: ["pszichológiai thriller manga magyarul", "psychological manga ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb pszichológiai thriller mangákról.
Téma: mi jellemzi a pszichológiai thrillert (elmejátékok, megbízhatatlan elbeszélő, morális dilemmák), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "rejtely-nyomozos-manga-ajanlok",
    title: "Rejtélyes és nyomozós (mystery) manga ajánlók",
    category: "ajanlo",
    tags: ["mystery manga", "nyomozós manga", "rejtély manga"],
    keywords: ["nyomozós manga magyarul", "mystery manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb rejtélyes, nyomozós mangákról.
Téma: detective/mystery manga jellemzői, miért szeretik az olvasók a rejtvényes sztorikat, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "murim-cultivation-manhwa-ajanlok",
    title: "Murim és cultivation manhwa ajánlók – Koreai harcművész-fantasy világok",
    category: "ajanlo",
    tags: ["murim manhwa", "cultivation manhwa", "harcművész manhwa"],
    keywords: ["murim manhwa magyarul", "cultivation manhwa ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a murim és cultivation manhwákról.
Téma: mi a murim/cultivation műfaj (belső erő fejlesztése, harcművész klánok, erő-rangsor rendszerek), miért olyan népszerű az utóbbi években, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "rendszer-litrpg-manhwa-ajanlok",
    title: "Rendszer (System) és LitRPG manhwa ajánlók – Amikor a világ játékká válik",
    category: "ajanlo",
    tags: ["system manhwa", "litrpg manhwa", "game system manga"],
    keywords: ["system manhwa magyarul", "litrpg manga ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a "rendszer" (System) témájú manhwákról.
Téma: mi a rendszer-trópus (szintlépés, készségek, questek a valós vagy fantasy világban), miért annyira addiktív ez a formátum, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "regresszios-idohurok-manhwa-ajanlok",
    title: "Regressziós és időhurok manhwa ajánlók – Második esély a múltban",
    category: "ajanlo",
    tags: ["regresszió manhwa", "időhurok manga", "time loop manhwa"],
    keywords: ["regressziós manhwa magyarul", "időhurok manga ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a regressziós/időhurok témájú manhwákról.
Téma: mi a regresszió/time-loop trópus, miért vonzó (tudás előnye a múltban, bosszú, hibák kijavítása), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "bosszu-temaju-manga-manhwa-ajanlok",
    title: "Bosszú témájú manga és manhwa ajánlók – Amikor az igazság visszavág",
    category: "ajanlo",
    tags: ["bosszú manga", "revenge manhwa", "bosszú történet"],
    keywords: ["bosszú manga magyarul", "revenge manhwa ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a bosszú témájú manga és manhwa címekről.
Téma: a revenge trópus jellemzői, miért katartikus olvasmány ez sokaknak, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "gyenge-hosbol-erossa-manhwa-ajanlok",
    title: "Gyengéből erőssé váló hős manhwa ajánlók – Fejlődéstörténetek",
    category: "ajanlo",
    tags: ["fejlődés manhwa", "underdog manga", "erős főhős manhwa"],
    keywords: ["gyengéből erős hős manhwa magyarul"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a "gyengéből erőssé váló hős" trópusú manhwákról.
Téma: az underdog-from-weak-to-strong trópus vonzereje, edzés és fejlődés ábrázolása, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "akademia-varazsiskola-manga-ajanlok",
    title: "Akadémia és varázsiskola témájú manga és manhwa ajánlók",
    category: "ajanlo",
    tags: ["akadémia manga", "varázsiskola manhwa", "school magic manga"],
    keywords: ["varázsiskola manga magyarul", "akadémia manhwa ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra az akadémia/varázsiskola témájú mangákról és manhwákról.
Téma: a magic academy trópus jellemzői (rangsorolás, versenyek, barátságok, tanárok), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "hunter-vadaszos-manhwa-ajanlok",
    title: "Hunter és szörnyvadász manhwa ajánlók – Portálok és szörnyek világa",
    category: "ajanlo",
    tags: ["hunter manhwa", "szörnyvadász manga", "monster hunter manhwa"],
    keywords: ["hunter manhwa magyarul", "szörnyvadász manga ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a hunter/szörnyvadász témájú manhwákról.
Téma: a hunter-trópus jellemzői (portálok, rangsorolt vadászok, szörnyek elleni harc), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "gonosz-nonemuk-reinkarnacioja-manhwa",
    title: "Villainess reinkarnáció manhwa ajánlók – Amikor a gonosz nő a főszereplő",
    category: "ajanlo",
    tags: ["villainess manhwa", "gonosz nő reinkarnáció", "reinkarnáció manhwa"],
    keywords: ["villainess manhwa magyarul", "gonosz nő reinkarnációja manga"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a "reinkarnálódtam gonosz nőként" témájú manhwákról.
Téma: e trópus népszerűsége, miért szeretik az olvasók ezt a csavart nézőpontot (a "rossz karakter" lesz a hősnő), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "torony-maszos-manhwa-ajanlok",
    title: "Torony-mászós manhwa ajánlók – Szintenkénti próbatételek világa",
    category: "ajanlo",
    tags: ["torony manhwa", "tower climbing", "manhwa ajánló"],
    keywords: ["torony manhwa magyarul", "tower climbing manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a torony-mászós (tower climbing) témájú manhwákról.
Téma: a torony/dungeon-mászás trópus jellemzői (szintenkénti próbatételek, rejtélyes szervezők), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "zene-idol-temaju-manga-ajanlok",
    title: "Zenei és idol témájú manga ajánlók",
    category: "ajanlo",
    tags: ["zenei manga", "idol manga", "music manga"],
    keywords: ["idol manga magyarul", "zenei témájú manga ajánló"],
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a zenei/idol témájú mangákról.
Téma: music/idol manga altípusok (bandák, idol ipar, versenyek), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "gasztronomia-fozos-manga-ajanlok",
    title: "Gasztronómia és főzős témájú manga ajánlók",
    category: "ajanlo",
    tags: ["gasztronómia manga", "főzős manga", "cooking manga"],
    keywords: ["főzős manga magyarul", "gasztronómia manga ajánló"],
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a gasztronómia/főzés témájú mangákról.
Téma: cooking manga jellemzői (versenyek, receptek, ízek ábrázolása képi eszközökkel), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "vampir-temaju-manga-manhwa-ajanlok",
    title: "Vámpír témájú manga és manhwa ajánlók",
    category: "ajanlo",
    tags: ["vámpír manga", "vámpír manhwa", "vampire manga"],
    keywords: ["vámpír manga magyarul", "vámpír manhwa ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a vámpír témájú manga és manhwa címekről.
Téma: a vámpír-fantasy trópus jellemzői, altípusai (romantikus vámpír, sötét horror vámpír), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "zombie-apokalipszis-manga-manhwa",
    title: "Zombi és apokalipszis témájú manga és manhwa ajánlók",
    category: "ajanlo",
    tags: ["zombi manga", "apokalipszis manhwa", "túlélés manga"],
    keywords: ["zombi manga magyarul", "apokalipszis manhwa ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a zombi/apokalipszis témájú manga és manhwa címekről.
Téma: a post-apokaliptikus túlélés trópus, miért izgalmas ez a tematika, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "mecha-robot-manga-ajanlok",
    title: "Mecha és robot témájú manga ajánlók",
    category: "ajanlo",
    tags: ["mecha manga", "robot manga", "sci-fi mecha"],
    keywords: ["mecha manga magyarul", "robot manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a mecha/robot témájú mangákról.
Téma: a mecha műfaj jellemzői (pilóták, óriásrobotok, háborús témák), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "harcmuveszet-wuxia-manga-ajanlok",
    title: "Harcművészet és wuxia stílusú manga ajánlók",
    category: "ajanlo",
    tags: ["harcművészet manga", "wuxia manga", "martial arts manga"],
    keywords: ["harcművészet manga magyarul", "wuxia manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a harcművészet/wuxia stílusú mangákról.
Téma: a wuxia/martial arts trópus jellemzői (kínai gyökerek, becsület-kódex, harcosklánok), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "tortenelmi-korszakdrama-manhwa-ajanlok",
    title: "Történelmi és korszakdráma témájú manhwa ajánlók",
    category: "ajanlo",
    tags: ["történelmi manhwa", "korszakdráma manga", "period drama manhwa"],
    keywords: ["történelmi manhwa magyarul", "korszakdráma manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a történelmi/korszakdráma témájú manhwákról.
Téma: a historical/period drama trópus jellemzői (királyi udvar, politika, romantika történelmi háttérrel), top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "hetkoznapi-elet-slice-of-life-manga",
    title: "Hétköznapi élet (slice of life) manga ajánlók",
    category: "ajanlo",
    tags: ["slice of life manga", "hétköznapi élet manga", "nyugodt manga"],
    keywords: ["slice of life manga magyarul", "nyugtató manga ajánló"],
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a slice of life (hétköznapi élet) témájú mangákról.
Téma: a slice-of-life jellemzői (nyugodt tempó, hétköznapi pillanatok, karakterközpontúság), kiknek ajánlott, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "csaladi-drama-josei-manga-ajanlok",
    title: "Családi dráma témájú manga ajánlók",
    category: "ajanlo",
    tags: ["családi dráma manga", "josei dráma", "felnőtt dráma manga"],
    keywords: ["családi dráma manga magyarul"],
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a családi dráma témájú mangákról.
Téma: a family drama trópus jellemzői, realisztikus élethelyzetek ábrázolása, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "bl-manga-ajanlok-magyarul",
    title: "BL (Boys Love) manga ajánlók magyarul",
    category: "ajanlo",
    tags: ["BL manga", "boys love manga", "queer manga"],
    keywords: ["BL manga magyarul", "boys love manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a BL (Boys Love) manga műfajról.
Téma: mi a BL műfaj és altípusai, miért népszerű, top ajánló lista, tapintatos és befogadó hangnem.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "gl-manga-ajanlok-magyarul",
    title: "GL (Girls Love / Yuri) manga ajánlók magyarul",
    category: "ajanlo",
    tags: ["GL manga", "yuri manga", "girls love manga"],
    keywords: ["GL manga magyarul", "yuri manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a GL (Girls Love / Yuri) manga műfajról.
Téma: mi a GL/yuri műfaj és altípusai, top ajánló lista, tapintatos és befogadó hangnem.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },

  // ── LISTA / ÖSSZEHASONLÍTÓ POSZTOK (SEO bővítés) ──────────────────────────
  {
    slug: "legjobb-befejezett-manga-sorozatok",
    title: "Legjobb befejezett manga sorozatok, amiket egyszerre végig lehet olvasni",
    category: "ajanlo",
    tags: ["befejezett manga", "manga sorozat", "manga marathon"],
    keywords: ["befejezett manga sorozatok magyarul", "legjobb véget ért manga"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb befejezett manga sorozatokról.
Téma: miért jó a már véget ért sorozatokat választani (nincs várakozás, teljes ívű történet), top ajánló lista különböző műfajokból.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "legjobb-folyamatban-levo-manhwa-sorozatok",
    title: "Legjobb jelenleg is futó (ongoing) manhwa sorozatok",
    category: "ajanlo",
    tags: ["ongoing manhwa", "futó manhwa sorozat", "friss manhwa"],
    keywords: ["folyamatban lévő manhwa magyarul", "ongoing manhwa ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb jelenleg is futó manhwa sorozatokról.
Téma: mit jelent az ongoing sorozat, előnyei és hátrányai a befejezetthez képest, top ajánló lista aktívan frissülő címekből.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "legjobb-rovid-manga-egy-kotetes",
    title: "Legjobb rövid, egy-két kötetes mangák gyors olvasáshoz",
    category: "ajanlo",
    tags: ["rövid manga", "one-shot manga", "gyors olvasmány manga"],
    keywords: ["rövid manga magyarul", "one-shot manga ajánló"],
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a legjobb rövid, egy-két kötetes mangákról.
Téma: miért jók a rövid sorozatok kezdőknek vagy időhiányos olvasóknak, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "legjobb-hosszu-eposzi-manga-sorozatok",
    title: "Leghosszabb, legepikusabb manga sorozatok, amikbe érdemes belevágni",
    category: "ajanlo",
    tags: ["hosszú manga", "epikus manga sorozat", "long running manga"],
    keywords: ["leghosszabb manga magyarul", "epikus manga sorozat"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a leghosszabb, legepikusabb manga sorozatokról.
Téma: miért érdemes egy hosszú sorozatba belevágni, mire számíthat az olvasó, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "klasszikus-90-es-evek-mangai",
    title: "Klasszikus 90-es évekbeli mangák, amiket ma is érdemes olvasni",
    category: "ajanlo",
    tags: ["klasszikus manga", "90-es évek manga", "retro manga"],
    keywords: ["klasszikus manga magyarul", "90-es évek manga ajánló"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a klasszikus, 90-es évekbeli mangákról.
Téma: mit adott a 90-es évek a manga világnak, miért állja ki az idő próbáját ez a korszak, top ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "legjobb-2020-as-evek-webtoon-manhwai",
    title: "A 2020-as évek legjobb új webtoon és manhwa sorozatai",
    category: "ajanlo",
    tags: ["új manhwa", "2020-as évek manhwa", "webtoon 2020"],
    keywords: ["legjobb új manhwa magyarul", "friss webtoon ajánló"],
    prompt: `Írj egy 1300-1500 szavas magyar nyelvű ajánló blogbejegyzést a Padlizsán Fansub weboldalra a 2020-as évek legjobb új webtoon és manhwa sorozatairól.
Téma: mi változott a webtoon-korszakban (formátum, kiadási ütem, művészi stílus), top friss ajánló lista.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "manga-vs-light-novel-kulonbseg",
    title: "Manga vs light novel – Mi a különbség és melyiket válasszuk?",
    category: "ajanlo",
    tags: ["manga vs light novel", "light novel magyarul", "manga adaptáció"],
    keywords: ["manga vagy light novel", "light novel különbség manga"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű összehasonlító blogbejegyzést a Padlizsán Fansub weboldalra a manga és a light novel közötti különbségről.
Téma: mi a light novel, hogyan válik belőle manga adaptáció, előnyök és hátrányok mindkét formátumnál.
Formázás: HTML (h2, h3, p, ul/li, table). Legyen benne FAQ szekció.`
  },
  {
    slug: "webtoon-vs-hagyomanyos-manga-format",
    title: "Webtoon vs hagyományos manga formátum – Függőleges vagy oldalankénti olvasás?",
    category: "ajanlo",
    tags: ["webtoon formátum", "manga formátum", "vertical scroll manga"],
    keywords: ["webtoon vs manga formátum", "függőleges olvasás manga"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű összehasonlító blogbejegyzést a Padlizsán Fansub weboldalra a webtoon és a hagyományos manga formátum különbségéről.
Téma: formai különbségek (színes vs fekete-fehér, függőleges görgetés vs oldalpár), olvasói élmény összehasonlítása.
Formázás: HTML (h2, h3, p, ul/li, table). Legyen benne FAQ szekció.`
  },
  {
    slug: "digitalis-vs-nyomtatott-manga",
    title: "Digitális vs nyomtatott manga – Melyik éri meg jobban?",
    category: "ajanlo",
    tags: ["digitális manga", "nyomtatott manga", "manga gyűjtés"],
    keywords: ["digitális manga magyarul", "nyomtatott manga vs digitális"],
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű összehasonlító blogbejegyzést a Padlizsán Fansub weboldalra a digitális és a nyomtatott manga közötti különbségről.
Téma: előnyök-hátrányok mindkét oldalon (hozzáférhetőség, gyűjtői érték, ár, kényelem).
Formázás: HTML (h2, h3, p, ul/li, table). Legyen benne FAQ szekció.`
  },
  {
    slug: "manga-vs-anime-mivel-kezdjem",
    title: "Manga vagy anime – Melyikkel érdemes kezdeni egy sorozatot?",
    category: "ajanlo",
    tags: ["manga vs anime", "anime vagy manga", "sorozat kezdés"],
    keywords: ["manga vagy anime melyik jobb", "anime vs manga különbség"],
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű összehasonlító blogbejegyzést a Padlizsán Fansub weboldalra arról, hogy mangával vagy animével érdemesebb kezdeni egy sorozatot.
Téma: fő különbségek (tempó, részletesség, adaptációs hűség), mikor jobb az egyik vagy a másik, említsd meg hogy a Padlizsán Fansub-on anime feliratok is elérhetők.
Formázás: HTML (h2, h3, p, ul/li, table). Legyen benne FAQ szekció.`
  },

  // ── GYAKORLATI ÚTMUTATÓK / SAJÁT FUNKCIÓK (SEO + konverzió) ───────────────
  {
    slug: "manga-szotar-alapfogalmak-magyarazata",
    title: "Manga szótár – Alapfogalmak magyarázata kezdőknek",
    category: "forditas",
    tags: ["manga szótár", "manga fogalmak", "manga terminológia"],
    keywords: ["manga fogalmak magyarul", "manga szótár kezdőknek"],
    imagePrompt: "open dictionary book with manga-style illustrations and Japanese terms floating around it, anime character pointing at definitions, educational scene",
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra egy manga-fogalmakat magyarázó szótár formájában.
Téma: gyűjtsd össze és magyarázd el egyszerűen a leggyakoribb fogalmakat (tankōbon, raw, scanlation, chapter, volume, panel, mangaka, fansub, license, hiatus stb.), miért fontos ezeket ismerni egy magyar olvasónak.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "hogyan-jelents-hibat-forditasban",
    title: "Hogyan jelents hibát vagy elírást egy fejezetben?",
    category: "forditas",
    tags: ["hibabejelentés", "fordítási hiba", "manga hibajavítás"],
    keywords: ["hogyan jelents hibát manga fordításban", "elírás bejelentése"],
    imagePrompt: "anime character pointing at a magnifying glass over manga text with a small red underline highlighting an error, helpful and constructive mood",
    prompt: `Írj egy 1000-1200 szavas magyar nyelvű útmutató blogbejegyzést a Padlizsán Fansub weboldalra a hibabejelentés funkcióról.
Téma: mutasd be lépésről lépésre a bug report funkciót az olvasóban (gomb, mit érdemes megadni: kép, fejezet, hiba típusa), miért fontos a közösségi visszajelzés a fordítás minőségéhez.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "padlicrome-forditoeszkoz-bemutatasa",
    title: "Mi az a PadliCrome? – Az AI-alapú fordítóeszközünk bemutatása",
    category: "forditas",
    tags: ["PadliCrome", "AI fordítás", "manga fordítóeszköz"],
    keywords: ["PadliCrome bemutatása", "AI manga fordító eszköz"],
    imagePrompt: "anime character sitting at a computer with manga translation software interface visible on screen, speech bubbles being translated in real time, tech-savvy scene",
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra a PadliCrome fordítóeszköz bemutatásáról.
Téma: mutasd be a funkciókat (fejezet importálása URL-ről vagy az olvasóból, gépi fordítás, panel-összefűzés, hibajavítás közvetlen beküldése), miért segíti ez a fordítói csapat munkáját, hogyan kapcsolódhat hozzá bárki.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "hogyan-legyel-fordito-onkentes-fansubnal",
    title: "Hogyan legyél fordító vagy feltöltő önkéntes egy magyar fansubnál?",
    category: "forditas",
    tags: ["fordító önkéntes", "fansub csatlakozás", "manga fordító lenni"],
    keywords: ["hogyan legyek manga fordító", "fansub önkéntes csatlakozás"],
    imagePrompt: "group of anime characters collaborating around a table with manga pages and laptops, teamwork atmosphere, warm inviting mood",
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra arról, hogyan lehet önkéntes fordító vagy feltöltő egy magyar fansubnál.
Téma: milyen szerepek vannak egy fansub csapatban (fordító, lektor, tipográfus, feltöltő), milyen készségek kellenek, hogyan lehet jelentkezni (Discord), mit ad ez a tapasztalat.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "anilist-szinkronizacio-utmutato",
    title: "AniList szinkronizáció beállítása – Kövesd az olvasási előrehaladásodat",
    category: "kozosseg",
    tags: ["AniList", "AniList szinkron", "olvasási előrehaladás"],
    keywords: ["AniList szinkronizáció beállítása", "AniList manga követés"],
    imagePrompt: "anime character checking a progress tracker app on a tablet with manga covers and checkmarks, organized and satisfied expression",
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű útmutató blogbejegyzést a Padlizsán Fansub weboldalra az AniList szinkronizációról.
Téma: mi az az AniList, hogyan kapcsold össze a Padlizsán Fansub fiókoddal, mit csinál a szinkron (fejezet-előrehaladás automatikus frissítése), mi történik ha eltérés van a két oldal között.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "anime-feliratok-magyar-forditas-utmutato",
    title: "Anime feliratok magyarul – Hogyan tölts le és keress feliratot?",
    category: "kozosseg",
    tags: ["anime feliratok", "magyar felirat", "srt felirat anime"],
    keywords: ["anime felirat magyarul", "hol tölthetek le anime feliratot"],
    imagePrompt: "anime character watching a show on a laptop with visible subtitle text at the bottom of the screen, cozy evening setting",
    prompt: `Írj egy 1200-1400 szavas magyar nyelvű útmutató blogbejegyzést a Padlizsán Fansub weboldalra az anime-felirat katalógusról.
Téma: mutasd be a katalógust (.srt/.ass fájlok, cím/évad/rész struktúra), hogyan lehet keresni és letölteni egy feliratot, hogyan kérhető új fordítás Gemini API kulcs felajánlásával.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "pontrendszer-ranglista-bemutatasa",
    title: "Pontrendszer és ranglista – Így jutalmazzuk a közösség aktív tagjait",
    category: "kozosseg",
    tags: ["pontrendszer", "ranglista", "leaderboard manga oldal"],
    keywords: ["Padlizsán Fansub pontrendszer", "manga oldal ranglista"],
    imagePrompt: "anime character standing proudly on a podium holding a trophy, leaderboard scoreboard visible in the background, celebratory mood",
    prompt: `Írj egy 1100-1300 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra a pontrendszer és ranglista funkcióról.
Téma: hogyan lehet pontot szerezni (hibajelentés, fordítás segítése, aktivitás), mire válthatók be a pontok, hogyan működik a ranglista, miért motiváló ez a rendszer.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "szavazasok-kovetkezo-forditas-valasztas",
    title: "Szavazások – Így dönt a közösség, mi legyen a következő fordítás",
    category: "kozosseg",
    tags: ["szavazás", "közösségi döntés", "következő manga fordítás"],
    keywords: ["Padlizsán Fansub szavazás", "manga fordítás szavazás"],
    imagePrompt: "group of anime characters raising hands to vote, poll options displayed on a large screen behind them, democratic community scene",
    prompt: `Írj egy 1000-1200 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra a szavazás funkcióról.
Téma: hogyan működik a szavazás (jelöltek, szavazási időszak, eredmény), miért fontos hogy a közösség dönthessen a következő fordításról, hogyan lehet javaslatot tenni egy címre.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "patreon-tamogatoi-rendszer-bemutatasa",
    title: "Patreon támogatói rendszer – Korai hozzáférés és extra tartalmak",
    category: "kozosseg",
    tags: ["Patreon", "támogatói rendszer", "korai hozzáférés manga"],
    keywords: ["Padlizsán Fansub Patreon", "korai hozzáférésű fejezetek"],
    imagePrompt: "anime character happily unlocking a treasure chest full of manga volumes with a golden key, reward and gratitude theme",
    prompt: `Írj egy 1000-1200 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra a Patreon támogatói rendszerről.
Téma: mit kapnak a Patreon támogatók (korai hozzáférés, extra tartalmak), miért van szükség támogatásra egy ingyenes fansub fenntartásához, hogyan lehet csatlakozni.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
  {
    slug: "ingyenes-manga-olvasas-miert-ingyenes",
    title: "Miért ingyenes a manga olvasás a Padlizsán Fansub-on?",
    category: "kozosseg",
    tags: ["ingyenes manga", "fansub finanszírozás", "manga olvasás ingyen"],
    keywords: ["ingyenes manga magyarul", "miért ingyenes a fansub"],
    imagePrompt: "anime character generously offering an open manga book to a group of grateful friends, warm giving atmosphere, no monetary symbols",
    prompt: `Írj egy 1000-1200 szavas magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra arról, miért ingyenes a manga olvasás az oldalon.
Téma: a fansub-kultúra alapelve (rajongói, nonprofit fordítás), hogyan finanszírozza magát az oldal (önkéntesek, opcionális támogatás), mi a különbség egy hivatalos kiadóhoz képest, rövid etikai szempontok.
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció.`
  },
];

// ── BORÍTÓKÉP MENTÉS (uploads/blog-covers/ — statikusan tálalt Express által) ─
function saveCoverLocally(slug, imageBuffer) {
  if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(COVERS_DIR, `${slug}.png`), imageBuffer);
  return `/uploads/blog-covers/${slug}.png`;
}

// ── SLUG SLUGIFY ─────────────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase()
    .replace(/[áà]/g, "a").replace(/[éè]/g, "e").replace(/[íì]/g, "i")
    .replace(/[óöőô]/g, "o").replace(/[úüűû]/g, "u")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── FŐ GENERÁTOR ─────────────────────────────────────────────────────────────
export async function generateBlogPost(topicIndex = null, customTopic = null) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY nincs beállítva a .env fájlban");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Következő feldolgozatlan téma kiválasztása
  let topic;
  if (customTopic) {
    topic = customTopic;
  } else if (topicIndex !== null) {
    topic = BLOG_TOPICS[topicIndex];
  } else {
    // Megnézzük melyik slug nem létezik még
    const { rows: existing } = await pool.query(
      "SELECT slug FROM blog_posts WHERE slug = ANY($1)",
      [BLOG_TOPICS.map(t => t.slug)]
    );
    const existingSlugs = new Set(existing.map(r => r.slug));
    topic = BLOG_TOPICS.find(t => !existingSlugs.has(t.slug));
    if (!topic) {
      console.log("Minden előre definiált téma már létezik a blogban.");
      return null;
    }
  }

  console.log(`[BlogGen] Generálás: "${topic.title}"`);

  // 1. Tartalom generálás GPT-4o-val
  const contentResp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "Te egy SEO-specialista magyar szövegíró vagy. Manga és manhwa témában írsz blogbejegyzéseket a Padlizsán Fansub weboldalra. A szövegeid természetesek, információgazdagok, és jól optimalizáltak keresőmotorokra. Csak HTML tartalmat adj vissza (h2, h3, p, ul, li, strong tagek), wrapper nélkül."
      },
      { role: "user", content: topic.prompt }
    ],
    temperature: 0.7,
    max_tokens: 3000,
  });

  const content = contentResp.choices[0].message.content;

  // Excerpt kinyerése az első <p> tagből
  const excerptMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  const excerpt = excerptMatch
    ? excerptMatch[1].replace(/<[^>]*>/g, "").slice(0, 200).trim()
    : topic.title;

  // 2. Képprompt összeállítása
  let imagePromptFull;
  if (topic.category === "ajanlo") {
    // Ajánló poszt: GPT-4o kitalálja a stílust a cikkben szereplő mangák alapján, színesen
    const imgPromptResp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You write image generation prompts for manga blog covers. Given a blog post, write ONE detailed English prompt (3-5 sentences) for a wide banner illustration. ONLY use a colorful, stylized approach if the post discusses well-known manga/manhwa titles with a recognizable and distinct visual style (e.g. Solo Leveling, Berserk, shoujo romance). In that case, mirror their actual color palette, mood, and characteristic visual elements. If the post is general or the titles don't have a strong distinct visual identity, default to: black and white manga pencil sketch on white background, clean confident line art, sketchbook aesthetic with light hatching, no color. No text, no watermarks, wide 3:2 landscape format."
        },
        {
          role: "user",
          content: `Blog post (Hungarian):\n${content.replace(/<[^>]*>/g, " ").slice(0, 2000)}\n\nWrite an image prompt that captures the visual style of the manga/manhwa titles discussed.`
        }
      ],
      temperature: 0.8,
      max_tokens: 200,
    });
    imagePromptFull = imgPromptResp.choices[0].message.content.trim();
    console.log(`[BlogGen] Képprompt (színes): ${imagePromptFull}`);
  } else {
    // Nem ajánló: ceruzarajz stílus
    const subject = topic.imagePrompt || "anime characters reading manga books";
    imagePromptFull = `Black and white manga pencil sketch on white background. Clean confident line art, anime/manga style, sketchbook aesthetic with light hatching. No color, no text, no watermarks, wide horizontal banner. Subject: ${subject}`;
  }

  // 3. Borítókép generálás
  let coverUrl = null;
  try {
    const imageResp = await openai.images.generate({
      model: "gpt-image-1",
      prompt: imagePromptFull,
      size: "1536x1024",
      quality: "medium",
      n: 1,
    });

    const imgData = imageResp.data[0];
    const imgBuffer = imgData.b64_json
      ? Buffer.from(imgData.b64_json, "base64")
      : Buffer.from(await (await fetch(imgData.url)).arrayBuffer());
    coverUrl = saveCoverLocally(topic.slug, imgBuffer);
    console.log(`[BlogGen] Borítókép feltöltve: ${coverUrl}`);
  } catch (err) {
    console.warn(`[BlogGen] Borítókép generálás sikertelen (folytatás kép nélkül): ${err.message}`);
  }

  // 3. DB mentés
  const { rows } = await pool.query(
    `INSERT INTO blog_posts (slug, title, excerpt, content, cover_url, category, tags, author, published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     ON CONFLICT (slug) DO NOTHING
     RETURNING *`,
    [
      topic.slug,
      topic.title,
      excerpt,
      content,
      coverUrl,
      topic.category || "ajanlo",
      topic.tags || [],
      "Padlizsán Fansub",
    ]
  );

  if (!rows.length) {
    console.log(`[BlogGen] Slug már létezik, kihagyva: ${topic.slug}`);
    return null;
  }

  // 4. Statikus HTML generálás
  await generateStaticPost(topic.slug);
  console.log(`[BlogGen] Kész: /blog/${topic.slug}.html`);

  return rows[0];
}

// ── CLI MÓD: node server/scripts/blog-auto-generator.js ─────────────────────
if (process.argv[1] && process.argv[1].endsWith("blog-auto-generator.js")) {
  const idx = process.argv[2] ? parseInt(process.argv[2]) : null;
  generateBlogPost(idx)
    .then(post => {
      if (post) console.log("Létrehozva:", post.slug);
      process.exit(0);
    })
    .catch(err => {
      console.error("Hiba:", err.message);
      process.exit(1);
    });
}
