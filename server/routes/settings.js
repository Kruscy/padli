import express from "express";
import bcrypt from "bcrypt";
import { randomBytes, createHash } from "crypto";
import { pool } from "../db.js";
import { sendMail } from "../mail.js";
import { logSecurityEvent } from "../lib/security-log.js";
import { validatePassword, destroyUserSessions } from "../lib/auth-security.js";

function verificationEmailHtml(username, link) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;padding:32px 28px">
    <img src="${process.env.SITE_URL || ""}/assets/logo.png" style="height:48px;margin-bottom:20px" alt="${process.env.SITE_NAME || "PadlizsanFanSub"}">
    <h2 style="color:#a78bfa;margin:0 0 12px">Erősítsd meg az email címed!</h2>
    <p style="color:#bbb;line-height:1.7">Szia <strong style="color:#fff">${username || "Felhasználó"}</strong>!</p>
    <p style="color:#bbb;line-height:1.7">Kattints az alábbi gombra az email cím megerősítéséhez:</p>
    <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;margin:16px 0">
      ✉️ Email megerősítése
    </a>
    <p style="color:#888;font-size:0.82rem;margin-top:20px">A link 24 óráig érvényes.</p>
    <hr style="border-color:#2a2a3a;margin:20px 0">
    <p style="color:#555;font-size:0.78rem">${process.env.SITE_NAME || "PadlizsanFanSub"} · ${(process.env.SITE_URL || "").replace(/^https?:\/\//, "")}</p>
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

  const { rows: cur } = await pool.query(
    "SELECT email, password_hash, username FROM users WHERE id = $1",
    [userId]
  );
  if (!cur.length) return res.status(404).json({ error: "Felhasználó nem található" });

  // A kliens minden mentéskor elküldi az e-mail-címet — csak akkor e-mail-
  // csere, ha TÉNYLEG eltér a jelenlegitől (korábban minden mentés, pl. egy
  // sima jelszócsere is "megerősítetlenné" tette az e-mailt és levelet küldött).
  const newEmail = typeof email === "string" ? email.trim() : "";
  const wantsEmailChange = !!newEmail && newEmail.toLowerCase() !== String(cur[0].email || "").toLowerCase();
  const wantsPasswordChange = !!newPassword;

  if (!wantsEmailChange && !wantsPasswordChange) {
    return res.json({ ok: true, emailChanged: false });
  }

  // E-mail- és jelszócseréhez is a JELENLEGI jelszó kell — egy ellopott
  // munkamenettel így nem lehet átírni az e-mailt, majd jelszó-
  // visszaállítással véglegesen átvenni a fiókot.
  if (!oldPassword) {
    return res.status(400).json({
      error: wantsEmailChange
        ? "Az e-mail-cím módosításához add meg a jelenlegi jelszavadat (Régi jelszó mező)."
        : "Régi jelszó megadása kötelező",
    });
  }
  const ok = await bcrypt.compare(String(oldPassword), cur[0].password_hash);
  if (!ok) {
    logSecurityEvent({ req, type: "settings_bad_password", severity: "warn",
                       details: { emailChange: wantsEmailChange, passwordChange: wantsPasswordChange } });
    return res.status(400).json({ error: "A jelenlegi jelszó hibás" });
  }

  if (wantsPasswordChange) {
    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });
  }

  /* ==== EMAIL CSERE ==== */
  let emailChanged = false;
  if (wantsEmailChange) {
    const exists = await pool.query(
      "SELECT 1 FROM users WHERE lower(email) = lower($1) AND id != $2",
      [newEmail, userId]
    );

    if (exists.rowCount > 0) {
      return res.status(400).json({ error: "Ez az email már foglalt" });
    }

    const rawToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(rawToken).digest("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE users SET email = $1, email_verified = false,
       email_verification_token = $2, email_verification_expires = $3
       WHERE id = $4`,
      [newEmail, hashedToken, expires, userId]
    );

    const username = cur[0].username || "Felhasználó";
    const verifyLink = `${process.env.BASE_URL || process.env.SITE_URL || "http://localhost:3000"}/verify-email.html?token=${rawToken}`;

    sendMail({
      to: newEmail,
      subject: "✉️ Erősítsd meg az új email címed – PadlizsanFanSub",
      html: verificationEmailHtml(username, verifyLink),
    }).catch(e => console.error("[mail] email change verify error:", e.message));

    logSecurityEvent({ req, type: "email_changed", severity: "info",
                       details: { from: String(cur[0].email || "").split("@")[1] || null, to: newEmail.split("@")[1] || null } });
    emailChanged = true;
  }

  /* ==== JELSZÓ CSERE ==== */
  if (wantsPasswordChange) {
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [hash, userId]
    );
    // A többi eszközön lévő bejelentkezés érvénytelen (a mostani marad)
    const killed = await destroyUserSessions(userId, req.sessionID);
    logSecurityEvent({ req, type: "password_changed", severity: "info", details: { otherSessionsRevoked: killed } });
  }

  res.json({ ok: true, emailChanged });
});

export default router;
