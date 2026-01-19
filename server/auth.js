import bcrypt from "bcrypt";
import { pool } from "./db.js";

export async function register(req, res) {
  const { username, email, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });

  const hash = await bcrypt.hash(password, 12);

  try {
    const q = `
      INSERT INTO "user"(username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, is_admin
    `;
    const r = await pool.query(q, [username, email, hash]);

    req.session.user = r.rows[0];
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: "User already exists" });
  }
}

export async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });

  const q = `SELECT * FROM "user" WHERE username = $1`;
  const r = await pool.query(q, [username]);

  if (r.rows.length === 0)
    return res.status(401).json({ error: "Invalid login" });

  const user = r.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok)
    return res.status(401).json({ error: "Invalid login" });

  req.session.user = {
    id: user.id,
    username: user.username,
    is_admin: user.is_admin
  };

  res.json(req.session.user);
}

export function logout(req, res) {
  req.session.destroy(() => res.json({ ok: true }));
}

export function me(req, res) {
  res.json(req.session.user || null);
}

