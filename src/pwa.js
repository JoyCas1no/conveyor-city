// Страничная часть офлайн-режима: регистрация сервис-воркера, обновление по кнопке, версия сборки, постоянное хранилище.
// Адрес с ?nosw=1 отключает воркер и чистит его кэши (для отладки: иначе кэш показывает прошлую версию вместо свежей).

// Версия сборки из имени файла игры (game.<хэш>.js); «dev», если не нашлась.
export function buildVersion() {
  for (const s of document.scripts) {
    const m = s.src && s.src.match(/game\.([0-9a-f]{6,})\.js/);
    if (m) return m[1];
  }
  return "dev";
}

async function dropWorker() {
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) if (k.startsWith("cc-")) await caches.delete(k);
  } catch {
    // нечего чистить
  }
}

// Регистрирует воркер. onWaiting(worker) зовётся, когда скачана новая версия и ждёт нажатия «Обновить».
export async function registerSw({ onWaiting }) {
  if (!("serviceWorker" in navigator)) return null;
  if (new URLSearchParams(location.search).has("nosw")) {
    await dropWorker();
    return null;
  }
  let reg;
  try {
    reg = await navigator.serviceWorker.register("./sw.js");
  } catch {
    return null; // например, file:// или запрет браузера: игра работает без офлайн-режима
  }
  const watch = (w) =>
    w.addEventListener("statechange", () => {
      if (w.state === "installed" && navigator.serviceWorker.controller) onWaiting(w);
    });
  if (reg.waiting && navigator.serviceWorker.controller) onWaiting(reg.waiting);
  reg.addEventListener("updatefound", () => reg.installing && watch(reg.installing));
  const check = () => reg.update().catch(() => {});
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
  setInterval(check, 60 * 60 * 1000);
  check();
  return reg;
}

// «Обновить»: новая версия включается, страница перезагружается после сохранения.
export function applyUpdate(waiting, beforeReload) {
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    async () => {
      try {
        await beforeReload();
      } finally {
        location.reload();
      }
    },
    { once: true }
  );
  waiting.postMessage("SKIP_WAITING");
}

// Скачано ли всё для работы без сети: воркер активен и есть кэш этой игры.
export async function offlineReady(reg) {
  try {
    return !!(reg && reg.active) && (await caches.keys()).some((k) => k.startsWith("cc-"));
  } catch {
    return false;
  }
}

// Постоянное ли хранилище (браузер не очистит его при нехватке места или долгом простое). Просит, если ещё нет.
export async function persistStatus() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      let p = await navigator.storage.persisted();
      if (!p && navigator.storage.persist) p = await navigator.storage.persist();
      return !!p;
    }
  } catch {
    // браузер не умеет
  }
  return false;
}

// Скачивание или отправка файла: сначала системное «Поделиться» (на телефоне надёжнее), иначе обычная ссылка-скачивание.
export async function saveFile(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  try {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return "share";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancel"; // игрок закрыл окно «Поделиться»
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "download";
}
