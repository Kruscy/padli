import express from "express";
import multer from "multer";
import { pool } from "../db.js";
import path from "path";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|jpg|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Csak képfájl tölthető fel"));
  },
});

router.post("/avatar", upload.single("avatar"), async (req, res) => {
  if (!req.session.user) return res.sendStatus(401);
  if (!req.file) return res.status(400).json({ error: "Nincs fájl" });

  const userId = req.session.user.id;

  const webp = await sharp(req.file.buffer)
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();

  const key = `avatars/${userId}.webp`;
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: webp,
    ContentType: "image/webp",
    CacheControl: "public, max-age=86400",
  }));

  const avatarUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
  await pool.query(`UPDATE users SET avatar = $1 WHERE id = $2`, [avatarUrl, userId]);

  res.json({ success: true, avatar: avatarUrl });
});
router.get("/me", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }

    const userId = req.session.user.id;

    const result = await pool.query(`
      SELECT u.username, u.avatar, p.tier
      FROM users u
      LEFT JOIN patreon_status p ON p.user_id = u.id
      WHERE u.id = $1
    `, [userId]);

    const user = result.rows[0];

    res.json({
      id: userId,
      username: user.username,
      avatar: user.avatar || "/uploads/default.png",
      tier: user.tier || null,
      role: req.session.user.role || "user",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
// Születési dátum lekérése
router.get("/birth-date", requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT birth_date FROM users WHERE id = $1`,
    [req.session.user.id]
  );
  res.json({ birth_date: rows[0]?.birth_date || null });
});

// Születési dátum mentése
router.post("/birth-date", requireLogin, async (req, res) => {
  const { birth_date } = req.body;
  if (!birth_date) return res.status(400).json({ error: "Hiányzó dátum" });

  await pool.query(
    `UPDATE users SET birth_date = $1 WHERE id = $2`,
    [birth_date, req.session.user.id]
  );
  res.json({ ok: true });
});
export default router;
