import express from "express";
import multer from "multer";
import { pool } from "../db.js";
import path from "path";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireLogin } from "../middleware/auth.js";
import { validateHungarianAddress, validateRealName } from "../lib/address-validate.js";

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
      avatar: user.avatar || "https://padlizsanfansub.hu/assets/logo.png",
      tier: user.tier || null,
      role: req.session.user.role || "user",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
// Születési dátum lekérése
// FONTOS: TO_CHAR-ral kérjük le szövegként, nem a nyers DATE oszlopot —
// a pg driver a DATE-et helyi időzóna szerinti éjfélként JS Date objektummá
// alakítja, amit a res.json() UTC ISO stringgé szerializál (.toISOString()),
// ez pedig +1-2 órás UTC-eltolódás miatt egy nappal korábbi dátumot adna
// vissza (pl. "1998-11-11" → "1998-11-10T23:00:00.000Z").
router.get("/birth-date", requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT TO_CHAR(birth_date, 'YYYY-MM-DD') AS birth_date FROM users WHERE id = $1`,
    [req.session.user.id]
  );
  res.json({ birth_date: rows[0]?.birth_date || null });
});

// Születési dátum mentése
router.post("/birth-date", requireLogin, async (req, res) => {
  const { birth_date } = req.body;
  if (!birth_date) return res.status(400).json({ error: "Hiányzó dátum" });

  const b = new Date(birth_date);
  const ageInYears = (Date.now() - b.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (isNaN(b.getTime()) || b > new Date() || ageInYears > 120) {
    return res.status(400).json({ error: "Érvénytelen születési dátum" });
  }

  await pool.query(
    `UPDATE users SET birth_date = $1 WHERE id = $2`,
    [birth_date, req.session.user.id]
  );
  res.json({ ok: true });
});

/* ── Számlázási cím ───────────────────────────────────────────
   Csak azoknál a felhasználóknál kötelező, akiknek aktív (vagy
   szüneteltetett) Stripe-előfizetésük van, és még nincs rögzítve
   a címük — a javított/helyes számla kiállításához kell. ── */
router.get("/billing-address", requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.billing_address, u.billing_name, u.force_billing_address,
            EXISTS (
              SELECT 1 FROM patreon_status ps
              WHERE ps.user_id = u.id AND ps.payment_source = 'stripe'
            ) AS is_stripe_payer
     FROM users u WHERE u.id = $1`,
    [req.session.user.id]
  );
  const row = rows[0];
  const missing = !row?.billing_address || !row?.billing_name;
  res.json({
    billing_address: row?.billing_address || null,
    billing_name: row?.billing_name || null,
    required: (!!row?.is_stripe_payer || !!row?.force_billing_address) && missing,
  });
});

router.post("/billing-address", requireLogin, async (req, res) => {
  const { post_code, city, street, house_number, full_name } = req.body;
  if (!/^\d{4}$/.test(post_code || "") || !city?.trim() || !street?.trim() || !house_number?.trim()) {
    return res.status(400).json({ error: "Érvénytelen cím — minden mező kitöltése kötelező" });
  }

  const nameCheck = await validateRealName(full_name, req.session.user.username);
  if (!nameCheck.valid) {
    return res.status(400).json({ error: nameCheck.reason });
  }

  const addressCheck = await validateHungarianAddress({
    post_code: post_code.trim(), city: city.trim(), street: street.trim(), house_number: house_number.trim(),
  });
  if (!addressCheck.valid) {
    return res.status(400).json({ error: addressCheck.reason });
  }

  const billing_address = `${post_code.trim()} ${city.trim()}, ${street.trim()} ${house_number.trim()}`;
  await pool.query(
    `UPDATE users SET billing_address = $1, billing_name = $2 WHERE id = $3`,
    [billing_address, full_name.trim(), req.session.user.id]
  );

  // Köszönő értesítés a felhasználónak, amiért kitöltötte
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'billing_address_thanks', $2, '/settings.html')`,
      [req.session.user.id, "🙏 Köszönjük, hogy megadtad a valódi számlázási neved és címed! Ezzel nem kerülünk bajba a könyvelőnknél — a jogszabályok szerint helyes adatokkal tudjuk kiállítani a számládat."]
    );
  } catch (err) {
    console.error("[billing-address] köszönő értesítés hiba:", err);
  }

  // Értesítés Ascyra-nak (user_id=5), ha most adta meg a címét egy Stripe-fizető
  try {
    const { rows: stripeCheck } = await pool.query(
      `SELECT 1 FROM patreon_status WHERE user_id = $1 AND payment_source = 'stripe' LIMIT 1`,
      [req.session.user.id]
    );
    if (stripeCheck.length) {
      const { rows: remainingRows } = await pool.query(`
        SELECT COUNT(DISTINCT u.id) AS cnt
        FROM users u
        JOIN patreon_status ps ON ps.user_id = u.id AND ps.payment_source = 'stripe'
        WHERE u.billing_address IS NULL OR u.billing_name IS NULL
      `);
      const remaining = parseInt(remainingRows[0]?.cnt || 0);
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link)
        VALUES (5, 'billing_address', $1, '/admin.html')
      `, [`📮 ${req.session.user.username} megadta a számlázási nevét/címét. Még ${remaining} Stripe-fizetőnél hiányzik.`]);
    }
  } catch (err) {
    console.error("[billing-address] értesítés hiba:", err);
  }

  res.json({ ok: true });
});

export default router;
