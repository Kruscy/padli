import { pool } from "../db.js";

const lastUpdateMap = new Map();
const THROTTLE_MS = 60 * 1000; // 60 mp

export async function activityTracker(req, res, next) {
  const user = req.session?.user;

  if (!user) {
    return next();
  }

  const now = Date.now();
  const last = lastUpdateMap.get(user.id);

  if (last && now - last < THROTTLE_MS) {
    return next();
  }

  lastUpdateMap.set(user.id, now);

  try {
    await pool.query(
      "UPDATE users SET last_seen = now() WHERE id = $1",
      [user.id]
    );
  } catch (err) {
    console.error("Activity update error:", err);
  }

  next();
}
