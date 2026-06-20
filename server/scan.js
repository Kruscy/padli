import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { pool } from "./db.js";
import { scanMetadata } from "./metadata-scan.js";
import { setNewMangaCache } from "./cache/new-manga.js";
import { Client, GatewayIntentBits } from "discord.js";
import sharp from "sharp";
import https from "https";
import http from "http";
import { AttachmentBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

/* ================= LOCK ================= */

const LOCK = "/tmp/padlizsanfansub.scan.lock";

if (fs.existsSync(LOCK)) {
  console.log("⏳ Scan already running, exiting");
  process.exit(0);
}

fs.writeFileSync(LOCK, process.pid.toString());

const cleanup = () => {
  if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

/* ================= HELPERS ================= */

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isImage(file) {
  return /\.(jpg|jpeg|png|webp)$/i.test(file);
}
function getChapterNumber(title) {
  const match = title.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}
/* ================= UNLOCK TIMES ================= */
const lockHours = parseInt(process.env.LOCK_HOURS || "24", 10);
async function setUnlockTimes() {
  console.log("⏰ Setting unlock times (skip first 15)...");

  const mangaRes = await pool.query(`SELECT id, slug FROM manga`);

  for (const manga of mangaRes.rows) {
    const res = await pool.query(
      `SELECT id, title, unlocks_at
       FROM chapter
       WHERE manga_id = $1`,
      [manga.id]
    );

    if (!res.rows.length) continue;

    // 🔢 szám kiszedése (utolsó szám + tizedes)
    function getChapterNumber(title) {
      const matches = title.match(/\d+(\.\d+)?/g);
      if (!matches) return 0;

      const last = matches[matches.length - 1];
      return parseFloat(last);
    }

    // 📊 rendezés
    const chapters = res.rows.sort(
      (a, b) => getChapterNumber(a.title) - getChapterNumber(b.title)
    );

    let lastUnlock = null;
    let updated = 0;

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];

      // 🟢 első 15 → mindig unlock
      if (i < 15) {
        if (!ch.unlocks_at || new Date(ch.unlocks_at) > new Date()) {
          await pool.query(
            `UPDATE chapter SET unlocks_at = now() - interval '1 second' WHERE id = $1`,
            [ch.id]
          );
        }

        lastUnlock = new Date(); // hogy a lánc innen induljon
        continue;
      }

      let newUnlock;

      if (ch.unlocks_at) {
        lastUnlock = new Date(ch.unlocks_at);
        continue;
      }

      const now = Date.now();
      if (!lastUnlock) {
        newUnlock = new Date(now + lockHours * 3600000);
      } else if (lastUnlock.getTime() < now) {
        // Az előző rész már feloldódott - ne ahhoz adjunk, hanem mosthoz
        newUnlock = new Date(now + lockHours * 3600000);
      } else {
        newUnlock = new Date(lastUnlock.getTime() + lockHours * 3600000);
      }

      await pool.query(
        `UPDATE chapter SET unlocks_at = $1 WHERE id = $2`,
        [newUnlock, ch.id]
      );

      lastUnlock = newUnlock;
      updated++;
    }

  }

  console.log("✅ Unlock times set!");
}

/* ================= LOAD LIBRARIES ================= */

const LIB_FILE = path.join(process.cwd(), "libraries.json");

if (!fs.existsSync(LIB_FILE)) {
  console.error("❌ libraries.json not found");
  process.exit(1);
}

const libraries = JSON.parse(fs.readFileSync(LIB_FILE, "utf8"))
  .filter(l => l.enabled && fs.existsSync(l.path));

/* ================= SCAN ================= */

const KAVITA_BASE = "/mnt/manga/Kavita";

async function buildUploaderRoots() {
  const { rows } = await pool.query(
    `SELECT name, root_path FROM uploader_names WHERE root_path IS NOT NULL AND root_path != ''`
  );
  return rows.map(r => ({
    name: r.name,
    base: r.root_path.startsWith("/") ? path.resolve(r.root_path) : path.join(KAVITA_BASE, r.root_path)
  }));
}

async function scan() {
  console.log("📚 Starting scan\n");
  const newChapters = {}; // slug -> { title, cover_url, slug, count }

  const uploaderRoots = await buildUploaderRoots();

  for (const lib of libraries) {
    console.log(`📂 Library: ${lib.name}`);
    console.log(`   Path: ${lib.path}`);

    const libRes = await pool.query(
      `
      INSERT INTO library (name, path, enabled)
      VALUES ($1, $2, true)
      ON CONFLICT (path) DO UPDATE SET enabled = true
      RETURNING id
      `,
      [lib.name, lib.path]
    );

    const libraryId = libRes.rows[0].id;

    let mangaDirs;
    try {
      mangaDirs = fs.readdirSync(lib.path, { withFileTypes: true })
        .filter(d => d.isDirectory());
    } catch (err) {
      console.error(`❌ Failed to read library dir: ${lib.path}`, err.message);
      continue;
    }

    for (const mangaDir of mangaDirs) {
      const mangaTitle = mangaDir.name;
      const mangaSlug = slugify(mangaTitle);
      const mangaPath = path.join(lib.path, mangaTitle);

      let mangaId;
      try {
        const mangaRes = await pool.query(
          `
          INSERT INTO manga (title, slug, folder, library_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (slug, library_id) DO UPDATE
            SET folder = EXCLUDED.folder
          RETURNING id
          `,
          [mangaTitle, mangaSlug, mangaTitle, libraryId]
        );
        mangaId = mangaRes.rows[0].id;

        // Feltöltő auto-hozzárendelés root_path alapján
        for (const ur of uploaderRoots) {
          if (mangaPath.startsWith(ur.base + path.sep) || mangaPath === ur.base) {
            await pool.query(
              `UPDATE manga SET uploaders = array_append(COALESCE(uploaders, '{}'), $1)
               WHERE id = $2 AND NOT ($1 = ANY(COALESCE(uploaders, '{}')))`,
              [ur.name, mangaId]
            );
            break;
          }
        }
      } catch (err) {
        console.error(`❌ DB error (manga): ${mangaTitle}`, err.message);
        continue;
      }

      let chapterDirs;
      try {
        chapterDirs = fs.readdirSync(mangaPath, { withFileTypes: true })
          .filter(d => d.isDirectory());
      } catch (err) {
        console.error(`⚠️ Cannot read manga folder, skipping: ${mangaPath}`);
        continue;
      }

      for (const ch of chapterDirs) {
        const chapterPath = path.join(mangaPath, ch.name);

        let files;
        try {
          files = fs.readdirSync(chapterPath);
        } catch (err) {
          console.warn(`⚠️ Cannot read chapter folder: ${chapterPath}`);
          continue;
        }

        const imageCount = files.filter(isImage).length;

        // 👉 CSAK AKKOR SKIP, HA 0 KÉP VAN
        if (imageCount === 0) {
          console.warn(`⚠️ No images, skipping chapter: ${chapterPath}`);
          continue;
        }

        try {


let folderMtime = new Date();
try {
  folderMtime = fs.statSync(chapterPath).mtime;
} catch {}

const chRes = await pool.query(
  `INSERT INTO chapter (manga_id, title, folder, library_id, scanned_at)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (manga_id, folder) DO NOTHING
   RETURNING id`,
  [mangaId, ch.name, ch.name, libraryId, folderMtime]
);
if (chRes.rows.length > 0) {
  // Új fejezet - megkeressük a manga cover_url-jét
  if (!newChapters[mangaSlug]) {
    const coverRes = await pool.query(
      `SELECT cover_url, anilist_id FROM manga WHERE id = $1`,
      [mangaId]
    );
    const coverRow = coverRes.rows[0];
    let coverUrl = null;
    const localCover = coverRow?.cover_url;
    if (localCover?.startsWith('/uploads/')) {
      // 1. Saját /uploads/ kép
      coverUrl = localCover;
    } else if (localCover?.startsWith('http')) {
      // 2. Bármilyen külső URL (csimota, stb.) - sharp letölti közvetlenül
      coverUrl = localCover;
    } else if (coverRow?.anilist_id) {
      // 3. AniList GraphQL - tiszta borítókép
      try {
        const alRes = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: `{ Media(id: ${coverRow.anilist_id}) { coverImage { large } } }` })
        });
        const alData = await alRes.json();
        coverUrl = alData?.data?.Media?.coverImage?.large || null;
      } catch {}
    }
    newChapters[mangaSlug] = {
      slug: mangaSlug,
      title: mangaTitle,
      cover_url: coverUrl,
      uploaders: coverRow?.uploaders || [],
      count: 0
    };
  }
  newChapters[mangaSlug].count++;
}
        } catch (err) {
          console.error(
            `❌ DB error (chapter): ${mangaTitle} / ${ch.name}`,
            err.message
          );
        }
      }
    }

    console.log("   ✔ Library scan done\n");
  }

  console.log("✅ Scan finished successfully");
  return Object.values(newChapters);
}

async function buildNewMangaCache() {
  console.log("📚 Building new manga cache...");
  
  try {
    const { rows } = await pool.query(`
      SELECT 
        m.slug,
        m.title,
        m.cover_url
      FROM manga m
      WHERE NOT EXISTS (
        SELECT 1 
        FROM manga_genre mg 
        WHERE mg.manga_id = m.id 
        AND mg.genre_id = 113
      )
      ORDER BY m.id DESC
      LIMIT 30
    `);
    
    setNewMangaCache(rows);
    console.log(`✅ New manga cache built: ${rows.length} items`);
    
  } catch (err) {
    console.error("❌ Failed to build new manga cache:", err);
  }
}

/* ================= RUN ================= */

let newChaptersResult = [];
scan()
  .then((newChs) => { newChaptersResult = newChs || []; return setUnlockTimes(); })
  .then(() => scanMetadata())
  .then(() => buildNewMangaCache())
  .then(async () => {
    if (newChaptersResult.length === 0) return;
    // scanMetadata() után frissítjük a cover URL-eket DB-ből (új mangánál ilyenkor már van)
    for (const ch of newChaptersResult) {
      if (!ch.cover_url) {
        const { rows } = await pool.query(`SELECT cover_url FROM manga WHERE slug = $1`, [ch.slug]);
        if (rows[0]?.cover_url) ch.cover_url = rows[0].cover_url;
      }
    }
    console.log(`📢 Sending ${newChaptersResult.length} new manga to Discord...`);
    const siteUrl = process.env.SITE_URL || "https://padlizsanfansub.hu";
    const discordBot = new Client({ intents: [GatewayIntentBits.Guilds] });
    try {
      await discordBot.login(process.env.DISCORD_BOT_TOKEN);
      const channelId = process.env.DISCORD_NEW_CHAPTERS_CHANNEL_ID || "1465994062690521234";
      const channel = await discordBot.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

      // Borítóképek letöltése
      async function fetchImageBuffer(url) {
        return new Promise((resolve) => {
          const proto = url.startsWith("https") ? https : http;
          const req = proto.get(url, { timeout: 8000 }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
              res.resume();
              return fetchImageBuffer(res.headers.location).then(resolve);
            }
            if (res.statusCode !== 200) { res.resume(); return resolve(null); }
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", () => resolve(null));
          });
          req.on("timeout", () => { req.destroy(); resolve(null); });
          req.on("error", () => resolve(null));
        });
      }

      // Grid generálás sharp-pal
      async function buildGrid(mangas) {
        const CARD_W = 200;
        const CARD_H = 280;
        const MAX_COLS = 8;
        // Dinamikus oszlopszám: felső sor >= alsó sor, max 8
        let COLS, ROWS;
        if (mangas.length <= MAX_COLS) {
          COLS = mangas.length;
          ROWS = 1;
        } else {
          ROWS = Math.ceil(mangas.length / MAX_COLS);
          COLS = Math.ceil(mangas.length / ROWS); // felső sor több vagy egyenlő
        }
        const GAP = 8;
        const GRID_W = COLS * CARD_W + (COLS - 1) * GAP;
        const GRID_H = ROWS * CARD_H + (ROWS - 1) * GAP;

        // Háttér
        const composite = [];

        // Felső sor itemszáma = COLS, alsó sor = maradék
        const topCount = COLS;
        for (let i = 0; i < mangas.length; i++) {
          const manga = mangas[i];
          let col, row, rowCount;
          if (i < topCount) {
            row = 0;
            col = i;
            rowCount = topCount;
          } else {
            row = Math.floor((i - topCount) / COLS) + 1;
            col = (i - topCount) % COLS;
            rowCount = Math.min(COLS, mangas.length - topCount - (row - 1) * COLS);
          }
          // Középre igazítás ha az alsó sor rövidebb
          const rowWidth = rowCount * CARD_W + (rowCount - 1) * GAP;
          const gridWidth = COLS * CARD_W + (COLS - 1) * GAP;
          const offsetX = Math.floor((gridWidth - rowWidth) / 2);
          const x = offsetX + col * (CARD_W + GAP);
          const y = row * (CARD_H + GAP);

          let imgBuf = null;
          if (manga.cover_url) {
            const coverUrl = manga.cover_url.startsWith("http") ? manga.cover_url : `${siteUrl}${manga.cover_url}`;
            imgBuf = await fetchImageBuffer(coverUrl);
          }

          if (imgBuf) {
            try {
              const resized = await sharp(imgBuf)
                .resize(CARD_W, CARD_H, { fit: "cover", position: "top" })
                .png()
                .toBuffer();
              composite.push({ input: resized, left: x, top: y });
            } catch {}
          } else {
            // Placeholder ha nincs kép
            const placeholder = await sharp({
              create: { width: CARD_W, height: CARD_H, channels: 4, background: { r: 30, g: 20, b: 60, alpha: 1 } }
            }).png().toBuffer();
            composite.push({ input: placeholder, left: x, top: y });
          }

          // Cím szöveg SVG
          const shortTitle = manga.title.length > 22 ? manga.title.slice(0, 20) + "…" : manga.title;
          const countText = `+${manga.count} rész`;
          const uploaderList = Array.isArray(manga.uploaders) && manga.uploaders.length > 0
            ? manga.uploaders.slice(0, 2).join(", ")
            : null;
          const uploaderBadge = uploaderList
            ? `<rect x="${CARD_W - uploaderList.length * 6 - 10}" y="6" width="${uploaderList.length * 6 + 8}" height="16" rx="4" fill="rgba(0,0,0,0.7)"/>
               <text x="${CARD_W - uploaderList.length * 6 - 6}" y="18" font-family="Arial" font-size="9" fill="#aaa">${uploaderList.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`
            : "";
          const svgText = `<svg width="${CARD_W}" height="${CARD_H}">
            ${uploaderBadge}
            <rect y="${CARD_H - 60}" width="${CARD_W}" height="60" fill="rgba(0,0,0,0.7)"/>
            <text x="6" y="${CARD_H - 40}" font-family="Arial" font-size="11" fill="white" font-weight="bold">${shortTitle.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>
            <rect x="6" y="${CARD_H - 28}" width="60" height="16" rx="4" fill="#7c5cff"/>
            <text x="10" y="${CARD_H - 16}" font-family="Arial" font-size="10" fill="white">${countText}</text>
          </svg>`;
          const svgBuf = Buffer.from(svgText);
          composite.push({ input: svgBuf, left: x, top: y });
        }

        return sharp({
          create: { width: GRID_W, height: GRID_H, channels: 4, background: { r: 12, g: 12, b: 18, alpha: 1 } }
        }).composite(composite).png().toBuffer();
      }

      // Max 20 manga per grid
      const GRID_SIZE = 20;
      for (let i = 0; i < newChaptersResult.length; i += GRID_SIZE) {
        const chunk = newChaptersResult.slice(i, i + GRID_SIZE);
        const gridBuffer = await buildGrid(chunk);
        const attachment = new AttachmentBuilder(gridBuffer, { name: "uj-fejezetek.png" });

        // Link lista szövegként
        const linkList = chunk.map(m =>
          `[${m.title}](${siteUrl}/chapters.html?slug=${encodeURIComponent(m.slug)})`
        ).join(" • ");

        const msgContent = i === 0
          ? `📚 **Új fejezetek érkeztek!** (${newChaptersResult.length} sorozat)
${linkList}`
          : linkList;

        await channel.send({ content: msgContent, files: [attachment] });
      }

      console.log("✅ Discord grid értesítés elküldve");
    } catch (e) {
      console.error("Discord send error:", e.message);
    } finally {
      discordBot.destroy();
    }
  })
  .then(() => {
    // Scan után auto-upload: Kavitában lévő új fájlok feltöltése R2-be
    const logPath = `/opt/padli/logs/r2-migrate-scan-${Date.now()}.log`;
    const r2Upload = spawn(
      "node",
      ["./server/scripts/migrate-to-r2.js", "kavita"],
      {
        cwd: "/opt/padli",
        detached: true,
        stdio: ["ignore",
          fs.openSync(logPath, "a"),
          fs.openSync(logPath, "a")]
      }
    );
    r2Upload.unref();
    console.log(`📤 R2 upload elindítva (log: ${logPath})`);
  })
  .catch(err => {
    console.error("❌ Scan failed:", err);
    process.exit(1);
  })
  .finally(() => {
    cleanup();
    pool.end();
  });
