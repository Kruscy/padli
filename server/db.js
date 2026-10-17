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
  // Ha a DB nem fogad kapcsolatot (vagy a pool kimerült), a kérés ennyi
  // idő után hibával tér vissza, ne várakozzon a végtelenségig
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 10000,
  idleTimeoutMillis: 30000,
  // Opcionális lekérdezés-időkorlát (ms); alapból nincs, mert a háttér-
  // szkriptek (scan, migrációk) is ezt a poolt használják
  ...(Number(process.env.PG_STATEMENT_TIMEOUT_MS) ? { statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) } : {}),
});

// Egy tétlen kapcsolat hibája (pl. DB-újraindítás, hálózati szakadás)
// 'error' eseményt ad a poolon; kezelő nélkül ez leállítaná a folyamatot.
// A hibás klienst a pg magától eldobja, a következő lekérdezés újat nyit.
pool.on("error", (err) => {
  console.error("[pg pool] tétlen kapcsolat hibája:", err.message);
});
