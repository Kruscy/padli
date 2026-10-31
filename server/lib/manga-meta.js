// Manga adatlap "core" mezőinek (cím, leírás, borító, műfajok, címkék)
// frissítése — ezt használja az admin szerkesztő ÉS a feltöltői adatlap-
// szerkesztő is (server/routes/admin.js, server/routes/uploader.js), hogy a
// műfaj/címke tranzakciós logika egy helyen éljen.
export async function updateMangaCore(client, mangaId, { cover_url, description, title, genres, tags }) {
  await client.query(
    `UPDATE manga SET
      cover_url = COALESCE($1, cover_url),
      description = COALESCE($2, description),
      title = COALESCE($3, title)
     WHERE id = $4`,
    [cover_url || null, description || null, title || null, mangaId]
  );

  for (const [list, table, link, extraCol] of [
    [genres, "genre", "manga_genre", ""],
    [tags, "tag", "manga_tag", ", rank"],
  ]) {
    if (!list) continue;
    const names = [...new Set(list.map(String).filter(Boolean))];
    await client.query(`DELETE FROM ${link} WHERE manga_id = $1`, [mangaId]);
    if (!names.length) continue;
    await client.query(
      `INSERT INTO ${table} (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING`, [names]
    );
    await client.query(
      `INSERT INTO ${link} (manga_id, ${table}_id${extraCol})
       SELECT $1, id${extraCol ? ", 0" : ""} FROM ${table} WHERE name = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [mangaId, names]
    );
  }
}
