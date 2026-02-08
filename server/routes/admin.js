import { Router } from "express";
import { spawn } from "child_process";
import { pool } from "../db.js";
import { sendMail } from "../mail.js";


const router = Router();

/* ================= ADMIN GUARD ================= */

router.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

/* ================= SCAN LIBRARY ================= */

router.post("/scan", (req, res) => {
  try {
    // AZONNAL válaszolunk a frontendnek
    res.json({ ok: true });

    // háttérben elindítjuk a scan-t
    const scan = spawn(
      "node",
      ["./server/scan.js"],
      {
        cwd: "/opt/padli",
        detached: true,
        stdio: "ignore"
      }
    );

    scan.unref();

    console.log("🔄 Admin scan started");
  } catch (err) {
    console.error("❌ Scan spawn failed", err);
  }
});


/* ================= UPDATE MANGA META ================= */

router.post("/manga/:slug", async (req, res) => {
  const { slug } = req.params;
  const { cover_url, description } = req.body;

  console.log("ADMIN EDIT MANGA");
  console.log("SLUG:", slug);
  console.log("BODY:", req.body);

  try {
    const result = await pool.query(
      `
      UPDATE manga
      SET cover_url = $1,
          description = $2
      WHERE slug = $3
      RETURNING id
      `,
      [cover_url, description, slug]
    );

    console.log("DB RESULT:", result.rowCount);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Manga not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN EDIT ERROR:", err);
    res.status(500).json({ error: "DB error", detail: err.message });
  }
});
/* ================= Users ================= */
router.get("/users", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, username, email, role, created_at, ps.tier, ps.active
      FROM users u
      LEFT JOIN patreon_status ps
        ON ps.user_id = u.id
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("ADMIN USERS ERROR:", err);
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
