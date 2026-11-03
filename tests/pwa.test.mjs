// Офлайн-режим: файлы сборки (sw.js, index.html, манифест, значки) и поведение сервис-воркера в песочнице.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// ---- сборка: хэш в имени, нет остатков шаблона, адреса кэша существуют ----
const html = read("index.html");
const swText = read("sw.js");
const jsFiles = fs.readdirSync(root).filter((f) => /^game(\.[0-9a-f]+)?\.js$/.test(f));
assert.equal(jsFiles.length, 1, "в корне ровно один файл игры: " + jsFiles);
assert.match(jsFiles[0], /^game\.[0-9a-f]{8}\.js$/, "имя игры содержит хэш");
const hash = jsFiles[0].slice(5, 13);
assert.ok(html.includes(`<script src="${jsFiles[0]}"></script>`), "index.html подключает файл с хэшем");
assert.ok(!html.includes("game.js?v="), "старый способ версии не остался");
assert.ok(!/\{\{/.test(html) && !/\{\{/.test(swText), "в index.html и sw.js не осталось {{...}}");

const assetsMatch = swText.match(/const ASSETS = (\[.*?\]);/);
assert.ok(assetsMatch, "в sw.js есть список адресов");
const ASSETS = JSON.parse(assetsMatch[1]);
assert.ok(ASSETS.includes("./") && ASSETS.includes("./index.html") && ASSETS.includes("./" + jsFiles[0]), "в кэше страница и игра");
for (const a of ASSETS) {
  if (a === "./") continue;
  assert.ok(fs.existsSync(path.join(root, a.slice(2))), `адрес из офлайн-кэша есть на диске: ${a}`);
}
assert.ok(swText.includes(`const CACHE = "cc-${hash}";`), "версия кэша привязана к хэшу игры");

// ---- манифест ----
{
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.ok(!/^(https?:)?\//.test(m.start_url + m.scope), "start_url и scope относительные: работают на адресе /conveyor-city/");
  assert.equal(m.display, "standalone");
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  assert.ok(m.name && m.short_name);
  const sizes = new Set();
  for (const ic of m.icons) {
    assert.ok(fs.existsSync(path.join(root, ic.src)), "значок есть: " + ic.src);
    assert.ok(!/^(https?:)?\//.test(ic.src), "значок по относительному адресу");
    sizes.add(ic.sizes + ic.purpose);
  }
  assert.ok(sizes.has("192x192any") && sizes.has("512x512any") && sizes.has("512x512maskable"), "есть 192, 512 и maskable");
  assert.ok(html.includes('rel="manifest" href="manifest.webmanifest"'), "страница подключает манифест");
}

// ---- значки: настоящие PNG нужного размера ----
{
  const check = (file, size) => {
    const b = fs.readFileSync(path.join(root, file));
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file + ": подпись PNG");
    assert.equal(b.readUInt32BE(16), size, file + ": ширина");
    assert.equal(b.readUInt32BE(20), size, file + ": высота");
    // распаковка данных: размер = высота * (1 + ширина * 4)
    let off = 8;
    const idat = [];
    while (off < b.length) {
      const len = b.readUInt32BE(off);
      const type = b.subarray(off + 4, off + 8).toString();
      if (type === "IDAT") idat.push(b.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    assert.equal(raw.length, size * (1 + size * 4), file + ": данные картинки целы");
  };
  check("icon-192.png", 192);
  check("icon-512.png", 512);
  check("icon-512-maskable.png", 512);
  check("apple-touch-icon.png", 180);
  assert.match(html, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/, "iOS игнорирует значки манифеста: нужен apple-touch-icon");
  assert.ok(html.includes("apple-mobile-web-app-capable"));
}

// ---- сервис-воркер в песочнице ----
function sandbox({ fetchImpl, caches: pre = {} }) {
  const stores = new Map(Object.entries(pre).map(([n, o]) => [n, new Map(Object.entries(o))]));
  const strip = (u) => String(u).split("?")[0];
  const fakeCache = (map) => ({
    async addAll(reqs) {
      const got = [];
      for (const r of reqs) {
        const resp = await fetchImpl(r);
        if (!resp || !resp.ok) throw new Error("addAll: " + (r.url || r) + " " + (resp && resp.status)); // как настоящий addAll
        got.push([new URL(r.url, "https://x.github.io/conveyor-city/").href, resp]);
      }
      for (const [u, resp] of got) map.set(u, resp);
    },
    async match(req, opts = {}) {
      const url = new URL(typeof req === "string" ? req : req.url, "https://x.github.io/conveyor-city/").href;
      if (map.has(url)) return map.get(url);
      if (opts.ignoreSearch) for (const [k, v] of map) if (strip(k) === strip(url)) return v;
      return undefined;
    },
  });
  const cachesApi = {
    async open(n) {
      if (!stores.has(n)) stores.set(n, new Map());
      return fakeCache(stores.get(n));
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(n) {
      return stores.delete(n);
    },
  };
  const handlers = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: { origin: "https://x.github.io" },
    addEventListener: (t, h) => (handlers[t] = h),
    skipWaiting: () => calls.skipWaiting++,
    clients: { claim: async () => calls.claim++ },
  };
  class Request {
    constructor(url, init = {}) {
      this.url = new URL(url, "https://x.github.io/conveyor-city/").href;
      this.cache = init.cache;
      this.method = "GET";
    }
  }
  const ctx = vm.createContext({ self, caches: cachesApi, fetch: fetchImpl, Request, URL, Promise });
  vm.runInContext(swText, ctx);
  const wait = async (type, ev = {}) => {
    let p;
    await handlers[type]({ ...ev, waitUntil: (x) => (p = x) });
    await p;
  };
  const respond = async (req) => {
    let p;
    handlers.fetch({ request: req, respondWith: (x) => (p = x) });
    return p === undefined ? undefined : await p;
  };
  return { stores, handlers, calls, wait, respond, Request };
}
const okResp = (url) => ({ ok: true, status: 200, url, body: "из-сети:" + url });
const base = "https://x.github.io/conveyor-city/";

{
  // установка: все адреса скачиваются мимо HTTP-кэша и кладутся в кэш своей версии
  const seen = [];
  const sb = sandbox({ fetchImpl: async (r) => (seen.push(r), okResp(r.url)) });
  await sb.wait("install");
  assert.equal(seen.length, ASSETS.length);
  assert.ok(seen.every((r) => r.cache === "reload"), "cache: reload у каждого запроса");
  assert.deepEqual([...sb.stores.keys()], ["cc-" + hash]);
  assert.equal(sb.stores.get("cc-" + hash).size, ASSETS.length);
}

{
  // устаревший CDN: новая страница уже есть, а файла игры с новым хэшем ещё нет (404): установка не удаётся, кэш пуст
  const sb = sandbox({ fetchImpl: async (r) => (r.url.endsWith(jsFiles[0]) ? { ok: false, status: 404, url: r.url } : okResp(r.url)) });
  await assert.rejects(() => sb.wait("install"), /addAll/);
  const cache = sb.stores.get("cc-" + hash);
  assert.ok(!cache || cache.size === 0, "ничего не закэшировано при 404");
}

{
  // активация: чистит старые версии игры, чужие кэши не трогает
  const sb = sandbox({ fetchImpl: async (r) => okResp(r.url), caches: { "cc-старый": { a: 1 }, ["cc-" + hash]: { b: 2 }, "чужое-приложение": { c: 3 } } });
  await sb.wait("activate");
  assert.deepEqual([...sb.stores.keys()].sort(), ["cc-" + hash, "чужое-приложение"].sort());
  assert.equal(sb.calls.claim, 1);
}

{
  // сообщение «Обновить» включает новую версию; без сообщения воркер ждёт
  const sb = sandbox({ fetchImpl: async (r) => okResp(r.url) });
  sb.handlers.message({ data: "что-то другое" });
  assert.equal(sb.calls.skipWaiting, 0);
  sb.handlers.message({ data: "SKIP_WAITING" });
  assert.equal(sb.calls.skipWaiting, 1);
}

{
  // офлайн: сети нет совсем
  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };
  let online = true;
  const sb = sandbox({ fetchImpl: async (r) => (online ? okResp(r.url) : offline()) });
  await sb.wait("install");
  online = false;
  const nav = (url) => ({ method: "GET", mode: "navigate", url });
  const a = await sb.respond(nav(base + "?seed=424242"));
  assert.ok(a && a.url.endsWith("index.html") || a.body.includes("index.html") || a.body.includes("conveyor-city/"), "страница с ?seed= открывается без сети");
  const b = await sb.respond(nav(base + "index.html?seed=7&x=1"));
  assert.ok(b.url.endsWith("index.html"), "и по адресу с index.html");
  const c = await sb.respond(nav(base));
  assert.ok(c, "и без параметров");
  const game = await sb.respond({ method: "GET", mode: "no-cors", url: base + jsFiles[0] });
  assert.ok(game.url.endsWith(jsFiles[0]), "файл игры из кэша");
  const manifest = await sb.respond({ method: "GET", mode: "cors", url: base + "manifest.webmanifest" });
  assert.ok(manifest.url.endsWith("manifest.webmanifest"));
  // ignoreSearch только для страницы: файл игры с чужим параметром не подменяется
  await assert.rejects(() => sb.respond({ method: "GET", mode: "no-cors", url: base + jsFiles[0] + "?x=1" }), TypeError);
  await assert.rejects(() => sb.respond({ method: "GET", mode: "no-cors", url: base + "чего-нет.js" }), TypeError, "неизвестное без сети: ошибка сети, а не подмена");
  // не GET и чужой адрес воркер не трогает
  assert.equal(await sb.respond({ method: "POST", mode: "cors", url: base }), undefined);
  assert.equal(await sb.respond({ method: "GET", mode: "cors", url: "https://other.example/x.js" }), undefined);
}

{
  // при сети: то, чего нет в кэше, берётся из сети
  const sb = sandbox({ fetchImpl: async (r) => okResp(r.url || r) });
  await sb.wait("install");
  const r = await sb.respond({ method: "GET", mode: "cors", url: base + "что-то-новое.json" });
  assert.ok(r.url.endsWith("что-то-новое.json"));
}

console.log("pwa.test: проверки пройдены");
