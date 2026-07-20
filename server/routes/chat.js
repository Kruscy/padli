import express from "express";
import multer from "multer";
import sharp from "sharp";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { pool } from "../db.js";
import { r2, BUCKET } from "../r2.js";
import { sendToDiscord, sendImageToDiscord, broadcast, getGuildEmojis } from "../discord-bot.js";
import { requireLogin } from "../middleware/auth.js";
import { handleChatMessageForAI } from "../padli-ai.js";

const router = express.Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Csak képfájl tölthető fel"));
  },
});

/* ===== KÖZÖS: mentés + broadcast + Discord relay + AI hook =====
   discordRelay: opcionális felülírás — alapból a content-et szöveges
   üzenetként küldi Discordra, de pl. képnél natív csatolmányt küldünk
   helyette, hogy ne látszódjon a nyers R2-URL a beágyazott kép mellett. */
async function saveAndSendMessage(user, content, discordRelay) {
  const userRes = await pool.query(
    `SELECT avatar FROM users WHERE id = $1`,
    [user.id]
  );
  const avatar = userRes.rows[0]?.avatar || null;

  await pool.query(
    `INSERT INTO chat_messages (source, author, author_id, avatar, content)
     VALUES ('web', $1, $2, $3, $4)`,
    [user.username, user.id, avatar, content]
  );

  broadcast({
    type: "message",
    source: "web",
    author: user.username,
    displayName: user.display_name || user.username,
    authorId: user.id,
    avatar: avatar,
    content: content,
    timestamp: Date.now()
  });

  // A Discord-relé hibája (pl. bot offline) ne buktassa el a webes
  // küldést, ami eddigre már sikeresen megtörtént (mentve + broadcastolva).
  const relay = discordRelay || (() => sendToDiscord(user.username, content));
  await relay().catch(err => {
    console.error("Chat → Discord relay error:", err.message);
  });
  // Padli AI – figyel és válaszol ha szükséges
  handleChatMessageForAI(
    { content: content, author: user.username, source: "web", authorId: user.id },
    broadcast,
    pool
  );
}

/* ===== SEND ===== */
router.post("/send", requireLogin, async (req, res) => {
  const { content } = req.body;
  const user = req.session.user;

  if (!content?.trim()) return res.status(400).json({ error: "Empty message" });
  if (content.length > 500) return res.status(400).json({ error: "Too long" });

  try {
    await saveAndSendMessage(user, content.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error("Chat send error:", err);
    res.status(500).json({ error: "Failed to send" });
  }
});

/* ===== KÉP KÜLDÉSE (JPEG-re konvertálva, R2-re feltöltve) ===== */
router.post("/send-image", requireLogin, (req, res) => {
  // A multer middleware-t kézzel hívjuk (nem router-szintű middleware-ként),
  // hogy a fileFilter/méret hibái is tiszta JSON-t adjanak vissza a
  // képi Express hibaoldal (nyers stack trace) helyett.
  imageUpload.single("image")(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || "Hibás fájl" });
    }

    const user = req.session.user;
    if (!req.file) return res.status(400).json({ error: "Nincs fájl" });

    try {
      const jpeg = await sharp(req.file.buffer)
        .rotate() // EXIF orientáció alkalmazása
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const key = `chat/${Date.now()}-${user.id}.jpg`;
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: jpeg,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=604800",
      }));

      const imageUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
      await saveAndSendMessage(user, imageUrl, () =>
        sendImageToDiscord(user.username, jpeg, "kep.jpg")
      );
      res.json({ ok: true, url: imageUrl });
    } catch (err) {
      console.error("Chat image send error:", err);
      res.status(500).json({ error: "Failed to send image" });
    }
  });
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
