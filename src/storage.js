// Хранилище сохранений карт. Основа: IndexedDB, два слота на карту по очереди (испорченный слот не страшен),
// плюс синхронное зеркало в localStorage (его успевает записать закрывающаяся вкладка).
// При загрузке берётся самая свежая из валидных записей. Логика не зависит от браузера: хранилища передаются снаружи.
import { Factory } from "./factory.js";

export const FORMAT = "conveyor-city-map"; // пометка файла сохранения
export const MAX_FILE = 5_000_000; // байт: больше при загрузке из файла не читаем
export const MAX_BUILDINGS = 200_000;
export const MIRROR_PREFIX = "cc-save-"; // тот же ключ, что у прежних сохранений (автоподхват)

// Запись карты годна, если это сохранение нашего формата: версия 1, номер карты, список построек.
export function validatePayload(p) {
  if (!p || typeof p !== "object" || p.v !== 1) return null;
  if (!Number.isInteger(p.seed) || p.seed <= 0) return null;
  if (!Array.isArray(p.buildings) || p.buildings.length > MAX_BUILDINGS) return null;
  return p;
}

const tsOf = (p) => (Number.isFinite(p.ts) ? p.ts : 0);

// Самая свежая из годных записей (без метки времени считается самой старой); при равенстве первая в списке.
export function newestValid(cands, seed) {
  let best = null;
  for (const c of cands) {
    const p = validatePayload(c);
    if (!p || (seed !== undefined && p.seed !== seed)) continue;
    if (!best || tsOf(p) > tsOf(best)) best = p;
  }
  return best;
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null; // обрезанный или испорченный текст пропускаем
  }
};

export class MapStore {
  // backend: {get, put, del, keys} (промисы) или null; mirror: {get, set, del, keys} (синхронно) или null.
  constructor(backend, mirror) {
    this.backend = backend;
    this.mirror = mirror;
    this.errors = { backend: false, mirror: false }; // для предупреждения «сохранение не работает»
  }

  // Сохранение работает, если есть хотя бы одно живое место для записи.
  get works() {
    const idbOk = !!this.backend && !this.errors.backend;
    const lsOk = !!this.mirror && !this.errors.mirror;
    return idbOk || lsOk;
  }

  _mirrorGet(seed) {
    if (!this.mirror) return null;
    try {
      const t = this.mirror.get(MIRROR_PREFIX + seed);
      return t ? parse(t) : null;
    } catch {
      return null;
    }
  }

  async _record(seed) {
    if (!this.backend) return null;
    try {
      return (await this.backend.get("map:" + seed)) || null;
    } catch {
      this.errors.backend = true;
      return null;
    }
  }

  // Загрузка: самая свежая годная запись из двух слотов и зеркала. Возвращает payload или null.
  async load(seed) {
    const rec = await this._record(seed);
    const cands = [this._mirrorGet(seed)];
    if (rec && Array.isArray(rec.slots)) for (const s of rec.slots) cands.push(s && s.payload);
    return newestValid(cands, seed);
  }

  // Синхронная часть сохранения (для закрывающейся вкладки).
  saveSync(seed, payload) {
    if (!this.mirror) return false;
    try {
      this.mirror.set(MIRROR_PREFIX + seed, JSON.stringify(payload));
      this.errors.mirror = false;
      return true;
    } catch {
      this.errors.mirror = true; // нет места или запрещено
      return false;
    }
  }

  // Полное сохранение: зеркало сразу, потом слот IndexedDB (по очереди, не трогая соседний).
  async save(seed, payload) {
    const mirrored = this.saveSync(seed, payload);
    if (!this.backend) return mirrored;
    try {
      const rec = (await this.backend.get("map:" + seed)) || { seed, slots: [null, null], next: 0 };
      const i = rec.next === 1 ? 1 : 0;
      rec.slots[i] = { ts: tsOf(payload), payload };
      rec.next = 1 - i;
      await this.backend.put("map:" + seed, rec);
      this.errors.backend = false;
      return true;
    } catch {
      this.errors.backend = true;
      return mirrored;
    }
  }

  // Список карт для меню: номер, число построек, монеты, жители, время. Свежие сверху.
  async list() {
    const seeds = new Set();
    if (this.backend) {
      try {
        for (const k of await this.backend.keys()) if (String(k).startsWith("map:")) seeds.add(Number(String(k).slice(4)));
      } catch {
        this.errors.backend = true;
      }
    }
    if (this.mirror) {
      try {
        for (const k of this.mirror.keys()) if (k.startsWith(MIRROR_PREFIX)) seeds.add(Number(k.slice(MIRROR_PREFIX.length)));
      } catch {
        // зеркало недоступно
      }
    }
    const out = [];
    for (const seed of seeds) {
      if (!Number.isInteger(seed) || seed <= 0) continue;
      const p = await this.load(seed);
      if (p) out.push({ seed, ts: tsOf(p), buildings: p.buildings.length, coins: Number.isFinite(p.coins) ? p.coins : 0, pop: Number.isFinite(p.pop) ? p.pop : 0 });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  // Удаляет карту из обоих мест (иначе зеркало «воскресит» её).
  async remove(seed) {
    if (this.mirror) {
      try {
        this.mirror.del(MIRROR_PREFIX + seed);
      } catch {
        // нечего удалять
      }
    }
    if (this.backend) {
      try {
        await this.backend.del("map:" + seed);
      } catch {
        this.errors.backend = true;
      }
    }
  }

  // Один раз переносит прежние сохранения (localStorage) в IndexedDB; старые ключи НЕ удаляет. Возвращает число перенесённых.
  async migrate() {
    if (!this.backend || !this.mirror) return 0;
    try {
      if (await this.backend.get("meta:migrated")) return 0;
      let n = 0;
      for (const k of this.mirror.keys()) {
        if (!k.startsWith(MIRROR_PREFIX)) continue;
        const seed = Number(k.slice(MIRROR_PREFIX.length));
        const p = validatePayload(parse(this.mirror.get(k) || ""));
        if (!p || p.seed !== seed) continue;
        if (await this.backend.get("map:" + seed)) continue;
        await this.backend.put("map:" + seed, { seed, slots: [{ ts: tsOf(p), payload: p }, null], next: 1 });
        n++;
      }
      await this.backend.put("meta:migrated", 1);
      return n;
    } catch {
      this.errors.backend = true;
      return 0;
    }
  }
}

// ---- файл сохранения ----
export function exportFile(payload, version = "") {
  return {
    name: `conveyor-city-map-${payload.seed}.json`,
    text: JSON.stringify({ format: FORMAT, version, exported: Date.now(), map: payload }),
  };
}

// Разбор загруженного файла: ничего не доверяем. Возвращает {ok, payload, buildings} или {ok:false, error}.
export function parseImport(text) {
  if (typeof text !== "string" || text.length > MAX_FILE) return { ok: false, error: "size" };
  const data = parse(text);
  if (!data || data.format !== FORMAT) return { ok: false, error: "format" };
  const p = validatePayload(data.map);
  if (!p) return { ok: false, error: "map" };
  // настоящая проверка: карта должна загрузиться в чистую фабрику
  const probe = new Factory(p.seed);
  const n = probe.loadJSON(p);
  if (n < 0) return { ok: false, error: "map" };
  return { ok: true, payload: p, buildings: n };
}

// ---- настоящие хранилища браузера ----
export function createMirror(ls) {
  if (!ls) return null;
  return {
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, v),
    del: (k) => ls.removeItem(k),
    keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)),
  };
}

// IndexedDB как простое «ключ-значение». Возвращает null, если IndexedDB недоступна (приватное окно и т.п.).
export async function openIdbBackend(idb) {
  if (!idb) return null;
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const r = idb.open("conveyor-city", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("blocked"));
    });
  } catch {
    return null;
  }
  const tx = (mode, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction("kv", mode);
      const store = t.objectStore("kv");
      const req = fn(store);
      t.oncomplete = () => resolve(req && req.result !== undefined ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    get: (k) => tx("readonly", (s) => s.get(k)),
    put: (k, v) => tx("readwrite", (s) => s.put(v, k)),
    del: (k) => tx("readwrite", (s) => s.delete(k)),
    keys: () => tx("readonly", (s) => s.getAllKeys()),
  };
}
