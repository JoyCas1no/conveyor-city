// Уровни Mk1-Mk3: правила, эффекты, «на месте», возврат при сносе, сохранение, тексты, учёт предметов.
import assert from "node:assert/strict";
import { Factory, BT, TICK, POWER, ITEMS, inCityRange } from "../src/factory.js";
import { UPGRADES, LEVEL_UNLOCK, MAX_LEVEL, SPEED, HOUSE_CAP_BY, TAX_BY, isUpgradable, upgradeTotal } from "../src/upgrades.js";
import { STR } from "../src/strings.js";

const SEED = 1337;
const run = (f, seconds, each) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    if (each) each(i);
    f.tick();
  }
};
// Ставит здание в обход цен и рельефа; затёртое возвращает содержимое на склад.
const force = (f, type, x, y, dir = 0, lvl = 1, extra) => {
  const old = f.get(x, y);
  if (old) f._giveBack(old);
  const b = f._make(type, x, y, dir, extra, lvl);
  if (b.res !== undefined) b.res = true;
  if (b.ore !== undefined) b.ore = 1; // бур стоит «на руде»
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
const richFor = (f) => {
  f.coins += 5000;
  for (const t of ITEMS) give(f, t, 200);
};
const feeder = (f, item, x, y, fx, fy) => () => {
  if (f.push(item, x, y, fx, fy)) f.created[item] = (f.created[item] || 0) + 1;
};

// ---- данные: цены из согласованной таблицы ----
{
  assert.equal(MAX_LEVEL, 3);
  assert.deepEqual(UPGRADES.miner[2], { coins: 50, iron_ingot: 10 });
  assert.deepEqual(UPGRADES.miner[3], { coins: 150, iron_plate: 10, gear: 5 });
  assert.deepEqual(UPGRADES.smelter[2], { coins: 80, iron_plate: 10 });
  assert.deepEqual(UPGRADES.constructor[3], { coins: 200, gear: 10, copper_wire: 10 });
  assert.deepEqual(UPGRADES.powerplant[2], { coins: 150, iron_ingot: 20 });
  assert.deepEqual(UPGRADES.powerplant[3], { coins: 300, iron_plate: 15, gear: 10 });
  assert.deepEqual(UPGRADES.house[2], { coins: 60, plank: 15 });
  assert.deepEqual(UPGRADES.house[3], { coins: 150, plank: 25, gear: 5 });
  assert.deepEqual(UPGRADES.shop[3], { coins: 250, plank: 20, copper_wire: 5 });
  assert.deepEqual(UPGRADES.park[2], { coins: 100, plank: 10 });
  assert.deepEqual(Object.keys(UPGRADES).sort(), ["constructor", "house", "miner", "park", "powerplant", "pump", "sawmill", "shop", "smelter"]);
  assert.deepEqual(LEVEL_UNLOCK, { 2: 2, 3: 4 });
  for (const t of ["belt", "storage", "splitter", "pole", "solar"]) assert.equal(isUpgradable(t), false, t + " не улучшается");
  assert.equal(isUpgradable("constructor"), true, "hasOwn: «constructor» это настоящее здание, а не прототип");
  assert.equal(isUpgradable("toString"), false);
  assert.deepEqual(upgradeTotal("house", 3), { coins: 210, plank: 40, gear: 5 });
  assert.deepEqual(upgradeTotal("house", 1), {});
  assert.deepEqual(upgradeTotal("belt", 3), {});
  for (const t of Object.keys(UPGRADES)) for (const l of [2, 3]) for (const k of Object.keys(UPGRADES[t][l])) assert.ok(k === "coins" || ITEMS.includes(k), `предмет цены: ${t} ${l} ${k}`);
}

// ---- правила: контракты, цена, максимум ----
{
  const f = new Factory(SEED);
  const m = force(f, BT.MINER, 0, 0);
  assert.equal(m.lvl, 1);
  assert.equal(f.canUpgrade(0, 0).reason, "locked", "Mk2 закрыт до контракта №3");
  assert.equal(f.canUpgrade(0, 0).lock.title, "Новосёлы");
  richFor(f);
  assert.equal(f.upgrade(0, 0), false);
  assert.equal(m.lvl, 1);
  f.done.add(2);
  const c = f.canUpgrade(0, 0);
  assert.equal(c.ok, true);
  assert.deepEqual(c.cost, { coins: 50, iron_ingot: 10 });
  const coins = f.coins;
  const ingots = f.stock.iron_ingot;
  assert.equal(f.upgrade(0, 0), true);
  assert.equal(m.lvl, 2);
  assert.equal(f.coins, coins - 50);
  assert.equal(f.stock.iron_ingot, ingots - 10);
  assert.equal(f.canUpgrade(0, 0).reason, "locked", "Mk3 закрыт до контракта №5");
  assert.equal(f.canUpgrade(0, 0).lock.title, "Квартал");
  f.done.add(4);
  assert.equal(f.upgrade(0, 0), true);
  assert.equal(m.lvl, 3);
  assert.equal(f.canUpgrade(0, 0).reason, "max");
  assert.equal(f.upgrade(0, 0), false);
  assert.equal(m.lvl, 3);
  ok(f, "улучшения");
  const g = new Factory(SEED);
  force(g, BT.SMELTER, 0, 0);
  g.done.add(2);
  g.coins = 100;
  const cc = g.canUpgrade(0, 0);
  assert.equal(cc.reason, "cost");
  assert.deepEqual(cc.missing, { iron_plate: 10 });
  assert.equal(g.upgrade(0, 0), false);
  assert.equal(g.coins, 100);
  g.coins = 10;
  give(g, "iron_plate", 10);
  assert.deepEqual(g.canUpgrade(0, 0).missing, { coins: 70 });
  force(g, BT.BELT, 3, 0);
  assert.equal(g.canUpgrade(3, 0).reason, "none");
  assert.equal(g.canUpgrade(9, 9).reason, "none");
  assert.equal(g.upgrade(3, 0), false);
}

// ---- скорость: бур, лесопилка, насос ----
{
  const rate = (type, lvl, item) => {
    const f = new Factory(SEED);
    force(f, type, 0, 0, 0, lvl);
    f.place(BT.STORAGE, 1, 0);
    run(f, 60);
    return f.stock[item] || 0;
  };
  for (const [type, item, base] of [[BT.MINER, "iron_ore", 30], [BT.SAWMILL, "plank", 20], [BT.PUMP, "water", 30]]) {
    const r1 = rate(type, 1, item);
    const r2 = rate(type, 2, item);
    const r3 = rate(type, 3, item);
    assert.ok(Math.abs(r1 - base) <= 1, `${type} Mk1: ${r1}`);
    assert.ok(Math.abs(r2 - base * 1.5) <= 2, `${type} Mk2: ${r2}`);
    assert.ok(Math.abs(r3 - base * 2) <= 2, `${type} Mk3: ${r3}`);
  }
  assert.deepEqual(SPEED.slice(1), [1, 1.5, 2]);
}

// ---- плавильня и станок: скорость и расход энергии ----
{
  const powered = (f, x, y) => {
    force(f, BT.POLE, x, y + 2);
    for (let i = 0; i < 6; i++) force(f, BT.SOLAR, x - 2 + i, y + 3); // 36 ед.: хватает всем уровням
  };
  const ingots = (lvl) => {
    const f = new Factory(SEED);
    force(f, BT.SMELTER, 0, 0, 0, lvl);
    force(f, BT.STORAGE, 1, 0);
    powered(f, 0, 0);
    run(f, 60, feeder(f, "iron_ore", 0, 0, -1, 0));
    return f.stock.iron_ingot || 0;
  };
  const a = ingots(1), b = ingots(2), c = ingots(3);
  assert.ok(Math.abs(a - 20) <= 2, `плавильня Mk1: ${a}`);
  assert.ok(Math.abs(b - 30) <= 2, `Mk2: ${b}`);
  assert.ok(Math.abs(c - 40) <= 2, `Mk3: ${c}`);
  const plates = (lvl) => {
    const f = new Factory(SEED);
    force(f, BT.CONSTRUCTOR, 0, 0, 0, lvl, "plate");
    force(f, BT.STORAGE, 1, 0);
    powered(f, 0, 0);
    let demand = 0;
    run(f, 60, (i) => {
      feeder(f, "iron_ingot", 0, 0, -1, 0)();
      if (i === 30) demand = f.grid.demand;
    });
    return { n: f.stock.iron_plate || 0, demand };
  };
  const p1 = plates(1), p2 = plates(2), p3 = plates(3);
  assert.ok(Math.abs(p1.n - 30) <= 2 && Math.abs(p2.n - 45) <= 3 && Math.abs(p3.n - 60) <= 3, `станок: ${p1.n}, ${p2.n}, ${p3.n}`);
  assert.deepEqual([p1.demand, p2.demand, p3.demand], [POWER.constructor, POWER.constructor * 1.5, POWER.constructor * 2], "расход энергии 5, 7,5, 10");
}

// ---- электростанция: выработка по уровню; тот же уголь даёт больше энергии ----
{
  const run1 = (lvl) => {
    const f = new Factory(SEED);
    const pl = force(f, BT.POWERPLANT, 0, 0, 0, lvl);
    pl.coal = 4;
    f.created.coal = 4;
    force(f, BT.POLE, 2, 1);
    force(f, BT.CONSTRUCTOR, 3, 0, 0, 1, "plate");
    force(f, BT.STORAGE, 4, 0);
    run(f, 120, feeder(f, "iron_ingot", 3, 0, 2, 0));
    const used = (f.sunk.coal || 0) + (pl.burning ? 1 - pl.burn / (10 / TICK) : 0);
    return { supply: f.grid.supply, used, ok: f.audit().ok };
  };
  const a = run1(1), b = run1(2), c = run1(3);
  assert.deepEqual([a.supply, b.supply, c.supply], [30, 45, 60]);
  assert.ok(a.ok && b.ok && c.ok);
  // один уголь горит столько же при полной нагрузке, а энергии за него больше: при том же спросе уходит 1, 1/1,5, 1/2 угля
  assert.ok(Math.abs(b.used - a.used / 1.5) < 0.3 && Math.abs(c.used - a.used / 2) < 0.3, `уголь: ${a.used.toFixed(2)}, ${b.used.toFixed(2)}, ${c.used.toFixed(2)}`);
}

// ---- дом: жители 4/6/8, налог 10/15/20; улучшение на месте ----
{
  const house = (lvl) => {
    const f = new Factory(SEED);
    force(f, BT.SAWMILL, -1, 0, 0, 3);
    force(f, BT.PUMP, 0, -1, 1, 3);
    const h = force(f, BT.HOUSE, 0, 0, 0, lvl);
    run(f, 300);
    const before = f.coins + f.taxFrac;
    run(f, 60);
    return { pop: h.pop, tax: f.coins + f.taxFrac - before };
  };
  const a = house(1), b = house(2), c = house(3);
  assert.deepEqual([a.pop, b.pop, c.pop], [4, 6, 8]);
  assert.ok(Math.abs(a.tax - 10) < 1.1 && Math.abs(b.tax - 15) < 1.1 && Math.abs(c.tax - 20) < 1.1, `налог ${a.tax}, ${b.tax}, ${c.tax}`);
  assert.deepEqual(HOUSE_CAP_BY.slice(1), [4, 4, 6, 8].slice(1));
  assert.deepEqual(TAX_BY.slice(1), [10, 10, 15, 20].slice(1));
  // потребности: у Mk3 вода и доски уходят быстрее
  const used = (lvl) => {
    const f = new Factory(SEED);
    const h = force(f, BT.HOUSE, 0, 0, 0, lvl);
    h.bw = 2;
    h.bp = 2;
    f.created.water = 2;
    f.created.plank = 2;
    run(f, 130);
    return (f.sunk.water || 0) + (f.sunk.plank || 0);
  };
  assert.ok(used(3) >= used(1), "Mk3 тратит не меньше Mk1");
  const g = new Factory(SEED);
  force(g, BT.SAWMILL, -1, 0, 0, 3);
  force(g, BT.PUMP, 0, -1, 1, 3);
  const h = force(g, BT.HOUSE, 0, 0, 0, 1);
  run(g, 200);
  assert.equal(h.pop, 4);
  richFor(g);
  g.done.add(2);
  assert.equal(g.upgrade(0, 0), true);
  assert.equal(h.pop, 4, "жители остались");
  run(g, 70);
  assert.ok(h.pop >= 6, "и заселяется ещё: " + h.pop);
  ok(g, "дом улучшен");
}

// ---- магазин и парк: бонус и радиус по уровню; лучший из нескольких ----
{
  const taxWith = (setup) => {
    const f = new Factory(SEED);
    force(f, BT.SAWMILL, -1, 0, 0, 3);
    force(f, BT.PUMP, 0, -1, 1, 3);
    force(f, BT.HOUSE, 0, 0, 0, 1);
    run(f, 200);
    const feeds = setup(f);
    run(f, 20, (i) => feeds.forEach((fn) => fn(i)));
    const before = f.coins + f.taxFrac;
    run(f, 120, (i) => feeds.forEach((fn) => fn(i)));
    return (f.coins + f.taxFrac - before) / 2;
  };
  const shop = (lvl, x, y) => taxWith((f) => {
    force(f, BT.SHOP, x, y, 0, lvl);
    return [feeder(f, "gear", x, y, x + 1, y)];
  });
  assert.ok(Math.abs(shop(1, 3, 0) - 15) < 0.8, "Mk1 +50%");
  assert.ok(Math.abs(shop(2, 3, 0) - 17.5) < 0.8, "Mk2 +75%");
  assert.ok(Math.abs(shop(3, 3, 0) - 20) < 0.9, "Mk3 +100%");
  assert.ok(Math.abs(shop(1, 7, 0) - 10) < 0.6, "радиус Mk1 6: на расстоянии 7 нет бонуса");
  assert.ok(Math.abs(shop(2, 7, 0) - 17.5) < 0.8, "радиус Mk2 7: на расстоянии 7 бонус есть");
  assert.ok(Math.abs(shop(2, 8, 0) - 10) < 0.6, "на расстоянии 8 у Mk2 нет");
  assert.ok(Math.abs(shop(3, 8, 0) - 20) < 0.9, "радиус Mk3 8");
  assert.equal(inCityRange(7, 0, 7), true);
  assert.equal(inCityRange(7, 1, 7), false);
  const park = (lvl) => taxWith((f) => {
    force(f, BT.PARK, 0, 3, 0, lvl);
    return [feeder(f, "plank", 0, 3, 0, 4)];
  });
  const p1 = park(1), p2 = park(2), p3 = park(3);
  assert.ok(Math.abs(p1 - 12.5) < 0.7 && Math.abs(p2 - 14) < 0.7 && Math.abs(p3 - 15) < 0.8, `парки: ${p1}, ${p2}, ${p3}`);
  const two = taxWith((f) => {
    force(f, BT.SHOP, 3, 0, 0, 1);
    force(f, BT.SHOP, -3, 0, 0, 3);
    return [feeder(f, "gear", 3, 0, 4, 0), feeder(f, "copper_wire", -3, 0, -4, 0)];
  });
  assert.ok(Math.abs(two - 20) < 0.9, `лучший бонус, а не сумма: ${two}`);
}

// ---- «на месте»: содержимое машин не пропадает ----
{
  const f = new Factory(SEED);
  richFor(f);
  f.done.add(2);
  const m = force(f, BT.MINER, 0, 0, 0, 1);
  m.out = "iron_ore";
  m.prog = 1.5;
  f.created.iron_ore = (f.created.iron_ore || 0) + 1;
  const sm = force(f, BT.SMELTER, 3, 0, 0, 1);
  sm.in.iron_ore = 2;
  sm.fuel = 7;
  f.created.iron_ore += 2;
  const c = force(f, BT.CONSTRUCTOR, 6, 0, 0, 1, "gear");
  c.have = 2;
  f.created.iron_ingot = (f.created.iron_ingot || 0) + 2;
  assert.ok(f.upgrade(0, 0) && f.upgrade(3, 0) && f.upgrade(6, 0));
  assert.deepEqual([m.out, m.prog], ["iron_ore", 1.5]);
  assert.deepEqual([sm.in.iron_ore, sm.fuel], [2, 7]);
  assert.deepEqual([c.have, c.recipe], [2, "gear"]);
  ok(f, "содержимое");
}

// ---- снос возвращает всё: базу и все улучшения ----
{
  const f = new Factory(SEED);
  richFor(f);
  f.done.add(2);
  f.done.add(4);
  const coins = f.coins;
  const stock = { ...f.stock };
  const h = f.place(BT.HOUSE, 2, 2);
  assert.ok(h);
  assert.ok(f.upgrade(2, 2));
  assert.ok(f.upgrade(2, 2));
  assert.equal(h.lvl, 3);
  assert.equal(f.coins, coins - 30 - 60 - 150, "потрачено 240 монет");
  ok(f, "после покупок");
  f.takeEvents();
  assert.ok(f.remove(2, 2));
  assert.equal(f.coins, coins, "все монеты вернулись");
  assert.deepEqual({ plank: f.stock.plank, gear: f.stock.gear }, { plank: stock.plank, gear: stock.gear }, "и доски, и шестерёнки");
  ok(f, "после возврата");
  const ev = f.takeEvents();
  assert.ok(ev.some((e) => e.why === "refund" && e.delta === 240), "событие возврата 240");
  const g = new Factory(SEED);
  richFor(g);
  g.done.add(2);
  g.done.add(4);
  const gc = g.coins;
  const gi = g.stock.iron_ingot;
  const gp = g.stock.iron_plate;
  const gg = g.stock.gear;
  g.place(BT.POWERPLANT, 1, 1);
  g.upgrade(1, 1);
  g.upgrade(1, 1);
  g.remove(1, 1);
  assert.deepEqual([g.coins, g.stock.iron_ingot, g.stock.iron_plate, g.stock.gear], [gc, gi, gp, gg]);
  ok(g, "станция Mk3");
}

// ---- события монет: «−150» при улучшении ----
{
  const f = new Factory(SEED);
  richFor(f);
  f.done.add(2);
  force(f, BT.POWERPLANT, 0, 0, 0, 1);
  f.takeEvents();
  assert.ok(f.upgrade(0, 0));
  assert.deepEqual(f.takeEvents(), [{ delta: -150, why: "upgrade" }]);
}

// ---- сохранение: уровни, старые форматы, мусор ----
{
  const f = new Factory(SEED);
  force(f, BT.HOUSE, 0, 0, 0, 3);
  force(f, BT.CONSTRUCTOR, 2, 0, 0, 2, "wire");
  force(f, BT.MINER, 4, 0, 1, 2);
  force(f, BT.BELT, 5, 0, 1);
  force(f, BT.POLE, 6, 0);
  const json = JSON.parse(JSON.stringify(f.toJSON()));
  const byX = Object.fromEntries(json.buildings.map((e) => [e[1], e]));
  assert.deepEqual(byX[0], ["h", 0, 0, 0, null, 3]);
  assert.deepEqual(byX[2], ["c", 2, 0, 0, "wire", 2]);
  assert.deepEqual(byX[5], ["b", 5, 0, 1], "обычное здание без уровня пишется как раньше");
  const g = new Factory(SEED);
  g.loadJSON(json);
  assert.deepEqual([g.get(0, 0).lvl, g.get(2, 0).lvl, g.get(2, 0).recipe, g.get(4, 0).lvl, g.get(5, 0).lvl, g.get(6, 0).lvl], [3, 2, "wire", 2, 1, 1]);
  const old = new Factory(SEED);
  old.loadJSON({ v: 1, seed: SEED, buildings: [["h", 1, 1, 0], ["c", 3, 3, 0, "gear"]], stock: {} });
  assert.deepEqual([old.get(1, 1).lvl, old.get(3, 3).lvl], [1, 1]);
  const bad = new Factory(SEED);
  bad.loadJSON({ v: 1, seed: SEED, buildings: [["h", 1, 1, 0, null, 9], ["h", 2, 2, 0, null, 0], ["h", 3, 3, 0, null, "x"], ["h", 4, 4, 0, null, 2.5], ["b", 5, 5, 0, null, 3], ["l", 6, 6, 0, null, 3]], stock: {} });
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((i) => bad.get(i, i).lvl), [1, 1, 1, 1, 1, 1]);
}

// ---- тексты улучшений ----
{
  for (const t of Object.keys(UPGRADES)) for (const l of [2, 3]) assert.equal(typeof STR.upgrade.effect[t][l], "string", `нет текста улучшения: ${t} ${l}`);
  for (const r of ["none", "max", "locked", "cost"]) assert.equal(typeof STR.upgrade.reason[r], "string", "нет причины: " + r);
  for (const k of ["title", "now", "button", "maxed", "done"]) assert.equal(typeof STR.upgrade[k], "string");
}

// ---- случайная игра с улучшениями: учёт сходится, значения в границах ----
{
  let s = 2024;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const f = new Factory(SEED);
  f.done = new Set([0, 1, 2, 3, 4]);
  const types = [BT.BELT, BT.BELT, BT.STORAGE, BT.SAWMILL, BT.PUMP, BT.HOUSE, BT.HOUSE, BT.SHOP, BT.PARK, BT.SMELTER, BT.CONSTRUCTOR, BT.POLE, BT.POWERPLANT, BT.SOLAR, BT.MINER];
  for (let step = 0; step < 10000; step++) {
    if (step % 4 === 0) {
      const x = Math.floor(rnd() * 8), y = Math.floor(rnd() * 8), r = rnd();
      if (r < 0.12) f.remove(x, y);
      else if (r < 0.2) f.upgrade(x, y);
      else if (r < 0.26) f.rotateAt(x, y, Math.floor(rnd() * 4));
      else if (r < 0.34) {
        f.coins += 200;
        for (const t of ITEMS) give(f, t, 8);
      } else {
        const t = types[Math.floor(rnd() * types.length)];
        if (r < 0.62) {
          const b = force(f, t, x, y, Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 3), ["plate", "gear", "wire"][Math.floor(rnd() * 3)]);
          if (b.ore !== undefined) b.ore = 1 + Math.floor(rnd() * 3);
        } else f.place(t, x, y, Math.floor(rnd() * 4));
      }
    }
    f.tick();
    if (step % 100 === 0) {
      ok(f, `шаг ${step}`);
      assert.ok(Number.isInteger(f.coins) && f.coins >= 0, "монеты: " + f.coins);
      assert.ok(f.grid.ratio >= 0 && f.grid.ratio <= 1);
      for (const b of f.map.values()) {
        assert.ok(b.lvl >= 1 && b.lvl <= 3, "уровень в границах");
        if (b.type === BT.HOUSE) assert.ok(b.pop >= 0 && b.pop <= HOUSE_CAP_BY[b.lvl], `жителей ${b.pop} при Mk${b.lvl}`);
      }
      for (const t of ITEMS) assert.ok((f.stock[t] || 0) >= 0, "отрицательный склад: " + t);
    }
  }
}

console.log("upgrade.test: проверки пройдены");
