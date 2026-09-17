// 18+ korhatár-ellenőrzés: felnőtt tartalmú (Hentai/Ecchi) mangákhoz és a
// 18+ kapcsolóhoz. Közös hely, hogy a manga.js és a user.js ugyanazt a
// (fail-closed) logikát használja.
export function isAdultVerified(birthDate) {
  if (!birthDate) return false; // nincs dátum → fail closed, nem tekintjük felnőttnek
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return false; // értelmezhetetlen dátum → fail closed
  const now = new Date();
  if (b > now) return false; // jövőbeli "születési" dátum → érvénytelen, fail closed
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  if (age > 120) return false; // irreális kor (pl. hibás/placeholder dátum) → fail closed
  return age >= 18;
}

// A ?adult=1 kérés-paramétert csak akkor fogadja el igazként, ha a
// bejelentkezett user birth_date alapján tényleg 18+ — máskülönben
// csendben false-ra esik vissza. Közös hely, hogy minden kezdőlapi
// (homepage) lista-végpont (manga, new-manga, new-releases, featured,
// recent-reading) ugyanúgy döntsön, ne csak a /api/manga.
export async function resolveAdultMode(pool, req) {
  if (req.query.adult !== "1" || !req.session?.user) return false;
  const { rows } = await pool.query(`SELECT birth_date FROM users WHERE id = $1`, [req.session.user.id]);
  return isAdultVerified(rows[0]?.birth_date);
}

// SQL-fragmens: az "IN"/EXISTS mintát mindenhol ugyanígy kell megfogalmazni
// (manga_genre + genre join, Hentai/Ecchi név alapján), hogy konzisztens
// legyen a szűrés minden végponton.
export const ADULT_GENRE_EXISTS_SQL = `
  EXISTS (
    SELECT 1 FROM manga_genre mg JOIN genre g ON g.id = mg.genre_id
    WHERE mg.manga_id = m.id AND g.name IN ('Hentai','Ecchi')
  )
`;
