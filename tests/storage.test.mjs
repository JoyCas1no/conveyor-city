// Хранилище сохранений: два слота, свежая запись, зеркало, миграция, удаление, файл сохранения.
import assert from "node:assert/strict";
import { MapStore, validatePayload, newestValid, exportFile, parseImport, createMirror, openIdbBackend, FORMAT, MAX_FILE, MIRROR_PREFIX } from "../src/storage.js";
import { Factory, BT } from "../src/factory.js";

// ---- подставные хранилища ----
const memBackend = () => {
  const m = new Map();
  return {
    m,
    async get(k) {
      return m.has(k) ? structuredClone(m.get(k)) : undefined;
    },
    async put(k, v) {
      m.set(k, structuredClone(v));
    },
    async del(k) {
      m.delete(k);
    },
    async keys() {
      return [...m.keys()];
    },
  };
};
const memMirror = () => {
  const m = new Map();
  return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k), keys: () => [...m.keys()] };
};
const failing = () => ({
  get: async () => { throw new Error("idb"); },
  put: async () => { throw new Error("idb"); },
  del: async () => { throw new Error("idb"); },
  keys: async () => { throw new Error("idb"); },
});

// Настоящая карта этапа 6: дом Mk3, станок с рецептом, монеты, выполненные контракты.
function realPayload(seed, ts) {
  const f = new Factory(seed);
  f.map.set("0,0", f._make(BT.HOUSE, 0, 0, 0, undefined, 3));
  f.map.set("2,0", f._make(BT.CONSTRUCTOR, 2, 0, 0, "gear", 2));
  f.map.set("4,0", f._make(BT.BELT, 4, 0, 1));
  f.stock = { gear: 5, plank: 40 };
  f.coins = 321;
  f.done = new Set([0, 1, 2]);
  return { ...f.toJSON(), cam: { x: 10, y: 20, zoom: 1.4 }, ts, pop: 7 };
}

// ---- проверка записи и выбор свежей ----
{
  assert.equal(validatePayload(null), null);
  assert.equal(validatePayload({ v: 2, seed: 1, buildings: [] }), null);
  assert.equal(validatePayload({ v: 1, seed: 0, buildings: [] }), null);
  assert.equal(validatePayload({ v: 1, seed: 1.5, buildings: [] }), null);
  assert.equal(validatePayload({ v: 1, seed: -3, buildings: [] }), null);
  assert.equal(validatePayload({ v: 1, seed: 5, buildings: "x" }), null);
  assert.ok(validatePayload({ v: 1, seed: 5, buildings: [] }));
  const a = { v: 1, seed: 5, buildings: [], ts: 100 };
  const b = { v: 1, seed: 5, buildings: [["h", 1, 1, 0]], ts: 200 };
  const old = { v: 1, seed: 5, buildings: [] }; // без метки: самая старая (сохранения до этапа 7)
  assert.equal(newestValid([a, b, old], 5), b);
  assert.equal(newestValid([old, a], 5), a);
  assert.equal(newestValid([null, "мусор", { v: 1 }, old], 5), old);
  assert.equal(newestValid([{ ...b, seed: 6 }, a], 5), a, "чужой номер карты не годится");
  assert.equal(newestValid([], 5), null);
  assert.equal(newestValid([a, { ...a }], 5), a, "при равенстве первая");
}

// ---- два слота по очереди; испорченный слот не мешает ----
{
  const backend = memBackend();
  const mirror = memMirror();
  const store = new MapStore(backend, mirror);
  const p = (ts, n) => ({ v: 1, seed: 9, buildings: Array.from({ length: n }, (_, i) => ["b", i, 0, 0]), ts });
  await store.save(9, p(1, 1));
  let rec = backend.m.get("map:9");
  assert.equal(rec.slots[0].ts, 1);
  assert.equal(rec.slots[1], null);
  assert.equal(rec.next, 1);
  await store.save(9, p(2, 2));
  rec = backend.m.get("map:9");
  assert.deepEqual([rec.slots[0].ts, rec.slots[1].ts, rec.next], [1, 2, 0]);
  await store.save(9, p(3, 3));
  rec = backend.m.get("map:9");
  assert.deepEqual([rec.slots[0].ts, rec.slots[1].ts], [3, 2], "третья запись затёрла самый старый слот");
  // «отключили свет во время записи»: слот 0 испорчен, зеркала нет
  rec.slots[0].payload = { v: 1, seed: 9, buildings: "обрыв" };
  backend.m.set("map:9", rec);
  mirror.m.clear();
  const got = await new MapStore(backend, mirror).load(9);
  assert.equal(got.ts, 2, "взят предыдущий годный слот");
  assert.equal(got.buildings.length, 2);
}

// ---- свежая запись среди слотов и зеркала; обрезанное зеркало пропускается ----
{
  const backend = memBackend();
  const mirror = memMirror();
  const store = new MapStore(backend, mirror);
  const p = (ts) => ({ v: 1, seed: 4, buildings: [["s", ts, 0, 0]], ts });
  await store.save(4, p(100));
  mirror.m.set(MIRROR_PREFIX + 4, JSON.stringify(p(500))); // вкладку закрыли: зеркало свежее слота
  assert.equal((await store.load(4)).ts, 500);
  mirror.m.set(MIRROR_PREFIX + 4, JSON.stringify(p(500)).slice(0, 40)); // обрезано
  assert.equal((await store.load(4)).ts, 100, "обрезанное зеркало пропущено");
  mirror.m.delete(MIRROR_PREFIX + 4);
  assert.equal((await store.load(4)).ts, 100);
  assert.equal(await store.load(77), null);
  mirror.m.set(MIRROR_PREFIX + 4, JSON.stringify(p(50))); // зеркало старее слота
  assert.equal((await store.load(4)).ts, 100);
}

// ---- автоподхват прежних сохранений: настоящая карта этапа 6 ----
{
  const real = realPayload(777, 0);
  delete real.ts; // сохранения до этапа 7 без метки времени
  const backend = memBackend();
  const mirror = memMirror();
  mirror.m.set(MIRROR_PREFIX + 777, JSON.stringify(real));
  mirror.m.set(MIRROR_PREFIX + 888, "обрезано{");
  mirror.m.set("другой-ключ", "1");
  const store = new MapStore(backend, mirror);
  assert.equal(await store.migrate(), 1, "перенесена одна годная карта");
  assert.ok(backend.m.has("map:777"));
  assert.ok(!backend.m.has("map:888"), "испорченная не переносится");
  assert.ok(mirror.m.has(MIRROR_PREFIX + 777), "старые ключи не удаляются");
  assert.equal(await store.migrate(), 0, "второй раз ничего не делает");
  // из одного IndexedDB, без зеркала: данные целы (уровни, станок, монеты, контракты)
  const only = await new MapStore(backend, null).load(777);
  assert.deepEqual(only.buildings.find((e) => e[1] === 0), ["h", 0, 0, 0, null, 3]);
  assert.deepEqual(only.buildings.find((e) => e[1] === 2), ["c", 2, 0, 0, "gear", 2]);
  assert.equal(only.coins, 321);
  assert.deepEqual(only.done, [0, 1, 2]);
  const f = new Factory(777);
  assert.ok(f.loadJSON(only) >= 3);
  assert.equal(f.get(0, 0).lvl, 3);
  assert.equal(f.coins, 321);
}

// ---- удаление: карта не возвращается после «перезапуска» ----
{
  const backend = memBackend();
  const mirror = memMirror();
  for (const s of [11, 22]) mirror.m.set(MIRROR_PREFIX + s, JSON.stringify({ v: 1, seed: s, buildings: [], ts: s }));
  const store = new MapStore(backend, mirror);
  await store.migrate();
  assert.deepEqual((await store.list()).map((m) => m.seed), [22, 11]);
  await store.remove(11);
  assert.deepEqual((await store.list()).map((m) => m.seed), [22]);
  assert.ok(!mirror.m.has(MIRROR_PREFIX + 11) && !backend.m.has("map:11"), "удалено из обоих мест");
  const again = new MapStore(backend, mirror); // «перезапуск»: миграция уже была
  assert.equal(await again.migrate(), 0);
  assert.deepEqual((await again.list()).map((m) => m.seed), [22], "удалённая карта не воскресла");
  assert.equal(await again.load(11), null);
}

// ---- список карт: поля и порядок ----
{
  const store = new MapStore(memBackend(), memMirror());
  await store.save(1, { v: 1, seed: 1, buildings: [["b", 0, 0, 0]], coins: 50, pop: 2, ts: 100 });
  await store.save(2, { v: 1, seed: 2, buildings: [["b", 0, 0, 0], ["s", 1, 0, 0]], coins: 9, ts: 300 });
  await store.save(3, { v: 1, seed: 3, buildings: [], ts: 200 });
  const list = await store.list();
  assert.deepEqual(list.map((m) => m.seed), [2, 3, 1], "свежие сверху");
  assert.deepEqual(list[0], { seed: 2, ts: 300, buildings: 2, coins: 9, pop: 0 });
  assert.deepEqual(list[2], { seed: 1, ts: 100, buildings: 1, coins: 50, pop: 2 });
}

// ---- сбои хранилищ: игра не падает ----
{
  const mirror = memMirror();
  const store = new MapStore(failing(), mirror);
  assert.equal(await store.save(3, { v: 1, seed: 3, buildings: [], ts: 1 }), true, "зеркало спасает");
  assert.equal(store.errors.backend, true);
  assert.equal(store.works, true);
  assert.equal((await store.load(3)).ts, 1);
  assert.deepEqual((await store.list()).map((m) => m.seed), [3]);
  await store.remove(3);
  assert.equal(await store.load(3), null);
  const throwingMirror = { get: () => null, set: () => { throw new Error("quota"); }, del: () => {}, keys: () => [] };
  const s2 = new MapStore(memBackend(), throwingMirror);
  assert.equal(await s2.save(5, { v: 1, seed: 5, buildings: [], ts: 1 }), true);
  assert.equal(s2.errors.mirror, true);
  assert.equal(s2.works, true);
  assert.equal((await s2.load(5)).ts, 1);
  const dead = new MapStore(failing(), throwingMirror);
  assert.equal(await dead.save(5, { v: 1, seed: 5, buildings: [], ts: 1 }), false);
  assert.equal(dead.works, false, "меню покажет предупреждение «сохранение не работает»");
  assert.equal(new MapStore(null, null).works, false);
  assert.equal(await new MapStore(null, null).load(1), null);
  assert.deepEqual(await new MapStore(null, null).list(), []);
}

// ---- файл сохранения: экспорт, импорт, защита ----
{
  const real = realPayload(31, 12345);
  const file = exportFile(real, "abc123");
  assert.equal(file.name, "conveyor-city-map-31.json");
  const parsed = JSON.parse(file.text);
  assert.equal(parsed.format, FORMAT);
  assert.equal(parsed.version, "abc123");
  const ok = parseImport(file.text);
  assert.equal(ok.ok, true);
  assert.equal(ok.buildings, 3);
  assert.deepEqual(ok.payload.done, [0, 1, 2]);
  const f = new Factory(31);
  assert.ok(f.loadJSON(ok.payload) >= 3);
  assert.equal(f.get(2, 0).recipe, "gear");
  const bad = (t) => parseImport(t).ok;
  assert.equal(bad("не json"), false);
  assert.equal(bad(""), false);
  assert.equal(bad(file.text.slice(0, 50)), false, "обрезанный файл");
  assert.equal(bad(JSON.stringify({ format: "чужой", map: real })), false);
  assert.equal(bad(JSON.stringify({ format: FORMAT })), false);
  assert.equal(bad(JSON.stringify({ format: FORMAT, map: { ...real, seed: 0 } })), false);
  assert.equal(bad(JSON.stringify({ format: FORMAT, map: { ...real, seed: 2.5 } })), false);
  assert.equal(bad(JSON.stringify({ format: FORMAT, map: { ...real, seed: "31" } })), false);
  assert.equal(bad(JSON.stringify({ format: FORMAT, map: { ...real, buildings: "x" } })), false);
  assert.equal(bad(JSON.stringify({ format: FORMAT, map: { ...real, v: 7 } })), false);
  assert.equal(parseImport("x".repeat(MAX_FILE + 1)).error, "size");
  assert.equal(parseImport(null).ok, false);
  assert.equal(parseImport({}).ok, false);
  const messy = { ...real, buildings: [...real.buildings, null, ["x", 1, 1, 0], "s"], cam: "не камера", coins: "много" };
  const m = parseImport(JSON.stringify({ format: FORMAT, map: messy }));
  assert.equal(m.ok, true);
  assert.equal(m.buildings, 3);
  const store = new MapStore(memBackend(), memMirror());
  await store.save(ok.payload.seed, { ...ok.payload, ts: Date.now() });
  assert.equal((await store.load(31)).coins, 321);
}

// ---- обёртки браузерных хранилищ ----
{
  const ls = (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
  })();
  const mirror = createMirror(ls);
  mirror.set("a", "1");
  mirror.set("b", "2");
  assert.deepEqual(mirror.keys().sort(), ["a", "b"]);
  assert.equal(mirror.get("a"), "1");
  mirror.del("a");
  assert.equal(mirror.get("a"), null);
  assert.equal(createMirror(null), null);
  assert.equal(await openIdbBackend(null), null);
  const brokenIdb = { open: () => { const r = {}; setTimeout(() => { r.error = new Error("нет"); r.onerror?.(); }, 0); return r; } };
  assert.equal(await openIdbBackend(brokenIdb), null);
}

console.log("storage.test: проверки пройдены");
