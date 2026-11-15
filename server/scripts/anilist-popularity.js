// AniList népszerűség, pontszám, 18+ jelző és Gore/Nudity címke frissítése (2026-11-15)
//   node server/scripts/anilist-popularity.js
// A közösségi posztok (FB-ajánló, Instagram/TikTok részlet) a legismertebb művekkel kezdenek.
import "dotenv/config";
import { pool } from "../db.js";

const { rows } = await pool.query("SELECT DISTINCT anilist_id FROM manga WHERE anilist_id IS NOT NULL");
const ids = rows.map(r => r.anilist_id);
let done = 0;
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50);
  const r = await fetch("https://graphql.anilist.co", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: "query($ids:[Int]){Page(perPage:50){media(id_in:$ids){id popularity averageScore isAdult tags{name rank}}}}", variables: { ids: chunk } }),
  });
  if (r.status === 429) { await new Promise(s => setTimeout(s, 60000)); i -= 50; continue; }
  const d = await r.json();
  for (const m of d.data?.Page?.media || []) {
    const tag = n => Math.max(0, ...(m.tags || []).filter(t => n.includes(t.name)).map(t => t.rank || 0));
    await pool.query(`UPDATE manga SET anilist_popularity = $1, average_score = COALESCE($2, average_score),
                        anilist_is_adult = $3, anilist_gore = $4, anilist_nudity = $5 WHERE anilist_id = $6`,
      [m.popularity, m.averageScore, !!m.isAdult, tag(["Gore"]), tag(["Nudity", "Sexual Content"]), m.id]);
    done++;
  }
  await new Promise(s => setTimeout(s, 1500));
}
console.log(`AniList népszerűség frissítve: ${done} / ${ids.length}`);
await pool.end();
