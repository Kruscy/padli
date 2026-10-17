// Szintaxis-ellenőrzés (node --check) a szerver- és a frontend-JS-fájlokra.
// Nincs külön linter függőség; a CI-ban és helyben is futtatható: npm run check
import { execFileSync } from "child_process";
import { readdirSync, statSync } from "fs";
import path from "path";

const roots = ["server", "public/js", "test", "scripts"];
const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(name)) files.push(p);
  }
};
roots.forEach(walk);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(`✖ ${f}\n${String(err.stderr).split("\n").slice(0, 5).join("\n")}`);
  }
}
console.log(`${files.length - failed}/${files.length} fájl szintaktikailag rendben`);
process.exit(failed ? 1 : 0);
