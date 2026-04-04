import express from "express";
import multer from "multer";
import { pool } from "../db.js";
import path from "path";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();
console.log("USER ROUTE LOADED");
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const ext = file.mimetype.split("/")[1].toLowerCase();
      cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext);

console.log("UPLOAD FILE:", file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

router.post("/avatar", upload.single("avatar"), async (req, res) => {
  if (!req.session.user) return res.sendStatus(401);

  const userId = req.session.user.id;

  const filePath = `/uploads/${req.file.filename}`;

  await pool.query(
    `UPDATE users SET avatar = $1 WHERE id = $2`,
    [filePath, userId]
  );

  res.json({ success: true, avatar: filePath });
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
      tier: user.tier || null
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
