import nodemailer from "nodemailer";
import { brand, getSite } from "./lib/site-config.js";

// Alapértelmezés: Gmail (az eredeti telepítés). A .env.example eddig is
// MAIL_HOST/MAIL_PORT-ot írt, de a kód figyelmen kívül hagyta őket.
// 465-ös porton (vagy MAIL_SECURE=true) közvetlen TLS.
const MAIL_PORT = Number(process.env.MAIL_PORT) || 587;
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: MAIL_PORT,
  secure: process.env.MAIL_SECURE ? process.env.MAIL_SECURE === "true" : MAIL_PORT === 465,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// A sablonok az eredeti oldal nevét/címét tartalmazzák: a beállított
// oldalnévre cseréljük (az eredeti telepítésen változatlan)
export async function sendMail({ to, subject, html }) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM || `"${getSite().name}" <${process.env.MAIL_USER}>`,
    to,
    subject: brand(subject, { html: false }),
    html: brand(html)
  });
}
console.log("MAIL beállítva:", !!(process.env.MAIL_USER && process.env.MAIL_PASS));
