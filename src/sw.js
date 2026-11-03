// Сервис-воркер: офлайн-режим. Это шаблон: сборка (tools/build.mjs) подставляет хэш игры и список адресов для кэша.
// Стратегия: сначала память (кэш этой версии), потом сеть. Новая версия ставится в фоне и ждёт, пока игрок нажмёт «Обновить».
const CACHE = "cc-{{V}}";
const ASSETS = {{ASSETS}};

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Каждый адрес мимо HTTP-кэша. Если хоть один не найден (например, CDN ещё отдаёт старое), установка не удаётся
      // целиком и повторится при следующем визите: устаревший файл под новым ключом не закэшируется.
      await cache.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })));
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("cc-") && k !== CACHE) await caches.delete(k); // старые версии игры
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting(); // игрок нажал «Обновить»
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === "navigate") {
        // страница с ?seed=...: адрес разный, а страница одна
        return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("./index.html")) || fetch(req);
      }
      return (await cache.match(req)) || fetch(req);
    })()
  );
});
