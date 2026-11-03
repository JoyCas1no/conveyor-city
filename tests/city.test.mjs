// Город: лесопилка, насос, дом, магазин, парк, монеты, налоги, контракты, места на картах, тексты, учёт предметов.
import assert from "node:assert/strict";
import {
  Factory, BT, TICK, COSTS, ITEMS, START_COINS, HOUSE_CAP, CITY_RADIUS, inCityRange, sawmillSite, pumpSite,
} from "../src/factory.js";
import { contractAt, openIds, UNLOCK_AT, GATED, OPEN_SLOTS } from "../src/contracts.js";
import { tileAt, T } from "../src/worldgen.js";
import { STR } from "../src/strings.js";
import { LAMP } from "../src/buildingdraw.js";

const SEED = 1337;
const run = (f, seconds, each) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    if (each) each(i);
    f.tick();
  }
};
// Ставит здание в обход цен и рельефа (производитель получает «место»); затёртое возвращает содержимое на склад.
const force = (f, type, x, y, dir = 0) => {
  const old = f.get(x, y);
  if (old) f._giveBack(old);
  const b = f._make(type, x, y, dir);
  if (b.res !== undefined) b.res = true;
  f.map.set(x + "," + y, b);
  f._touch(x, y);
  return b;
};
const ok = (f, msg = "") => {
  const a = f.audit();
  assert.ok(a.ok, `учёт предметов ${msg}: ${a.bad.join(", ")}`);
};
const give = (f, item, n) => {
  f.stock[item] = (f.stock[item] || 0) + n;
  f.created[item] = (f.created[item] || 0) + n;
};
// Подаёт предмет в здание как лента, пока во входе есть место.
const feeder = (f, item, x, y, fx, fy) => () => {
  if (f.push(item, x, y, fx, fy)) f.created[item] = (f.created[item] || 0) + 1;
};
// Дом с лесопилкой и насосом вплотную: всегда доволен.
const happyHouse = (f, x = 0, y = 0) => {
  force(f, BT.SAWMILL, x - 1, y, 0);
  force(f, BT.PUMP, x, y - 1, 1);
  return force(f, BT.HOUSE, x, y);
};
const measure = (f, seconds, each) => {
  const before = f.coins + f.taxFrac;
  run(f, seconds, each);
  return f.coins + f.taxFrac - before;
};

// ---- на каждой карте есть место и для лесопилки, и для насоса недалеко от старта ----
for (const seed of [1, 1337, 42, 99999, 123456]) {
  const f = new Factory(seed);
  for (const t of ["iron_ingot", "iron_plate"]) give(f, t, 100);
  let saw = null;
  let pump = null;
  for (let r = 0; r <= 60 && !(saw && pump); r++) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== r) continue;
        if (!saw && f.canPlace(BT.SAWMILL, x, y).ok) saw = { x, y };
        if (!pump && f.canPlace(BT.PUMP, x, y).ok) pump = { x, y };
      }
    }
  }
  assert.ok(saw, `карта ${seed}: нет места для лесопилки в радиусе 60`);
  assert.ok(pump, `карта ${seed}: нет места для насоса в радиусе 60`);
  assert.ok(sawmillSite(saw.x, saw.y, seed) && pumpSite(pump.x, pump.y, seed));
}

// ---- правила мест: лес, вода, причины отказа ----
{
  const f = new Factory(SEED);
  give(f, "iron_ingot", 50);
  give(f, "iron_plate", 50);
  let nearForest, nearWater, plain;
  for (let y = -120; y < 120 && !(nearForest && nearWater && plain); y++) {
    for (let x = -120; x < 120; x++) {
      const t = tileAt(x, y, SEED);
      if (t.type !== T.GRASS && t.type !== T.SAND) continue;
      if (!nearForest && sawmillSite(x, y, SEED)) nearForest = { x, y };
      if (!nearWater && pumpSite(x, y, SEED)) nearWater = { x, y };
      if (!plain && !sawmillSite(x, y, SEED) && !pumpSite(x, y, SEED)) plain = { x, y };
    }
  }
  assert.equal(f.canPlace(BT.SAWMILL, plain.x, plain.y).reason, "noforest");
  assert.equal(f.canPlace(BT.PUMP, plain.x, plain.y).reason, "nowater");
  assert.ok(f.place(BT.SAWMILL, nearForest.x, nearForest.y));
  assert.ok(f.place(BT.PUMP, nearWater.x, nearWater.y));
  assert.equal(f.stock.iron_ingot, 50 - 10 - 10);
  assert.equal(f.stock.iron_plate, 50 - 5);
  // загрузка здания на изменившейся клетке: стоит и ничего не производит
  const g = new Factory(SEED);
  g.loadJSON({ v: 1, seed: SEED, buildings: [["w", plain.x, plain.y, 0], ["u", plain.x + 1, plain.y, 0]], stock: {} });
  assert.equal(g.get(plain.x, plain.y).res, false);
  assert.equal(g.status(g.get(plain.x, plain.y)), "idle");
  run(g, 20);
  assert.equal(g.audit().inMachines, 0);
  assert.equal(g.produced, 0);
}

// ---- производство: доска за 3 с, вода за 2 с ----
{
  const f = new Factory(SEED);
  force(f, BT.SAWMILL, 0, 0, 0);
  force(f, BT.STORAGE, 1, 0);
  force(f, BT.PUMP, 0, 2, 0);
  force(f, BT.STORAGE, 1, 2);
  run(f, 31);
  assert.ok(f.stock.plank >= 9 && f.stock.plank <= 10, `досок: ${f.stock.plank}`);
  assert.ok(f.stock.water >= 14 && f.stock.water <= 15, `воды: ${f.stock.water}`);
  ok(f, "производство");
}

// ---- дом: потребности, рост до 4 жителей, налог 10 монет в минуту ----
{
  const f = new Factory(SEED);
  const h = happyHouse(f);
  run(f, 5);
  assert.equal(f.status(h), "happy");
  assert.equal(h.pop, 0, "жители ещё не заселились");
  run(f, 30);
  assert.equal(h.pop, 1, "первый житель через 30 с");
  run(f, 100);
  assert.equal(h.pop, HOUSE_CAP, "больше 4 не заселяется");
  const gain = measure(f, 60);
  assert.ok(Math.abs(gain - 10) <= 1.01, `налог дома 10 в минуту, а ${gain.toFixed(2)}`);
  assert.equal(f.city.pop, 4);
  assert.equal(f.city.happy, 1);
  assert.equal(f.city.tax, 10);
  assert.equal(Number.isInteger(f.coins), true, "монеты целые");
  ok(f, "дом");
}

// ---- недовольный дом: без воды, без досок, без всего ----
{
  const f = new Factory(SEED);
  const a = force(f, BT.HOUSE, 0, 0);
  run(f, 2);
  assert.equal(f.status(a), "needboth");
  force(f, BT.PUMP, 0, -1, 1);
  run(f, 3);
  assert.equal(f.status(a), "needplank");
  const coins = f.coins;
  run(f, 120);
  assert.equal(a.pop, 0, "без досок жители не заселяются");
  assert.equal(f.coins, coins, "и налога нет");
  force(f, BT.SAWMILL, -1, 0, 0);
  run(f, 120);
  assert.ok(a.pop >= 3, "с водой и досками заселился");
  ok(f, "потребности");
}

// ---- налог и бонусы: магазин +50%, парк +25%, радиус по одной функции, пустой магазин, два магазина ----
{
  const taxWith = (setup) => {
    const f = new Factory(SEED);
    happyHouse(f);
    run(f, 150); // дом заселён
    const feeds = setup(f) || [];
    run(f, 20, (i) => feeds.forEach((fn) => fn(i)));
    return measure(f, 120, (i) => feeds.forEach((fn) => fn(i))) / 2; // монет в минуту
  };
  const base = taxWith(() => []);
  assert.ok(Math.abs(base - 10) < 0.6, `без магазина: ${base}`);
  const withShop = taxWith((f) => {
    force(f, BT.SHOP, 3, 0);
    return [feeder(f, "gear", 3, 0, 4, 0)];
  });
  assert.ok(Math.abs(withShop - 15) < 0.8, `с магазином 15, а ${withShop}`);
  const withBoth = taxWith((f) => {
    force(f, BT.SHOP, 3, 0);
    force(f, BT.PARK, 0, 3);
    return [feeder(f, "gear", 3, 0, 4, 0), feeder(f, "plank", 0, 3, 0, 4)];
  });
  assert.ok(Math.abs(withBoth - 17.5) < 0.9, `с магазином и парком 17,5, а ${withBoth}`);
  const emptyShop = taxWith((f) => {
    force(f, BT.SHOP, 3, 0);
    return [];
  });
  assert.ok(Math.abs(emptyShop - 10) < 0.6, `пустой магазин ничего не даёт: ${emptyShop}`);
  const far = taxWith((f) => {
    force(f, BT.SHOP, 6, 1); // расстояние 6,08: дальше радиуса
    return [feeder(f, "gear", 6, 1, 7, 1)];
  });
  assert.ok(Math.abs(far - 10) < 0.6, `магазин за радиусом ничего не даёт: ${far}`);
  const near6 = taxWith((f) => {
    force(f, BT.SHOP, 6, 0); // ровно 6: входит
    return [feeder(f, "gear", 6, 0, 7, 0)];
  });
  assert.ok(Math.abs(near6 - 15) < 0.8, `магазин на расстоянии 6 даёт бонус: ${near6}`);
  const twoShops = taxWith((f) => {
    force(f, BT.SHOP, 3, 0);
    force(f, BT.SHOP, -3, 0);
    return [feeder(f, "gear", 3, 0, 4, 0), feeder(f, "copper_wire", -3, 0, -4, 0)];
  });
  assert.ok(Math.abs(twoShops - 15) < 0.8, `два магазина считаются один раз: ${twoShops}`);
  assert.equal(CITY_RADIUS, 6);
  assert.equal(inCityRange(6, 0), true);
  assert.equal(inCityRange(6, 1), false);
  assert.equal(inCityRange(4, 4), true, "4,4: расстояние 5,66");
  assert.equal(inCityRange(5, 4), false);
}

// ---- магазин принимает шестерёнки и провода, только их; парк только доски ----
{
  const f = new Factory(SEED);
  const shop = force(f, BT.SHOP, 0, 0);
  const park = force(f, BT.PARK, 3, 0);
  assert.equal(f.push("gear", 0, 0, 1, 0), true);
  assert.equal(f.push("copper_wire", 0, 0, 1, 0), true);
  assert.equal(f.push("gear", 0, 0, 1, 0), false, "запас 2");
  assert.equal(f.push("iron_plate", 0, 0, 1, 0), false);
  assert.equal(f.push("plank", 3, 0, 4, 0), true);
  assert.equal(f.push("gear", 3, 0, 4, 0), false);
  f.created.gear = 1;
  f.created.copper_wire = 1;
  f.created.plank = 1;
  run(f, 1);
  assert.equal(f.status(shop), "work");
  assert.equal(f.status(park), "work");
  f.remove(0, 0);
  assert.equal(f.stock.gear + f.stock.copper_wire >= 1, true, "снос магазина вернул товары");
  ok(f, "магазин и парк");
}

// ---- цены с монетами, нехватка, возврат при сносе ----
{
  assert.deepEqual(COSTS.house, { coins: 30, plank: 10 });
  assert.deepEqual(COSTS.shop, { coins: 60, plank: 8, gear: 5 });
  assert.deepEqual(COSTS.park, { coins: 40, plank: 10 });
  assert.equal(START_COINS, 100);
  const f = new Factory(SEED);
  assert.equal(f.coins, 100);
  assert.deepEqual(f.canPlace(BT.HOUSE, 2, 2).missing, { plank: 10 });
  give(f, "plank", 40);
  assert.ok(f.place(BT.HOUSE, 2, 2));
  assert.ok(f.place(BT.HOUSE, 3, 3));
  assert.ok(f.place(BT.HOUSE, 4, 4));
  assert.equal(f.coins, 10);
  assert.equal(f.stock.plank, 10);
  const miss = f.canPlace(BT.HOUSE, 5, 5);
  assert.equal(miss.reason, "cost");
  assert.deepEqual(miss.missing, { coins: 20 }, "не хватает монет");
  assert.equal(f.place(BT.HOUSE, 5, 5), null);
  assert.equal(f.coins, 10, "неудачная покупка ничего не списывает");
  ok(f, "после покупок");
  f.remove(2, 2);
  assert.equal(f.coins, 40, "снос вернул 30 монет");
  assert.equal(f.stock.plank, 20, "и 10 досок");
  ok(f, "после возврата");
  const ev = f.takeEvents();
  assert.deepEqual(ev.map((e) => e.delta), [-30, -30, -30, 30], "события монет для «−30»");
  assert.deepEqual(f.takeEvents(), []);
}

// ---- закрытые постройки и контракты ----
{
  const f = new Factory(SEED);
  give(f, "plank", 100);
  give(f, "gear", 20);
  assert.equal(f.canPlace(BT.SHOP, 2, 2).reason, "locked");
  assert.equal(f.canPlace(BT.PARK, 2, 2).reason, "locked");
  assert.equal(f.canPlace(BT.HOUSE, 2, 2).ok, true, "дом открыт сразу");
  assert.equal(f.canPlace(BT.CONSTRUCTOR, 2, 2).reason === "locked", false, "старые постройки не закрыты");
  assert.deepEqual(f.lockInfo(BT.SHOP), { index: 0, title: "Первый заказ" });
  assert.deepEqual(f.lockInfo(BT.PARK), { index: 1, title: "Утолить жажду" });
  assert.equal(f.lockInfo(BT.HOUSE), null);
  assert.deepEqual(f.contracts().map((c) => c.id), [0, 1, 2]);
  const c0 = f.contracts()[0];
  assert.deepEqual(c0.need, { plank: 20 });
  f.stock.plank = 19; // «потратили» 81: записываем в учёт как исчезнувшие
  f.sunk.plank = (f.sunk.plank || 0) + 81;
  assert.equal(f.deliver(0), false);
  give(f, "plank", 81);
  const coins = f.coins;
  assert.equal(f.deliver(0), true);
  assert.equal(f.stock.plank, 80, "20 досок списано");
  assert.equal(f.coins, coins + 100);
  assert.equal(f.deliver(0), false, "второй раз нельзя");
  assert.deepEqual(f.contracts().map((c) => c.id), [1, 2, 3]);
  assert.equal(f.canPlace(BT.SHOP, 2, 2).ok, true, "магазин открылся после первого контракта");
  assert.equal(f.canPlace(BT.PARK, 2, 2).reason, "locked");
  // контракт на жителей не списывает жителей
  const h = happyHouse(f, 10, 10);
  run(f, 140);
  assert.equal(h.pop, 4);
  give(f, "water", 15);
  assert.equal(f.deliver(1), true);
  assert.equal(f.canPlace(BT.PARK, 2, 2).ok, true, "парк открылся после второго");
  assert.equal(f.contracts().find((c) => c.id === 2).ready, true, "население 4 набрано");
  assert.equal(f.deliver(2), true);
  assert.equal(h.pop, 4, "жители остались");
  ok(f, "контракты");
  assert.equal(f.deliver(5), false);
  assert.equal(f.deliver(-1), false);
}

// ---- данные контрактов ----
{
  assert.equal(OPEN_SLOTS, 3);
  assert.deepEqual(UNLOCK_AT, { 0: "shop", 1: "park" });
  assert.deepEqual(GATED, { shop: 0, park: 1 });
  for (let i = 0; i < 60; i++) {
    const c = contractAt(i);
    assert.equal(c.id, i);
    assert.ok(c.title.length > 3);
    assert.ok(c.coins > 0);
    assert.ok(Object.keys(c.need).length >= 1);
    for (const [k, n] of Object.entries(c.need)) assert.ok(n > 0 && (k === "residents" || ITEMS.includes(k)), "предмет контракта: " + k);
    if (i > 6) assert.ok(c.coins >= contractAt(i - 1).coins, "награда не падает");
  }
  assert.equal(contractAt(6).coins, 450);
  assert.equal(contractAt(0).coins, 100);
  assert.deepEqual(openIds(new Set([0, 1])), [2, 3, 4]);
  assert.deepEqual(openIds(new Set()), [0, 1, 2]);
}

// ---- сохранение ----
{
  const f = new Factory(SEED);
  happyHouse(f);
  f.coins = 77;
  f.done = new Set([0, 3]);
  const json = JSON.parse(JSON.stringify(f.toJSON()));
  assert.equal(json.coins, 77);
  const g = new Factory(SEED);
  assert.ok(g.loadJSON(json) >= 3);
  assert.equal(g.coins, 77);
  assert.deepEqual([...g.done].sort(), [0, 3]);
  assert.equal(g.get(0, 0).type, BT.HOUSE);
  assert.equal(g.isLocked(BT.SHOP), false, "магазин открыт: контракт 0 сдан");
  assert.equal(g.isLocked(BT.PARK), true);
  const old = new Factory(SEED);
  old.loadJSON({ v: 1, seed: SEED, buildings: [["m", 0, 0, 0]], stock: { iron_ore: 3 } });
  assert.equal(old.coins, 100, "старые сохранения получают стартовые монеты");
  assert.equal(old.done.size, 0);
  const bad = new Factory(SEED);
  bad.loadJSON({ v: 1, seed: SEED, buildings: [], stock: {}, coins: -5, done: [1, "x", 2.5, -3, 4] });
  assert.equal(bad.coins, 100);
  assert.deepEqual([...bad.done].sort(), [1, 4]);
  const huge = new Factory(SEED);
  huge.loadJSON({ v: 1, seed: SEED, buildings: [], stock: {}, coins: 12.9 });
  assert.equal(huge.coins, 12);
  const skip = new Factory(SEED);
  assert.equal(skip.loadJSON({ v: 1, seed: SEED, buildings: [["?", 1, 1, 0], ["h", 2, 2, 0]], stock: {} }), 1);
}

// ---- цепочка с нуля: доски со склада, дом на стартовые монеты, довольный дом, налог, первый контракт, магазин ----
{
  const f = new Factory(SEED);
  force(f, BT.SAWMILL, 0, 0, 0);
  f.place(BT.STORAGE, 1, 0);
  run(f, 40);
  assert.ok(f.stock.plank >= 10, `досок на дом: ${f.stock.plank}`);
  const house = f.place(BT.HOUSE, 3, 3);
  assert.ok(house, "первый дом покупается на стартовые монеты и доски");
  assert.equal(f.coins, 70);
  force(f, BT.SAWMILL, 2, 3, 0); // вплотную к дому
  force(f, BT.PUMP, 3, 2, 1);
  run(f, 100);
  assert.equal(f.status(house), "happy");
  assert.ok(house.pop >= 3);
  const coins = f.coins;
  run(f, 120);
  assert.ok(f.coins > coins, "первый налог пришёл");
  assert.equal(f.takeEvents().some((e) => e.why === "tax"), true);
  for (let s = 0; s < 120 && f.stock.plank < 20; s++) run(f, 1);
  assert.ok(f.stock.plank >= 20);
  assert.equal(f.deliver(0), true, "первый контракт сдан");
  give(f, "gear", 5);
  assert.ok(f.place(BT.SHOP, 6, 3), "магазин открылся и куплен (60 монет, 8 досок, 5 шестерёнок)");
  ok(f, "цепочка с нуля");
}

// ---- тексты: каждая причина отказа и каждый статус имеют строку, а каждый статус цвет лампочки ----
{
  const reasons = ["terrain", "occupied", "noore", "noforest", "nowater", "locked", "cost"];
  for (const r of reasons) assert.equal(typeof STR.reason[r], "string", "нет текста причины: " + r);
  const statuses = ["work", "blocked", "idle", "noore", "nofuel", "clog", "noinput", "power", "nopower", "unplugged", "happy", "needwater", "needplank", "needboth"];
  for (const st of statuses) {
    assert.equal(typeof STR.status[st], "string", "нет текста статуса: " + st);
    assert.ok(LAMP[st] !== undefined, "нет цвета лампочки: " + st);
  }
  const f = new Factory(SEED);
  const seen = new Set();
  let n = 0;
  for (const t of Object.values(BT)) seen.add(f.status(force(f, t, 20 + n++, 0, 0)));
  run(f, 3);
  for (const b of f.map.values()) seen.add(f.status(b));
  for (const st of seen) assert.ok(statuses.includes(st), "статус вне списка: " + st);
  for (const t of Object.values(BT)) {
    assert.equal(typeof STR.building[t], "string", "нет названия: " + t);
    if (t !== BT.BELT) assert.equal(typeof STR.toolHint[t], "string", "нет подсказки: " + t);
  }
  for (const it of ITEMS) assert.equal(typeof STR.item[it], "string", "нет названия предмета: " + it);
  assert.equal(typeof STR.item.coins, "string", "нет названия «монеты»");
}

// ---- случайная игра со всем городом, контрактами и сносом: учёт сходится ----
{
  let s = 99;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const f = new Factory(SEED);
  const types = [BT.BELT, BT.BELT, BT.STORAGE, BT.SAWMILL, BT.PUMP, BT.HOUSE, BT.HOUSE, BT.SHOP, BT.PARK, BT.SPLITTER, BT.MINER];
  for (let step = 0; step < 10000; step++) {
    if (step % 4 === 0) {
      const x = Math.floor(rnd() * 8), y = Math.floor(rnd() * 8), r = rnd();
      if (r < 0.15) f.remove(x, y);
      else if (r < 0.2) f.rotateAt(x, y, Math.floor(rnd() * 4));
      else if (r < 0.3) for (const t of ITEMS) give(f, t, 5);
      else if (r < 0.34) f.deliver(Math.floor(rnd() * 6));
      else if (r < 0.37) f.coins += 50;
      else {
        const t = types[Math.floor(rnd() * types.length)];
        if (r < 0.65) {
          const b = force(f, t, x, y, Math.floor(rnd() * 4));
          if (b.ore !== undefined) b.ore = 1 + Math.floor(rnd() * 3);
        } else f.place(t, x, y, Math.floor(rnd() * 4));
      }
    }
    f.tick();
    if (step % 100 === 0) {
      ok(f, `шаг ${step}`);
      assert.ok(Number.isInteger(f.coins) && f.coins >= 0, "монеты целые и не отрицательные: " + f.coins);
      for (const b of f.map.values()) {
        if (b.type === BT.HOUSE) assert.ok(b.pop >= 0 && b.pop <= HOUSE_CAP && b.bw <= 2 && b.bp <= 2 && b.bw >= 0 && b.bp >= 0);
        if (b.type === BT.SHOP) assert.ok(b.items.length <= 2);
        if (b.type === BT.PARK) assert.ok(b.buf >= 0 && b.buf <= 2);
      }
      for (const t of ITEMS) assert.ok((f.stock[t] || 0) >= 0, "отрицательный склад: " + t);
    }
  }
}

console.log("city.test: проверки пройдены");
