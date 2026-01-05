import express from "express";
import { pool } from "./db.js";

const app = express();
app.use("/images", express.static("../images"));
app.use(express.static("../public"));

app.get("/api/manga", async (req, res) => {
  const result = await pool.query("SELECT * FROM manga");
  res.json(result.rows);
});

app.get("/api/chapters/:slug", async (req, res) => {
  const result = await pool.query(`
    SELECT chapter.*
    FROM chapter
    JOIN manga ON manga.id = chapter.manga_id
    WHERE manga.slug = $1
    ORDER BY chapter.id
  `, [req.params.slug]);
  res.json(result.rows);
});

app.listen(3000, () => {
  console.log("Server running on :3000");
});
