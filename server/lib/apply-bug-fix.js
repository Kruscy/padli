import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { r2, BUCKET, localPathToR2Key } from "../r2.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";

/* ── Egy bug_fixes sor tényleges alkalmazása ───────────────────
   Kiszervezve, hogy egyaránt hívható legyen:
   - egyedi képes hibajegy admin jóváhagyásból (bug-reports.js)
   - egész fejezetes tömeges jóváhagyásból (chapter-bug-reports.js),
     ahol NINCS hozzá tartozó bug_reports sor (mert egész fejezet
     lett importálva, nem egyedi kép jelentve) — ezért az eredeti
     fájlnevet közvetlenül a bug_fixes.image_file mezőből vesszük,
     nem a bug_reports táblából próbáljuk visszafejteni. ── */
export async function applyBugFix(fixId, adminUserId) {
  const { rows: fixRows } = await pool.query("SELECT * FROM bug_fixes WHERE id=$1", [fixId]);
  if (!fixRows.length) throw new Error("Javítás nem található");
  const fix = fixRows[0];
  if (fix.is_applied) return { ok: true, alreadyApplied: true };

  const originalFilename = fix.image_file;
  if (!originalFilename) throw new Error("A javításhoz nincs eredeti fájlnév rögzítve");

  const fixedDir = path.join(process.cwd(), "uploads", "bugs", "javitott", fix.manga_slug, fix.chapter);
  if (!fix.fixed_image_url) throw new Error("A javítás nem tartalmaz fájl URL-t");
  const fixedFile = path.join(fixedDir, path.basename(fix.fixed_image_url));
  if (!fs.existsSync(fixedFile)) throw new Error("Javított kép fájl nem található: " + fixedFile);

  // Az adott FEJEZET saját library_id-jét használjuk, nem a mangáét — a manga
  // fejezetei több különböző uploader könyvtárból is származhatnak.
  const { rows: pathRows } = await pool.query(`
    SELECT l.path AS library_path, m.folder AS manga_folder
    FROM manga m
    JOIN chapter c ON c.manga_id = m.id AND c.folder = $2
    JOIN library l ON l.id = c.library_id
    WHERE m.slug = $1
    LIMIT 1
  `, [fix.manga_slug, fix.chapter]);
  if (!pathRows.length) throw new Error("Manga/fejezet nem található az adatbázisban: " + fix.manga_slug + " " + fix.chapter);

  const { library_path, manga_folder } = pathRows[0];
  const chapterDir = path.join(library_path, manga_folder, fix.chapter);
  const originalPath = path.join(chapterDir, originalFilename);

  // A helyi lemezen a fejezet mappája hiányozhat (korábban törölve, mert
  // R2-n már megvolt teljes egészében — l. helyi lemez tisztítás). Ilyenkor
  // NEM hiba, ha nincs helyi fájl: R2 a tényleges forrás, oda mindenképp
  // feltöltjük a javítást; a helyi írás csak akkor történik meg, ha a
  // fejezet mappája ténylegesen létezik a lemezen.
  const fileData = fs.readFileSync(fixedFile);
  const chapterDirExists = fs.existsSync(chapterDir);
  if (chapterDirExists) {
    fs.writeFileSync(originalPath, fileData);
  }
  fs.unlinkSync(fixedFile);
  try {
    const remaining = fs.readdirSync(fixedDir);
    if (remaining.length === 0) fs.rmdirSync(fixedDir);
  } catch (_) {}

  await pool.query(
    `UPDATE bug_fixes SET is_applied=true, fixed_image_url=$1 WHERE id=$2`,
    [originalPath, fixId]
  );

  // R2 feltöltés + chapter updated_at cache-bust
  try {
    const r2Key = localPathToR2Key(originalPath);
    const ct = /\.png$/i.test(originalFilename) ? "image/png" : "image/jpeg";
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: r2Key, Body: fileData, ContentType: ct }));
    await pool.query(
      `UPDATE chapter SET updated_at = NOW()
       WHERE folder = $1 AND manga_id = (SELECT id FROM manga WHERE slug = $2 LIMIT 1)`,
      [fix.chapter, fix.manga_slug]
    );
  } catch (err) {
    console.error("[apply-bug-fix] R2 hiba:", err.message);
  }

  // Kapcsolódó egyedi bug_reports lezárása, HA létezik ilyen (nem
  // kötelező — egész fejezet importnál nincs)
  if (fix.image_index != null) {
    await pool.query(`
      UPDATE bug_reports SET is_closed=true, closed_at=NOW(), closed_by=$1
      WHERE manga_slug=$2 AND chapter=$3 AND image_index=$4
    `, [adminUserId, fix.manga_slug, fix.chapter, fix.image_index]);
  }

  // Pont hozzáadása a javítónak
  try {
    if (fix.award_points !== false && fix.fixed_by) {
      const { rows: pointCheck } = await pool.query(`SELECT id FROM user_points WHERE fix_id = $1`, [fixId]);
      if (!pointCheck.length) {
        await pool.query(`
          INSERT INTO user_points (user_id, fix_id, points, approved_by, earned_at)
          VALUES ($1, $2, 5, $3, NOW())
        `, [fix.fixed_by, fixId, adminUserId]);
      }
    }
  } catch (err) {
    console.error("[apply-bug-fix] pont hiba:", err.message);
  }

  // Egyéb, el nem fogadott javítások törlése ugyanarra a képre (ha volt verseny köztük)
  try {
    if (fix.image_index != null) {
      const { rows: otherFixes } = await pool.query(
        `SELECT fixed_image_url FROM bug_fixes WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 AND id != $4 AND is_applied = false`,
        [fix.manga_slug, fix.chapter, fix.image_index, fixId]
      );
      for (const other of otherFixes) {
        try {
          const p = path.join(process.cwd(), other.fixed_image_url);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Notification a bejelentőknek/javítónak, ha van hozzá kapcsolódó egyedi jegy
  try {
    const fixerName = fix.fixed_by_name || "Javító";
    const mangaInfo = `${fix.manga_slug} ${fix.chapter} #${fix.image_index ?? originalFilename}`;

    if (fix.image_index != null) {
      const { rows: reporters } = await pool.query(`
        SELECT DISTINCT user_id FROM bug_reports
        WHERE manga_slug=$1 AND chapter=$2 AND image_index=$3 AND user_id IS NOT NULL
      `, [fix.manga_slug, fix.chapter, fix.image_index]);

      for (const reporter of reporters) {
        await pool.query(`
          INSERT INTO notifications (user_id, type, message, link)
          VALUES ($1, 'bug_closed', $2, '/bug-reports.html')
        `, [reporter.user_id, `A hibajegyed javítva lett: ${mangaInfo} – Javította: ${fixerName}`]);
      }
    }

    if (fix.fixed_by && fix.fixed_by !== adminUserId) {
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link)
        VALUES ($1, 'bug_closed', $2, '/bug-reports.html')
      `, [fix.fixed_by, `Javításod elfogadva! – ${mangaInfo}`]);
    }
  } catch (err) {
    console.error("[apply-bug-fix] notif hiba:", err.message);
  }

  // Cloudflare cache purge erre az egy képre — API proxy URL + R2 public URL
  try {
    const CF_ZONE   = process.env.CF_ZONE_ID;
    const CF_TOKEN  = process.env.CF_API_TOKEN;
    const CF_DOMAIN = process.env.CF_DOMAIN || "https://padlizsanfansub.hu";
    const R2_PUBLIC = process.env.R2_PUBLIC_URL;
    if (CF_ZONE && CF_TOKEN) {
      const urls = [`${CF_DOMAIN}/api/image/${fix.provider}/${fix.manga_slug}/${fix.chapter}/${encodeURIComponent(originalFilename)}`];
      if (R2_PUBLIC) urls.push(`${R2_PUBLIC}/${localPathToR2Key(originalPath)}`);
      await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files: urls }),
      });
    }
  } catch (err) {
    console.error("[apply-bug-fix] CF purge hiba:", err.message);
  }

  return { ok: true, original: originalPath };
}

/* ── Egy fejezethez tartozó ÖSSZES függő javítás alkalmazása ─── */
export async function applyAllFixesForChapter(mangaSlug, chapter, adminUserId) {
  const { rows: fixes } = await pool.query(
    `SELECT id FROM bug_fixes WHERE manga_slug=$1 AND chapter=$2 AND is_applied=false`,
    [mangaSlug, chapter]
  );
  let applied = 0;
  const errors = [];
  for (const fix of fixes) {
    try {
      await applyBugFix(fix.id, adminUserId);
      applied++;
    } catch (err) {
      errors.push({ fixId: fix.id, error: err.message });
    }
  }
  return { total: fixes.length, applied, errors };
}
