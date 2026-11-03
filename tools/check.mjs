// Сборка + все tests/*.test.mjs. Каждый тест печатает «…пройдены», иначе проверка считается проваленной.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [path.join(root, "tools", "build.mjs")], { stdio: "inherit" });

let failed = 0;
for (const f of fs.readdirSync(path.join(root, "tests")).filter((n) => n.endsWith(".test.mjs"))) {
  try {
    const out = execFileSync(process.execPath, [path.join(root, "tests", f)], { encoding: "utf8" });
    process.stdout.write(out);
    if (!/пройдены/.test(out)) throw new Error("нет строки «пройдены»");
  } catch (e) {
    failed++;
    console.error(`FAIL ${f}: ${e.stdout || ""}${e.stderr || e.message}`);
  }
}
if (failed) {
  console.error(`проваленных тестов: ${failed}`);
  process.exit(1);
}
console.log("check: всё в порядке");
