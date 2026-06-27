// server/routes/blog.js
import express from "express";
import { pool } from "../db.js";
import { generateStaticPost, regenerateIndex } from "../blog-static-generator.js";

const router = express.Router();

/* ── DB TÁBLA LÉTREHOZÁS (ha még nem létezik) ─────────────
   Futtasd egyszer a szerveren:

   CREATE TABLE IF NOT EXISTS blog_posts (
     id          SERIAL PRIMARY KEY,
     slug        TEXT UNIQUE NOT NULL,
     title       TEXT NOT NULL,
     excerpt     TEXT,
     content     TEXT,
     cover_url   TEXT,
     category    TEXT DEFAULT 'hir',  -- ajanlo | hir | forditas | kozosseg
     tags        TEXT[],
     author      TEXT,
     published   BOOLEAN DEFAULT false,
     created_at  TIMESTAMPTZ DEFAULT NOW(),
     updated_at  TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX IF NOT EXISTS blog_slug_idx    ON blog_posts(slug);
   CREATE INDEX IF NOT EXISTS blog_cat_idx     ON blog_posts(category);
   CREATE INDEX IF NOT EXISTS blog_pub_idx     ON blog_posts(published, created_at DESC);
─────────────────────────────────────────────────────────── */

/* ── GET /api/blog – lista ──────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT id, slug, title, excerpt, cover_url, category, tags, author, created_at, updated_at
      FROM blog_posts
      WHERE published = true
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    params.push(parseInt(limit));
    params.push(parseInt(offset));
    query += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Blog list error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── ADMIN: TÉMAJAVASLATOK (/:slug elé kell kerülnie!) ───── */
router.get("/suggest-topics", requireAdmin, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "OPENAI_API_KEY nincs beállítva" });
    }
    const { rows: existing } = await pool.query("SELECT slug FROM blog_posts");
    const existingSlugs = existing.map(r => r.slug);

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Te egy SEO-specialista vagy, aki egy magyar manga/manhwa fordítói platform (Padlizsán Fansub) blogját kezeli.
Generálj pontosan 20 blogposzt-javaslatot JSON tömbként, a legjobb magyar Google keresési szándékok alapján.
Minden elem tartalmazza:
- title: vonzó magyar cím
- slug: URL-barát slug (kisbetű, kötőjel)
- primaryKeyword: a legfontosabb célzott kulcsszó
- secondaryKeywords: 2-3 másodlagos kulcsszó tömbként
- searchPriority: 1-5 skálán (5=legmagasabb keresési volumen)
- category: "ajanlo" | "hir" | "forditas" | "kozosseg"
- intent: rövid leírás miért keresnék erre (1 mondat)

Priorizáld ezeket a magas keresési volumenű kulcsszavakat:
manga magyarul, manhwa magyarul, magyar manga, magyar manhwa, manga olvasás, manhwa olvasás,
manga hu, magyar fansub, manga fordítás, manhwa fordítás, manga online, ingyenes manga,
isekai manga, shoujo manga, seinen manga, webtoon magyarul, manga ajánló, manhwa ajánló,
manga kezdőknek, manga műfajok, legjobb manga, legjobb manhwa, manga sorozat, manhwa sorozat,
akció manga, romantikus manga, fantasy manga, horror manga, dark fantasy manga

Kerüld ezeket a már létező slugokat: ${existingSlugs.join(", ")}

Válaszolj CSAK valid JSON tömbben, semmi más szöveg.`
        },
        {
          role: "user",
          content: "Generálj 20 SEO-optimalizált blogposzt-javaslatot a Padlizsán Fansub weboldalra, keresési volumen szerint csökkenő sorrendben."
        }
      ],
      temperature: 0.7,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const raw = resp.choices[0].message.content;
    const parsed = JSON.parse(raw);
    const suggestions = Array.isArray(parsed) ? parsed : parsed.topics || parsed.suggestions || Object.values(parsed)[0];
    res.json(suggestions.slice(0, 20));
  } catch (err) {
    console.error("suggest-topics hiba:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── ADMIN: TÉMÁK LISTÁJA (/:slug elé kell kerülnie!) ───── */
router.get("/auto-topics", requireAdmin, async (req, res) => {
  try {
    const { BLOG_TOPICS } = await import("../scripts/blog-auto-generator.js");
    const { rows } = await pool.query(
      "SELECT slug FROM blog_posts WHERE slug = ANY($1)",
      [BLOG_TOPICS.map(t => t.slug)]
    );
    const existingSlugs = new Set(rows.map(r => r.slug));
    res.json(BLOG_TOPICS.map((t, i) => ({
      index: i,
      slug: t.slug,
      title: t.title,
      category: t.category,
      exists: existingSlugs.has(t.slug),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/blog/:slug – egyedi bejegyzés ────────────── */
router.get("/:slug", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM blog_posts WHERE slug = $1 AND published = true`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: "Nem található" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Blog post error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── POST /api/blog – új bejegyzés (csak admin) ─────────── */
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { slug, title, excerpt, content, cover_url, category, tags, author, published } = req.body;

    if (!slug || !title) return res.status(400).json({ error: "slug és title kötelező" });

    const { rows } = await pool.query(
      `INSERT INTO blog_posts (slug, title, excerpt, content, cover_url, category, tags, author, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [slug, title, excerpt||null, content||null, cover_url||null,
       category||"hir", tags||null, author||null, published||false]
    );
    const post = rows[0];
    res.status(201).json(post);
    // Statikus HTML generálás közzétételkor
    if (post.published) generateStaticPost(post.slug).catch(console.error);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ez a slug már létezik" });
    console.error("Blog create error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── PUT /api/blog/:slug – szerkesztés (csak admin) ────── */
router.put("/:slug", requireAdmin, async (req, res) => {
  try {
    const { title, excerpt, content, cover_url, category, tags, author, published } = req.body;

    const { rows } = await pool.query(
      `UPDATE blog_posts SET
         title=$1, excerpt=$2, content=$3, cover_url=$4,
         category=$5, tags=$6, author=$7, published=$8,
         updated_at=NOW()
       WHERE slug=$9 RETURNING *`,
      [title, excerpt||null, content||null, cover_url||null,
       category||"hir", tags||null, author||null,
       published !== undefined ? published : false,
       req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: "Nem található" });
    const updated = rows[0];
    res.json(updated);
    // Statikus HTML újragenerálás – közzétett vagy visszavont poszt esetén is
    generateStaticPost(updated.slug).catch(console.error);
  } catch (err) {
    console.error("Blog update error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

/* ── DELETE /api/blog/:slug – törlés (csak admin) ──────── */
router.delete("/:slug", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM blog_posts WHERE slug=$1`, [req.params.slug]
    );
    if (!rowCount) return res.status(404).json({ error: "Nem található" });
    res.json({ ok: true });
    // Törölt poszt statikus fájljának törlése + index frissítés
    generateStaticPost(req.params.slug).catch(console.error);
  } catch (err) {
    console.error("Blog delete error:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});


/* ── ADMIN: AI BLOG POSZT GENERÁLÁS EGYEDI TÉMÁVAL ──────── */
router.post("/auto-generate-custom", requireAdmin, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "OPENAI_API_KEY nincs beállítva" });
    }
    const { title, slug, primaryKeyword, secondaryKeywords, category } = req.body;
    if (!title || !slug) return res.status(400).json({ error: "title és slug kötelező" });

    res.json({ ok: true, message: "Generálás elindítva..." });

    const { generateBlogPost } = await import("../scripts/blog-auto-generator.js");
    const customTopic = {
      slug, title, category: category || "ajanlo",
      tags: [primaryKeyword, ...(secondaryKeywords || [])].filter(Boolean),
      prompt: `Írj egy 1400-1600 szavas, SEO-optimalizált magyar nyelvű blogbejegyzést a Padlizsán Fansub weboldalra.
Cím: "${title}"
Elsődleges kulcsszó (természetesen szerepeljen többször): ${primaryKeyword}
Másodlagos kulcsszavak: ${(secondaryKeywords || []).join(", ")}
Formázás: HTML (h2, h3, p, ul/li, strong). Legyen benne FAQ szekció. Ne legyen html/body wrapper.`,
    };
    generateBlogPost(null, customTopic)
      .then(post => post && console.log(`[BlogAdmin] Egyedi poszt létrehozva: ${post.slug}`))
      .catch(err => console.error("[BlogAdmin] Egyedi generálás hiba:", err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── ADMIN: AI BLOG POSZT GENERÁLÁS ─────────────────────── */
// POST /api/blog/auto-generate          — következő téma automatikusan
// POST /api/blog/auto-generate?topic=2  — adott index kézzel
router.post("/auto-generate", requireAdmin, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "OPENAI_API_KEY nincs beállítva" });
    }
    const { generateBlogPost, BLOG_TOPICS } = await import("../scripts/blog-auto-generator.js");
    const topicIdx = req.query.topic !== undefined ? parseInt(req.query.topic) : null;
    res.json({ ok: true, message: "Generálás elindítva a háttérben..." });
    generateBlogPost(topicIdx)
      .then(post => post && console.log(`[BlogAdmin] Létrehozva: ${post.slug}`))
      .catch(err => console.error("[BlogAdmin] Generálás hiba:", err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ── ADMIN: ÖSSZES STATIKUS OLDAL ÚJRAGENERÁLÁSA ────────── */
router.post("/regenerate-static", requireAdmin, async (req, res) => {
  try {
    const { regenerateAllPosts } = await import("../blog-static-generator.js");
    const count = await regenerateAllPosts();
    res.json({ ok: true, count, message: count + " statikus blog oldal újragenerálva" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── ADMIN MIDDLEWARE ────────────────────────────────────── */
function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Nincs jogosultság" });
  }
  next();
}

export default router;
