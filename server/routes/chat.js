import express from "express";
import { pool } from "../db.js";
import { sendToDiscord, broadcast, getGuildEmojis } from "../discord-bot.js";
import { requireLogin } from "../middleware/auth.js";
import { handleChatMessageForAI } from "../padli-ai.js";

const router = express.Router();

/* ===== SEND ===== */
router.post("/send", requireLogin, async (req, res) => {
  const { content } = req.body;
  const user = req.session.user;

  if (!content?.trim()) return res.status(400).json({ error: "Empty message" });
  if (content.length > 500) return res.status(400).json({ error: "Too long" });

  try {
    const userRes = await pool.query(
      `SELECT avatar FROM users WHERE id = $1`,
      [user.id]
    );
    const avatar = userRes.rows[0]?.avatar || null;

    await pool.query(
      `INSERT INTO chat_messages (source, author, author_id, avatar, content)
       VALUES ('web', $1, $2, $3, $4)`,
      [user.username, user.id, avatar, content.trim()]
    );

    broadcast({
      type: "message",
      source: "web",
      author: user.username,
      displayName: user.display_name || user.username,
      authorId: user.id,
      avatar: avatar,
      content: content.trim(),
      timestamp: Date.now()
    });

    await sendToDiscord(user.username, content.trim());
   // Padli AI – figyel és válaszol ha szükséges
    handleChatMessageForAI(
      { content: content.trim(), author: user.username, source: "web", authorId: user.id },
      broadcast,
      pool
    );
    res.json({ ok: true });

  } catch (err) {
    console.error("Chat send error:", err);
    res.status(500).json({ error: "Failed to send" });
  }
});

/* ===== HISTORY ===== */
router.get("/history", requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 50`
    );
    res.json(rows.reverse());
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

/* ===== EMOJIS ===== */
router.get("/emojis", requireLogin, async (req, res) => {
  try {
    const emojis = await getGuildEmojis();
    res.json(emojis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch emojis" });
  }
});

export default router;
