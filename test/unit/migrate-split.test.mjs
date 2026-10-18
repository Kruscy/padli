// Migrációfuttató: SQL utasításokra bontása — adatbázis nélkül.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { splitSql, SCHEMA_FILE } from "../../server/lib/migrate.js";

test("a ;-t idézőjelben, $$-blokkban és megjegyzésben nem bontja", () => {
  const sql = `-- megjegyzés; ez nem utasítás
CREATE TABLE a (x text DEFAULT 'a;b''c');
/* blokk; megjegyzés */
CREATE FUNCTION f() RETURNS trigger AS $$
BEGIN NEW.x := 'y;'; RETURN NEW; END;
$$ LANGUAGE plpgsql;
SELECT "fura;név" FROM a;   `;
  const parts = splitSql(sql);
  assert.equal(parts.length, 3);
  assert.match(parts[0], /^CREATE TABLE a \(x text DEFAULT 'a;b''c'\)$/);
  assert.match(parts[1], /RETURN NEW; END;\n\$\$ LANGUAGE plpgsql$/);
  assert.equal(parts[2], `SELECT "fura;név" FROM a`);
});

test("a schema.sql minden utasítása nem üres és pontosvessző nélkül végződik", () => {
  const parts = splitSql(fs.readFileSync(SCHEMA_FILE, "utf8"));
  assert.ok(parts.length > 50);
  for (const p of parts) assert.ok(p.length && !p.endsWith(";"));
});
