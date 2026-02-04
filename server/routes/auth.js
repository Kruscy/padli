import bcrypt from "bcrypt";

router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    const exists = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (exists.rows.length) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING id, email, role
      `,
      [email, hash]
    );

    req.session.user = result.rows[0];
    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});
