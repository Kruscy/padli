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
export async function generateBlogPost(topicIndex = null) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY nincs beállítva a .env fájlban");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Következő feldolgozatlan téma kiválasztása
  let topic;
  if (topicIndex !== null) {
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
          content: "You write image generation prompts for manga blog covers. Given a blog post about specific manga/manhwa titles, write ONE detailed English prompt (3-5 sentences) for a wide banner illustration. The image must visually mirror the actual art style, color palette, and mood of the specific manga titles mentioned — use their characteristic visual elements (e.g. Solo Leveling's dark blue/purple shadows and glowing runes, shoujo romance's soft pastels and flower petals, dark fantasy's gritty desaturated tones, etc). No text, no watermarks, wide 3:2 landscape format."
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
