// Симуляция завода: правила стройки, перевозка, заторы, слияния, сохранение предметов, сохранение игры.
import assert from "node:assert/strict";
import { Factory, BT, DIRS, TICK, itemPosition, ORE_ITEM } from "../src/factory.js";
import { T, tileAt } from "../src/worldgen.js";

const SEED = 1337;
const run = (f, seconds) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) f.tick();
};
// Ставит здание в обход canPlace: логику перевозки проверяем независимо от рельефа.
const force = (f, type, x, y, dir = 0, ore = 1) => {
  const old = f.get(x, y);
  if (old && (old.item || old.out)) f.lost++; // затёртый предмет считаем потерянным, как при сносе
  const b = f._make(type, x, y, dir);
  if (type === BT.MINER) b.ore = ore;
  f.map.set(x + "," + y, b);
  f._touch(x, y);
  return b;
};

// ---- правила стройки на настоящей карте ----
{
  const f = new Factory(SEED);
  let water, forest, hill, oreTile, plain;
  for (let y = -120; y < 120 && !(water && forest && hill && oreTile && plain); y++)
    for (let x = -120; x < 120; x++) {
      const t = tileAt(x, y, SEED);
      if (t.type === T.WATER && !water) water = { x, y };
      if (t.type === T.FOREST && !forest) forest = { x, y };
      if (t.type === T.HILL && !hill) hill = { x, y };
      if (t.ore && !oreTile) oreTile = { x, y };
      if (t.type === T.GRASS && !t.ore && !plain) plain = { x, y };
    }
  for (const [name, p] of [["вода", water], ["лес", forest], ["скалы", hill]]) {
    assert.ok(p, `на карте нет клетки: ${name}`);
    assert.equal(f.canPlace(BT.BELT, p.x, p.y).ok, false, `нельзя строить: ${name}`);
    assert.equal(f.canPlace(BT.STORAGE, p.x, p.y).reason, "terrain");
  }
  assert.equal(f.canPlace(BT.MINER, plain.x, plain.y).reason, "noore", "бур без руды");
  assert.equal(f.canPlace(BT.MINER, oreTile.x, oreTile.y).ok, true, "бур на руде");
  assert.ok(f.place(BT.MINER, oreTile.x, oreTile.y, 1));
  assert.equal(f.place(BT.BELT, oreTile.x, oreTile.y, 0), null, "поверх бура конвейер не ставится");
  assert.ok(f.place(BT.BELT, plain.x, plain.y, 0));
  assert.ok(f.place(BT.BELT, plain.x, plain.y, 2), "конвейер поверх конвейера поворачивается");
  assert.equal(f.get(plain.x, plain.y).dir, 2);
  assert.equal(f.count, 2);
  assert.equal(f.place(BT.STORAGE, plain.x, plain.y), null, "склад поверх конвейера не ставится");
  assert.ok(f.remove(plain.x, plain.y));
  assert.equal(f.remove(plain.x, plain.y), false);
}

// ---- прямая линия: бур -> 5 конвейеров -> склад ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, 1);
  for (let i = 1; i <= 5; i++) force(f, BT.BELT, i, 0, 0);
  force(f, BT.STORAGE, 6, 0);
  run(f, 20);
  const a = f.audit();
  assert.ok(a.ok, "учёт предметов: " + JSON.stringify(a));
  assert.ok(f.stock.iron_ore >= 7 && f.stock.iron_ore <= 9, `за 20 с ожидаем 7-9 руды, а на складе ${f.stock.iron_ore}`);
  assert.equal(a.lost, 0);
}

// ---- тупик: лента забивается, бур стоит с полным буфером ----
{
  const f = new Factory(SEED);
  const m = force(f, BT.MINER, 0, 0, 0, 2);
  for (let i = 1; i <= 5; i++) force(f, BT.BELT, i, 0, 0);
  run(f, 60);
  const a = f.audit();
  assert.ok(a.ok);
  assert.equal(a.onBelts, 5, "все 5 клеток заняты");
  assert.equal(a.inMiners, 1);
  assert.equal(m.blocked, true);
  const produced = f.produced;
  run(f, 10);
  assert.equal(f.produced, produced, "забитый бур не добывает новую руду");
  force(f, BT.STORAGE, 6, 0); // открыли склад: застрявшее доезжает
  run(f, 20);
  assert.ok(f.stock.copper_ore >= 6, "после открытия склада застрявшее доехало");
  assert.ok(f.audit().ok);
}

// ---- поворот: конвейеры вниз по y и склад ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, 3);
  force(f, BT.BELT, 1, 0, 0);
  force(f, BT.BELT, 2, 0, 1); // здесь поворот
  force(f, BT.BELT, 2, 1, 1);
  force(f, BT.STORAGE, 2, 2);
  run(f, 15);
  assert.ok(f.stock.coal >= 4, `уголь доехал через поворот: ${f.stock.coal}`);
  assert.ok(f.audit().ok);
}

// ---- слияние сбоку: две линии в одну ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, -1, 0, 0, 1);
  for (let x = 0; x <= 5; x++) force(f, BT.BELT, x, 0, 0);
  force(f, BT.STORAGE, 6, 0);
  force(f, BT.MINER, 3, 1, 3, 2); // стоит сбоку и смотрит на ленту (3,0)
  run(f, 40);
  assert.ok(f.stock.iron_ore >= 15, `основная линия: ${f.stock.iron_ore}`);
  assert.ok(f.stock.copper_ore >= 15, `боковая линия: ${f.stock.copper_ore}`);
  assert.ok(f.audit().ok);
}

// ---- лента в лоб не принимает; две ленты лоб в лоб ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, 1);
  force(f, BT.BELT, 1, 0, 2); // смотрит на бур: с передней стороны принимать нельзя
  run(f, 10);
  assert.equal(f.get(1, 0).item, null);
  assert.equal(f.get(0, 0).blocked, true);
  const g = new Factory(SEED);
  force(g, BT.MINER, 0, 0, 0, 1);
  force(g, BT.BELT, 1, 0, 0);
  force(g, BT.BELT, 2, 0, 2);
  run(g, 20);
  assert.ok(g.audit().ok);
  assert.equal(g.stock.iron_ore || 0, 0);
}

// ---- замкнутое кольцо: застревает, но без дублирования и зависаний ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, -1, 0, 0, 1);
  force(f, BT.BELT, 0, 0, 0);
  force(f, BT.BELT, 1, 0, 1);
  force(f, BT.BELT, 1, 1, 2);
  force(f, BT.BELT, 0, 1, 3);
  run(f, 60);
  const a = f.audit();
  assert.ok(a.ok, JSON.stringify(a));
  assert.ok(a.onBelts <= 4);
}

// ---- снос посреди движения: учёт теряет предметы честно ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, 1);
  for (let i = 1; i <= 6; i++) force(f, BT.BELT, i, 0, 0);
  force(f, BT.STORAGE, 7, 0);
  run(f, 12);
  const onBefore = f.audit().onBelts;
  for (let i = 1; i <= 6; i++) f.remove(i, 0);
  assert.ok(f.audit().ok);
  assert.equal(f.lost, onBefore, "снесённые предметы попали в потери");
  run(f, 5);
  assert.ok(f.audit().ok);
}

// ---- поворот ленты с предметом внутри ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, 1);
  force(f, BT.BELT, 1, 0, 0);
  run(f, 3);
  f.rotateAt(1, 0, 2); // теперь смотрит назад, на бур
  const b = f.get(1, 0);
  if (b.item) assert.notEqual(b.item.from, b.dir, "вход не может совпадать с выходом");
  run(f, 5);
  assert.ok(f.audit().ok);
}

// ---- положение предмета: прямая и поворот ----
{
  const straight = { x: 4, y: 7, dir: 0 };
  const p0 = itemPosition(straight, 2, 0);
  assert.deepEqual([p0.x, p0.y], [4, 7.5]); // вход с задней стороны (-x)
  const p5 = itemPosition(straight, 2, 0.5);
  assert.deepEqual([p5.x, p5.y], [4.5, 7.5]);
  const p1 = itemPosition(straight, 2, 1);
  assert.deepEqual([p1.x, p1.y], [5, 7.5]);
  const corner = { x: 0, y: 0, dir: 1 }; // выход в +y, вход со стороны -x
  const c0 = itemPosition(corner, 2, 0);
  assert.deepEqual([c0.x, c0.y], [0, 0.5]);
  const c1 = itemPosition(corner, 2, 1);
  assert.deepEqual([c1.x, c1.y], [0.5, 1]);
}

// ---- бур без руды (карту изменили) стоит и ничего не кладёт ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, 0); // ore = 0
  force(f, BT.BELT, 1, 0, 0);
  force(f, BT.STORAGE, 2, 0);
  run(f, 30);
  assert.equal(f.produced, 0);
  assert.deepEqual(f.stock, {});
}

// ---- сохранение и загрузка ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, 1);
  for (let i = 1; i <= 3; i++) force(f, BT.BELT, i, 0, i === 2 ? 1 : 0);
  force(f, BT.STORAGE, 4, 0);
  run(f, 20);
  const json = JSON.parse(JSON.stringify(f.toJSON()));
  const g = new Factory(SEED);
  assert.equal(g.loadJSON(json), 5);
  assert.equal(g.count, 5);
  assert.equal(g.get(2, 0).dir, 1);
  assert.equal(g.get(0, 0).type, BT.MINER);
  assert.deepEqual(g.stock, f.stock);
  assert.equal(new Factory(SEED + 1).loadJSON(json), -1, "чужая карта не грузится");
  assert.equal(new Factory(SEED).loadJSON({ ...json, v: 99 }), -1, "неизвестная версия");
  assert.equal(new Factory(SEED).loadJSON(null), -1);
  assert.equal(new Factory(SEED).loadJSON("мусор"), -1);
  const dirty = new Factory(SEED);
  const n = dirty.loadJSON({ v: 1, seed: SEED, buildings: [["b", 1, 1, 0], ["x", 2, 2, 0], ["b", 1.5, 2, 0], ["m", 3, 3, 9], null, "s"], stock: { iron_ore: 5, junk: 1, coal: -3 } });
  assert.equal(n, 1, "испорченные записи пропускаются");
  assert.deepEqual(dirty.stock, { iron_ore: 5 });
  run(dirty, 5);
  assert.ok(dirty.audit().ok);
}

// ---- случайная игра: учёт предметов сходится при любых действиях ----
{
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const f = new Factory(SEED);
  for (let step = 0; step < 6000; step++) {
    if (step % 5 === 0) {
      const x = Math.floor(rnd() * 8), y = Math.floor(rnd() * 8), r = rnd();
      if (r < 0.15) f.remove(x, y);
      else if (r < 0.25) f.rotateAt(x, y, Math.floor(rnd() * 4));
      else if (r < 0.35) force(f, BT.MINER, x, y, Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 3));
      else if (r < 0.45) force(f, BT.STORAGE, x, y);
      else force(f, BT.BELT, x, y, Math.floor(rnd() * 4));
    }
    f.tick();
    if (step % 100 === 0) {
      const a = f.audit();
      assert.ok(a.ok, `шаг ${step}: ${JSON.stringify(a)}`);
      for (const b of f.map.values()) {
        if (b.type !== BT.BELT || !b.item) continue;
        assert.ok(Object.values(ORE_ITEM).includes(b.item.t));
        assert.ok(b.item.p >= 0 && b.item.p <= 1);
        assert.ok(b.item.from >= 0 && b.item.from <= 3);
      }
    }
  }
}

assert.equal(DIRS.length, 4);
console.log("factory.test: проверки пройдены");
