import express from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { getMangaById as getJikanMangaById, searchMangaByTitle as searchJikanByTitle } from "../lib/jikan.js";
import { getMangaById as getMangaDexMangaById, searchMangaByTitle as searchMangaDexByTitle } from "../lib/mangadex.js";
import { titlesMatch } from "../lib/title-match.js";

const router = express.Router();

/* ── Értesítés a kérőnek ÉS a lájkolóknak, ha egy admin claimeli/
   tervbe veszi a mangájukat (a saját magukat érintő eset kihagyva).
   buildMessage(username, title, reason) állítja elő a pontos, a
   claim/plan igének megfelelő magyar mondatot. ── */
export async function notifyWishlistWatchers(wishlistId, actingUser, type, buildMessage) {
  try {
    const { rows: wlRows } = await pool.query(
      `SELECT user_id, title FROM wishlist WHERE id = $1`, [wishlistId]
    );
    if (!wlRows.length) return;
    const { user_id: requesterId, title } = wlRows[0];

    const { rows: likeRows } = await pool.query(
      `SELECT DISTINCT user_id FROM wishlist_likes WHERE wishlist_id = $1`, [wishlistId]
    );
    const likerIds = likeRows.map(r => r.user_id);

    const recipients = new Set([requesterId, ...likerIds].filter(Boolean));
    recipients.delete(actingUser.id);

    for (const recipientId of recipients) {
      const reason = recipientId === requesterId ? "amit te kértél" : "amit te lájkoltál";
      await pool.query(
        `INSERT INTO notifications (user_id, type, message, link)
         VALUES ($1, $2, $3, '/wishlist.html')`,
        [recipientId, type, buildMessage(actingUser.username, title, reason)]
      );
    }
  } catch (err) {
    console.error("wishlist notification error:", err);
  }
}

/* ================= ADD ================= */
router.post("/", requireLogin, async (req, res) => {
  try {
    const { url, source: bodySource, id: bodyId } = req.body;

    // Két hívási forma:
    //  1) { url: "https://anilist.co/manga/<id>" }                        — AniList (régi/kompatibilis)
    //  2) { source: "anilist"|"jikan"|"mangadex", id }                    — a kereső dropdown-ból, forrás-jelöléssel
    let source, sourceId;
    if (bodySource && bodyId) {
      source = bodySource;
      sourceId = String(bodyId);
    } else if (url && url.includes("anilist.co")) {
      const match = url.match(/anime\/(\d+)/) || url.match(/manga\/(\d+)/);
      if (!match) return res.status(400).json({ error: "Hibás link" });
      source = "anilist";
      sourceId = match[1];
    } else {
      return res.status(400).json({ error: "Csak AniList link vagy source+id" });
    }

    if (!["anilist", "jikan", "mangadex"].includes(source)) {
      return res.status(400).json({ error: "Ismeretlen forrás" });
    }

    const anilistId = source === "anilist" ? sourceId : null;
    const malId = source === "jikan" ? sourceId : null;
    const mangadexId = source === "mangadex" ? sourceId : null; // UUID string, nem szám

    // DUPLIKÁCIÓ CHECK — forrás-függetlenül: bármelyik meglévő tétel
    // egyezhet, akármelyik forrásból is került fel eredetileg, amíg a
    // kereszt-azonosítója (mal_id/mangadex_id) fel van töltve rajta
    // (l. server/scripts/backfill-wishlist-external-ids.js). Külön
    // paraméter forrásonként, mert a mangadex_id TEXT, az anilist_id/
    // mal_id INTEGER, egy közös paraméter típusütközést okozna.
    const exists = await pool.query(`
      SELECT id FROM wishlist
      WHERE (anilist_id  IS NOT NULL AND anilist_id  = $1)
         OR (mal_id      IS NOT NULL AND mal_id      = $2)
         OR (mangadex_id IS NOT NULL AND mangadex_id = $3)
    `, [
      anilistId ? parseInt(anilistId) : null,
      malId ? parseInt(malId) : null,
      mangadexId,
    ]);

    if (exists.rowCount) {
      const wishId = exists.rows[0].id;
      const userId = req.session.user.id;

      // megnézzük lájkolta-e már
      const liked = await pool.query(`
        SELECT 1 FROM wishlist_likes
        WHERE wishlist_id = $1 AND user_id = $2
      `, [wishId, userId]);

      if (liked.rowCount) {
        // már lájkolta
        return res.json({
          alreadyExists: true,
          alreadyLiked: true,
          message: "Már padlizsánoztad ezt a művet 🍆"
        });
      }

      // még nem lájkolta → auto like
      await pool.query(`
        INSERT INTO wishlist_likes (wishlist_id, user_id)
        VALUES ($1, $2)
      `, [wishId, userId]);

      return res.json({
        alreadyExists: true,
        alreadyLiked: false,
        message: "Már fent volt - kapott egy 🍆 tőled!"
      });
    }

    /* ===== Metaadat lekérés a forrás szerint ===== */
    let title, coverUrl, chapters;

    if (source === "anilist") {
      const query = `
        query ($id: Int) {
          Media(id: $id, type: MANGA) {
            id
            title { english romaji native }
            coverImage { large }
            chapters
          }
        }
      `;
      const api = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { id: parseInt(anilistId) } })
      });
      const json = await api.json();
      const m = json.data?.Media;
      if (!m) return res.status(400).json({ error: "Nem található" });

      title = m.title.english || m.title.romaji || m.title.native;
      coverUrl = m.coverImage?.large;
      chapters = m.chapters;
    } else if (source === "jikan") {
      const m = await getJikanMangaById(malId);
      if (!m) return res.status(400).json({ error: "Nem található" });

      title = m.title.english || m.title.romaji || m.title.native;
      coverUrl = m.coverImage.large || m.coverImage.extraLarge;
      chapters = m.chapters;
    } else {
      // source === "mangadex"
      const m = await getMangaDexMangaById(mangadexId);
      if (!m) return res.status(400).json({ error: "Nem található" });

      title = m.title.english || m.title.romaji || m.title.native;
      coverUrl = m.coverImage.large || m.coverImage.extraLarge;
      chapters = m.chapters;
    }

    if (!title) return res.status(400).json({ error: "Nem található cím" });

    /* ===== Kereszt-azonosítók feltöltése (best effort) =====
       Amelyik forrásból nem jött az elsődleges adat, ott is megpróbáljuk
       cím alapján megtalálni a megfelelő ID-t, hogy a jövőbeli
       duplikáció-ellenőrzés forrás-függetlenül is működjön erre a
       tételre. Hiba esetén egyszerűen null marad — nem blokkolja a
       hozzáadást, legfeljebb a backfill script pótolja majd később. */
    let crossAnilistId = anilistId ? parseInt(anilistId) : null;
    let crossMalId = malId ? parseInt(malId) : null;
    let crossMangadexId = mangadexId;

    if (crossAnilistId == null) {
      try {
        const q = `query ($search: String) { Media(search: $search, type: MANGA) { id title { english romaji } } }`;
        const api = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, variables: { search: title } }),
        });
        const json = await api.json();
        const m = json.data?.Media;
        const matchTitle = m?.title?.english || m?.title?.romaji;
        if (m && titlesMatch(title, matchTitle)) crossAnilistId = m.id;
      } catch {}
    }
    if (crossMalId == null) {
      try {
        const m = await searchJikanByTitle(title);
        const matchTitle = m?.title?.english || m?.title?.romaji;
        if (m && titlesMatch(title, matchTitle)) crossMalId = m.id;
      } catch {}
    }
    if (crossMangadexId == null) {
      try {
        const m = await searchMangaDexByTitle(title);
        const matchTitle = m?.title?.english || m?.title?.romaji;
        if (m && titlesMatch(title, matchTitle)) crossMangadexId = m.id;
      } catch {}
    }

    const result = await pool.query(`
      INSERT INTO wishlist (user_id, anilist_id, mal_id, mangadex_id, source, title, cover_url, episodes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [
      req.session.user.id,
      crossAnilistId,
      crossMalId,
      crossMangadexId,
      source,
      title,
      coverUrl,
      chapters
    ]);

    res.json(result.rows[0]);

  } catch (err) {
    console.error("WISHLIST ADD ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= LIST ================= */
router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;

  const { rows } = await pool.query(`
    SELECT
      w.*,
      u.username,

      COUNT(DISTINCT wl.user_id) AS likes_count,
      COALESCE(BOOL_OR(wl.user_id = $1), false) AS liked_by_me,

      -- Claim (dolgozik rajta)
      COALESCE(
        JSON_AGG(
          DISTINCT jsonb_build_object(
            'id', cu.id,
            'username', cu.username
          )
        ) FILTER (WHERE cu.id IS NOT NULL),
        '[]'
      ) AS claimed_by,
      
      COALESCE(BOOL_OR(wc.user_id = $1), false) AS claimed_by_me,

      -- Planned (tervben van)
      COALESCE(
        JSON_AGG(
          DISTINCT jsonb_build_object(
            'id', pu.id,
            'username', pu.username
          )
        ) FILTER (WHERE pu.id IS NOT NULL),
        '[]'
      ) AS planned_by,
      
      COALESCE(BOOL_OR(wp.user_id = $1), false) AS planned_by_me

    FROM wishlist w
    JOIN users u ON u.id = w.user_id

    LEFT JOIN wishlist_likes wl ON wl.wishlist_id = w.id
    LEFT JOIN wishlist_claims wc ON wc.wishlist_id = w.id
    LEFT JOIN users cu ON cu.id = wc.user_id
    
    LEFT JOIN wishlist_planned wp ON wp.wishlist_id = w.id
    LEFT JOIN users pu ON pu.id = wp.user_id

    GROUP BY w.id, u.username
    ORDER BY likes_count DESC, w.created_at DESC
  `, [userId]);
  
  res.json(rows);
});

/* ================= LIKE TOGGLE ================= */
router.post("/:id/like", requireLogin, async (req, res) => {
  const id = req.params.id;
  const userId = req.session.user.id;

  const exists = await pool.query(`
    SELECT 1 FROM wishlist_likes
    WHERE wishlist_id=$1 AND user_id=$2
  `, [id, userId]);

  if (exists.rowCount) {
    await pool.query(`
      DELETE FROM wishlist_likes
      WHERE wishlist_id=$1 AND user_id=$2
    `, [id, userId]);

    return res.json({ liked: false });
  }

  await pool.query(`
    INSERT INTO wishlist_likes (wishlist_id, user_id)
    VALUES ($1,$2)
  `, [id, userId]);

  res.json({ liked: true });
});

/* ================= CLAIM TOGGLE (Dolgozik rajta) ================= */
router.post("/:id/claim", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = req.params.id;

  const exists = await pool.query(`
    SELECT 1 FROM wishlist_claims
    WHERE wishlist_id=$1 AND user_id=$2
  `, [id, req.session.user.id]);

  if (exists.rowCount) {
    await pool.query(`
      DELETE FROM wishlist_claims
      WHERE wishlist_id=$1 AND user_id=$2
    `, [id, req.session.user.id]);

    return res.json({ claimed: false });
  }

  await pool.query(`
    INSERT INTO wishlist_claims (wishlist_id, user_id)
    VALUES ($1,$2)
  `, [id, req.session.user.id]);

  // Értesítés a kérőnek ÉS mindenkinek, aki lájkolta ezt a kívánságot.
  await notifyWishlistWatchers(id, req.session.user, "wishlist_claimed",
    (username, title, reason) => `🎬 ${username} elkezdte a(z) "${title}" fordítását, ${reason}!`
  );

  res.json({ claimed: true });
});

/* ================= PLAN TOGGLE (Tervben van) ================= */
router.post("/:id/plan", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = req.params.id;

  const exists = await pool.query(`
    SELECT 1 FROM wishlist_planned
    WHERE wishlist_id=$1 AND user_id=$2
  `, [id, req.session.user.id]);

  if (exists.rowCount) {
    await pool.query(`
      DELETE FROM wishlist_planned
      WHERE wishlist_id=$1 AND user_id=$2
    `, [id, req.session.user.id]);

    return res.json({ planned: false });
  }

  await pool.query(`
    INSERT INTO wishlist_planned (wishlist_id, user_id)
    VALUES ($1,$2)
  `, [id, req.session.user.id]);

  // Értesítés a kérőnek ÉS mindenkinek, aki lájkolta ezt a kívánságot.
  await notifyWishlistWatchers(id, req.session.user, "wishlist_planned",
    (username, title, reason) => `📋 ${username} tervbe vette a(z) "${title}" mangát, ${reason}!`
  );

  res.json({ planned: true });
});

/* ================= DELETE ================= */
router.delete("/:id", requireLogin, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  await pool.query(`DELETE FROM wishlist WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});
/* ================= FOR POLLS - UNCLAIMED RANDOM ================= */
router.get("/for-polls/unclaimed", requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const { limit = 10 } = req.query;

    const { rows } = await pool.query(`
      SELECT w.id, w.title, w.cover_url
      FROM wishlist w
      WHERE NOT EXISTS (
        SELECT 1 FROM wishlist_claims wc 
        WHERE wc.wishlist_id = w.id
      )
      ORDER BY RANDOM()
      LIMIT $1
    `, [parseInt(limit)]);

    res.json(rows);

  } catch (err) {
    console.error("FOR POLLS UNCLAIMED ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= FOR POLLS - ADMIN'S PLANNED ================= */
router.get("/for-polls/my-planned", requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const userId = req.session.user.id;
    const { limit = 10 } = req.query;

    const { rows } = await pool.query(`
      SELECT w.id, w.title, w.cover_url
      FROM wishlist w
      INNER JOIN wishlist_planned wp ON wp.wishlist_id = w.id
      WHERE wp.user_id = $1
      ORDER BY RANDOM()
      LIMIT $2
    `, [userId, parseInt(limit)]);

    res.json(rows);

  } catch (err) {
    console.error("FOR POLLS MY PLANNED ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
