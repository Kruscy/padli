import express from "express";
import bcrypt from "bcrypt";
import { randomBytes, createHash } from "crypto";
import { pool } from "../db.js";
import { sendMail } from "../mail.js";

function verificationEmailHtml(username, link) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;padding:32px 28px">
    <img src="https://padlizsanfansub.hu/assets/logo.png" style="height:48px;margin-bottom:20px" alt="PadlizsanFanSub">
    <h2 style="color:#a78bfa;margin:0 0 12px">Erősítsd meg az email címed!</h2>
    <p style="color:#bbb;line-height:1.7">Szia <strong style="color:#fff">${username || "Felhasználó"}</strong>!</p>
    <p style="color:#bbb;line-height:1.7">Kattints az alábbi gombra az email cím megerősítéséhez:</p>
    <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;margin:16px 0">
      ✉️ Email megerősítése
    </a>
    <p style="color:#888;font-size:0.82rem;margin-top:20px">A link 24 óráig érvényes.</p>
    <hr style="border-color:#2a2a3a;margin:20px 0">
    <p style="color:#555;font-size:0.78rem">PadlizsanFanSub · padlizsanfansub.hu</p>
  </div>`;
}

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
    "SELECT username, email, email_verified FROM users WHERE id = $1",
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
  let emailChanged = false;
  if (email) {
    const exists = await pool.query(
      "SELECT 1 FROM users WHERE email = $1 AND id != $2",
      [email, userId]
    );

    if (exists.rowCount > 0) {
      return res.status(400).json({ error: "Ez az email már foglalt" });
    }

    const rawToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(rawToken).digest("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { rows: uRows } = await pool.query(
      `UPDATE users SET email = $1, email_verified = false,
       email_verification_token = $2, email_verification_expires = $3
       WHERE id = $4 RETURNING username`,
      [email, hashedToken, expires, userId]
    );

    const username = uRows[0]?.username || "Felhasználó";
    const verifyLink = `${process.env.BASE_URL || "https://padlizsanfansub.hu"}/verify-email.html?token=${rawToken}`;

    sendMail({
      to: email,
      subject: "✉️ Erősítsd meg az új email címed – PadlizsanFanSub",
      html: verificationEmailHtml(username, verifyLink),
    }).catch(e => console.error("[mail] email change verify error:", e.message));

    emailChanged = true;
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

  res.json({ ok: true, emailChanged });
});

export default router;
