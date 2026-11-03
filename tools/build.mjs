// Собирает игру для GitHub Pages в корень проекта:
//  - game.<хэш>.js (esbuild, PixiJS внутри, без внешних адресов); старые game*.js удаляются;
//  - index.html из src/index.html (подставляется хэш);
//  - sw.js из src/sw.js (хэш версии и список адресов для офлайн-кэша; каждый адрес должен существовать на диске).
// Хэш в имени файла нужен для офлайн-режима: если CDN ещё отдаёт старое, запрос нового файла даёт 404, и установка воркера
// просто повторится позже, а не закэширует старую игру под новым именем.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = await build({
  entryPoints: [path.join(root, "src", "main.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  outfile: path.join(root, "game.js"),
  write: false,
  legalComments: "none",
  logLevel: "warning",
});
const js = Buffer.from(res.outputFiles[0].contents);
const v = crypto.createHash("sha1").update(js).digest("hex").slice(0, 8);
const jsName = `game.${v}.js`;
for (const f of fs.readdirSync(root)) if (/^game(\.[0-9a-f]+)?\.js$/.test(f) && f !== jsName) fs.unlinkSync(path.join(root, f));
fs.writeFileSync(path.join(root, jsName), js);

const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8").replaceAll("{{V}}", v);
fs.writeFileSync(path.join(root, "index.html"), html);

// Адреса для офлайн-кэша: всё, без чего игра не откроется без сети.
const assets = ["./", "./index.html", `./${jsName}`, "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./apple-touch-icon.png"];
for (const a of assets) {
  if (a === "./") continue;
  if (!fs.existsSync(path.join(root, a.slice(2)))) throw new Error(`в списке офлайн-кэша есть адрес, которого нет на диске: ${a}`);
}
const sw = fs.readFileSync(path.join(root, "src", "sw.js"), "utf8").replaceAll("{{V}}", v).replaceAll("{{ASSETS}}", JSON.stringify(assets));
if (/\{\{/.test(sw) || /\{\{/.test(html)) throw new Error("в sw.js или index.html остались неподставленные {{...}}");
fs.writeFileSync(path.join(root, "sw.js"), sw);
fs.writeFileSync(path.join(root, ".nojekyll"), "");
console.log(`built ${jsName} (${(js.length / 1024).toFixed(0)} KB), index.html, sw.js, v=${v}`);
