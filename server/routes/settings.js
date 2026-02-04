import express from "express";
import bcrypt from "bcrypt";
import { pool } from "../db.js";

const router = express.Router();

/* =========================
   GET /api/settings
   ========================= */
router.get("/", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const { id } = req.session.user;

  const { rows } = await pool.query(
    "SELECT username, email FROM users WHERE id = $1",
    [id]
  );

  res.json(rows[0]);
});

/* =========================
   POST /api/settings
   ========================= */
router.post("/", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const userId = req.session.user.id;
  const { email, oldPassword, newPassword } = req.body;

  /* ==== EMAIL CSERE ==== */
  if (email) {
    const exists = await pool.query(
      "SELECT 1 FROM users WHERE email = $1 AND id != $2",
      [email, userId]
    );

    if (exists.rowCount > 0) {
      return res.status(400).json({ error: "Email already in use" });
    }

    await pool.query(
      "UPDATE users SET email = $1 WHERE id = $2",
      [email, userId]
    );
  }

  /* ==== JELSZÓ CSERE ==== */
  if (oldPassword || newPassword) {
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Password fields incomplete" });
    }

    const { rows } = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId]
    );

    const ok = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!ok) {
      return res.status(400).json({ error: "Old password incorrect" });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [hash, userId]
    );
  }

  res.json({ ok: true });
});

export default router;
