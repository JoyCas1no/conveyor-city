// Хранение сохранений в браузере (localStorage), по номеру карты. Любая ошибка хранилища не ломает игру.
const PREFIX = "cc-save-";
const LAST = "cc-last-seed";

export function readSave(seed) {
  try {
    const s = localStorage.getItem(PREFIX + seed);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function writeSave(seed, payload) {
  try {
    localStorage.setItem(PREFIX + seed, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function readLastSeed() {
  try {
    const v = Number(localStorage.getItem(LAST));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeLastSeed(seed) {
  try {
    localStorage.setItem(LAST, String(seed));
  } catch {
    // без хранилища игра работает, просто ничего не запоминает
  }
}

// Камера из сохранения: только конечные числа в разумных границах, иначе null.
export function sanitizeCam(cam) {
  if (!cam || ![cam.x, cam.y, cam.zoom].every(Number.isFinite)) return null;
  if (Math.abs(cam.x) > 1e7 || Math.abs(cam.y) > 1e7) return null;
  return { x: cam.x, y: cam.y, zoom: Math.min(3, Math.max(0.35, cam.zoom)) };
}
