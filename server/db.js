import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  // A session store is ezt a poolt használja (korábban saját, 10-es pool
  // mellett) — a 20 megtartja a korábbi összes kapcsolatszámot.
  max: Number(process.env.PG_POOL_MAX) || 20,
});

// Egy tétlen kapcsolat hibája (pl. DB-újraindítás, hálózati szakadás)
// 'error' eseményt ad a poolon; kezelő nélkül ez leállítaná a folyamatot.
// A hibás klienst a pg magától eldobja, a következő lekérdezés újat nyit.
pool.on("error", (err) => {
  console.error("[pg pool] tétlen kapcsolat hibája:", err.message);
});
