import express from "express";
import crypto from "crypto";
import pool from "../db.js";
import { sendMail } from "../mail.js";

const router = express.Router();

router.post("/send-verification", async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Nem vagy bejelentkezve." });

    const { rows } = await pool.query(
      "SELECT email FROM users WHERE id = $1",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Felhasználó nem található." });
    }

    const email = rows[0].email;

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    await pool.query(
      `UPDATE users
       SET email_verification_token = $1,
           email_verification_expires = NOW() + INTERVAL '1 hour'
       WHERE id = $2`,
      [hashedToken, userId]
    );

    const link = `${process.env.BASE_URL}/verify-email?token=${rawToken}`;

    await sendMail({
      to: email,
      subject: "E-mail megerősítése",
      html: `
        <h2>E-mail megerősítése</h2>
        <p>Kattints az alábbi linkre:</p>
        <a href="${link}">${link}</a>
        <p>A link 1 óráig érvényes.</p>
      `
    });

    res.json({ message: "E-mail elküldve." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Hiba történt." });
  }
});

export default router;
