// Собирает game.js (esbuild, PixiJS внутри, без внешних адресов) и index.html в корень проекта для GitHub Pages.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [path.join(root, "src", "main.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  outfile: path.join(root, "game.js"),
  legalComments: "none",
  logLevel: "warning",
});
const js = fs.readFileSync(path.join(root, "game.js"));
const v = crypto.createHash("sha1").update(js).digest("hex").slice(0, 8);
const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8").replace("{{V}}", v);
fs.writeFileSync(path.join(root, "index.html"), html);
fs.writeFileSync(path.join(root, ".nojekyll"), "");
console.log(`built game.js (${(js.length / 1024).toFixed(0)} KB) and index.html, v=${v}`);
