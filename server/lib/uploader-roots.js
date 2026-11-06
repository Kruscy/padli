/* Feltöltő-mappa → fordító neve (a mangalapon „🎌 Fordító”, manga.uploaders).
   Közös a scan (server/scan.js) és az admin „Hiányzó fordítók kitöltése”
   gomb (routes/admin.js) között, hogy a kettő ugyanígy döntsön.
   1) uploader_names.root_path — admin által beállított megjelenő név (pl. SKYPRO → „SKYPRO18”);
   2) tartalék: a feltöltő saját mappája (patreon_status.uploader_root) a felhasználónevével,
      ha az 1)-ben nincs ugyanerre a mappára bejegyzés.
   A legspecifikusabb (leghosszabb) mappa nyer.
   Szabály (2026-11-06): a nevet CSAK üres listába írjuk — az admin által
   beírt fordítót (pl. másik fordító, aki a mappa tulajdonosa helyett dolgozott)
   nem írjuk felül és nem bővítjük. */
import path from "path";

export const KAVITA_BASE = "/mnt/manga/Kavita";

const rootBase = root => {
  const r = String(root).replace(/\\/g, "/");
  return r.startsWith("/") ? path.resolve(r) : path.join(KAVITA_BASE, r);
};

export async function buildUploaderRoots(db) {
  const { rows } = await db.query(
    `SELECT name, root_path FROM uploader_names WHERE root_path IS NOT NULL AND root_path != ''`
  );
  const roots = rows.map(r => ({ name: r.name, base: rootBase(r.root_path) }));
  try {
    const { rows: users } = await db.query(`
      SELECT u.username, ps.uploader_root
      FROM users u JOIN patreon_status ps ON ps.user_id = u.id
      WHERE ps.uploader_root IS NOT NULL AND ps.uploader_root != ''
        AND (ps.tier IN ('Admin', 'Uploader') OR u.can_upload = true)`);
    for (const u of users) {
      const base = rootBase(u.uploader_root);
      if (base === KAVITA_BASE || roots.some(r => r.base === base)) continue;
      roots.push({ name: u.username, base });
    }
  } catch (err) {
    console.warn("⚠️ Feltöltő-mappák (tartalék) lekérése sikertelen:", err.message);
  }
  return roots.sort((a, b) => b.base.length - a.base.length);
}

export function matchUploaderRoot(roots, mangaPath) {
  const p = path.resolve(mangaPath);
  return roots.find(r => p.startsWith(r.base + path.sep) || p === r.base) || null;
}

/* Csak üres listába ír; true, ha írt. */
export async function assignUploaderIfEmpty(db, mangaId, name) {
  const { rowCount } = await db.query(
    `UPDATE manga SET uploaders = ARRAY[$1::text]
     WHERE id = $2 AND cardinality(COALESCE(uploaders, '{}')) = 0`,
    [name, mangaId]
  );
  return rowCount > 0;
}
