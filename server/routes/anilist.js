import express from "express";
import fetch from "node-fetch";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

router.get("/search", requireLogin, async (req, res) => {
  try {
    const q = req.query.q;

    if (!q || q.length < 2) {
      return res.json([]);
    }

    const query = `
      query ($search: String) {
        Page(perPage: 5) {
          media(search: $search, type: MANGA) {
            id
            title { romaji english }
            coverImage { medium }
            chapters
          }
        }
      }
    `;

    const api = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { search: q }
      })
    });

    const json = await api.json();

    res.json(json.data.Page.media);

  } catch (err) {
    console.error("ANILIST SEARCH ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
