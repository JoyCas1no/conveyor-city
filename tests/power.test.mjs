// Энергосеть: столбы, электростанция, солнечная панель, нехватка и отключение света, расход угля, цены, учёт предметов.
import assert from "node:assert/strict";
import { Factory, BT, TICK, POWER, POLE_RADIUS, COSTS, ITEMS, RECIPE_ORDER, FUEL_CAP, BURN_TICKS, powerLinks } from "../src/factory.js";

const SEED = 1337;
const run = (f, seconds, each) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    if (each) each(i);
    f.tick();
  }
};
// Ставит здание в обход цен и рельефа; затёртое здание возвращает содержимое на склад.
const force = (f, type, x, y, dir = 0, opt = {}) => {
  const old = f.get(x, y);
  if (old) f._giveBack(old);
  const b = f._make(type, x, y, dir, opt.recipe);
  if (type === BT.MINER) b.ore = opt.ore ?? 1;
  if (type === BT.POWERPLANT) {
    b.coal = opt.coal ?? 0;
    if (b.coal) f.created.coal = (f.created.coal || 0) + b.coal; // уголь «из воздуха» тоже записываем в учёт
  }
  f.map.set(x + "," + y, b);
  f._touch(x, y);
  return b;
};
const ok = (f, msg = "") => {
  const a = f.audit();
  assert.ok(a.ok, `учёт предметов ${msg}: ${a.bad.join(", ")}`);
  return a;
};
const give = (f, item, n) => {
  f.stock[item] = (f.stock[item] || 0) + n;
  f.created[item] = (f.created[item] || 0) + n;
};
// Подаёт слитки в станок как лента: пока во входе есть место.
const feedIngots = (f, x, y, item = "iron_ingot") => () => {
  const m = f.get(x, y);
  if (m.have < 2 && f.push(item, x, y, x - 1, y)) f.created[item] = (f.created[item] || 0) + 1;
};

// ---- радиус столба: по расстоянию между клетками, граница по тем же функциям, что и в игре ----
{
  const f = new Factory(SEED);
  force(f, BT.POLE, 0, 0);
  const at = {};
  for (const [x, y] of [[4, 0], [0, 4], [-4, 0], [3, 2], [3, 3], [4, 1], [5, 0], [2, 4]]) at[x + "," + y] = force(f, BT.CONSTRUCTOR, x, y);
  f.tick();
  assert.equal(at["4,0"].pw, true, "(4,0) подключено: расстояние 4");
  assert.equal(at["0,4"].pw, true);
  assert.equal(at["-4,0"].pw, true);
  assert.equal(at["3,2"].pw, true, "расстояние 3,6");
  assert.equal(at["3,3"].pw, false, "(3,3) не подключено: расстояние 4,24");
  assert.equal(at["4,1"].pw, false, "(4,1): 4,12");
  assert.equal(at["5,0"].pw, false);
  assert.equal(at["2,4"].pw, false, "(2,4): 4,47");
  assert.equal(POLE_RADIUS, 4);
  f.remove(0, 0); // столб убрали: всё отключилось
  f.tick();
  assert.ok(Object.values(at).every((b) => b.pw === false));
}

// ---- станок без питания никогда ничего не делает ----
{
  const f = new Factory(SEED);
  const c = force(f, BT.CONSTRUCTOR, 0, 0, 0, { recipe: "plate" });
  force(f, BT.STORAGE, 1, 0);
  run(f, 30, () => {
    if (c.have < 2 && f.push("iron_ingot", 0, 0, -1, 0)) f.created.iron_ingot = (f.created.iron_ingot || 0) + 1;
  });
  assert.equal(c.have, 2, "слитки лежат во входе");
  assert.equal(f.stock.iron_plate || 0, 0, "ничего не произведено");
  assert.equal(f.status(c), "unplugged", "статус «не подключено к столбу»");
  ok(f, "станок без питания");
  // столб рядом, но выработки нет: стоит и говорит «нет энергии»
  force(f, BT.POLE, 0, 2);
  run(f, 5);
  assert.equal(c.pw, true);
  assert.equal(f.status(c), "nopower");
  assert.equal(f.grid.ratio, 0);
}

// ---- электростанция, столб и станок: работает на полной скорости; цифры сети ----
{
  const f = new Factory(SEED);
  const plant = force(f, BT.POWERPLANT, 0, 0, 0, { coal: 4 });
  force(f, BT.POLE, 2, 1);
  force(f, BT.CONSTRUCTOR, 3, 0, 0, { recipe: "plate" });
  force(f, BT.STORAGE, 4, 0);
  run(f, 40, feedIngots(f, 3, 0));
  assert.equal(f.grid.supply, POWER.plant);
  assert.equal(f.grid.demand, POWER.constructor);
  assert.equal(f.grid.ratio, 1);
  const plates = f.stock.iron_plate || 0;
  assert.ok(plates >= 18 && plates <= 21, `полная скорость: ${plates} пластин за 40 с`);
  assert.ok(plant.coal + (plant.burning ? 1 : 0) >= 3, "уголь тратится по спросу, а не на полную мощность");
  ok(f, "станция");
}

// ---- расход угля пропорционален нагрузке; без спроса не горит ----
{
  const f = new Factory(SEED);
  const plant = force(f, BT.POWERPLANT, 0, 0, 0, { coal: 4 });
  force(f, BT.POLE, 1, 1);
  force(f, BT.CONSTRUCTOR, 2, 0, 0, { recipe: "gear" });
  force(f, BT.STORAGE, 3, 0);
  run(f, 120); // станок без слитков: спроса нет
  assert.equal(plant.coal, 4);
  assert.equal(plant.burning, false);
  assert.equal(f.sunk.coal || 0, 0, "без спроса уголь не горит");
  assert.equal(f.status(plant), "idle");
  run(f, 130, feedIngots(f, 2, 0)); // 130 с работы станка: нагрузка 5 из 30
  const usedCoal = (f.sunk.coal || 0) + (plant.burning ? 1 - plant.burn / BURN_TICKS : 0);
  assert.ok(usedCoal >= 1.8 && usedCoal <= 2.6, `130 с по 5 из 30 = примерно 2,2 угля, а сгорело ${usedCoal.toFixed(2)}`);
  ok(f, "расход угля");
}

// ---- солнечная панель покрывает спрос: станция не жжёт ----
{
  const f = new Factory(SEED);
  const plant = force(f, BT.POWERPLANT, 0, 0, 0, { coal: 4 });
  force(f, BT.POLE, 1, 1);
  force(f, BT.SOLAR, 2, 2);
  force(f, BT.CONSTRUCTOR, 3, 0, 0, { recipe: "plate" });
  force(f, BT.STORAGE, 4, 0);
  run(f, 60, feedIngots(f, 3, 0));
  assert.equal(f.sunk.coal || 0, 0, "солнца (6) хватает на станок (5): станция не горит");
  assert.equal(plant.burning, false);
  assert.ok(f.stock.iron_plate >= 25);
  ok(f, "солнце");
}

// ---- нехватка: два станка (10) на одну панель (6): скорость 60% ----
{
  const f = new Factory(SEED);
  force(f, BT.POLE, 0, 2);
  force(f, BT.SOLAR, 0, 3);
  for (const y of [0, 4]) {
    force(f, BT.CONSTRUCTOR, 0, y, 0, { recipe: "plate" });
    force(f, BT.STORAGE, 1, y);
  }
  run(f, 40, () => {
    for (const y of [0, 4]) if (f.get(0, y).have < 2 && f.push("iron_ingot", 0, y, -1, y)) f.created.iron_ingot = (f.created.iron_ingot || 0) + 1;
  });
  assert.equal(f.grid.demand, 10);
  assert.equal(f.grid.supply, 6);
  assert.ok(Math.abs(f.grid.ratio - 0.6) < 1e-9);
  const total = f.stock.iron_plate || 0;
  assert.ok(total >= 20 && total <= 28, `при 60% всего ~24 пластины за 40 с, а ${total}`);
  ok(f, "нехватка");
}

// ---- отключение света: плавильня питалась от сети, потом вернулась на уголь ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, { ore: 1 });
  const sm = force(f, BT.SMELTER, 1, 0, 0);
  force(f, BT.BELT, 2, 0, 0);
  force(f, BT.STORAGE, 3, 0);
  force(f, BT.POLE, 1, 2);
  const solar = force(f, BT.SOLAR, 2, 2);
  run(f, 60);
  const withPower = f.stock.iron_ingot || 0;
  assert.ok(withPower >= 15, `на энергии слитки идут без угля: ${withPower}`);
  assert.equal(sm.fuel, 4, "уголь не тронут: плавильня питалась от сети");
  f.remove(solar.x, solar.y); // свет отключили
  run(f, 60);
  assert.ok(f.stock.iron_ingot > withPower, "на угле слитки продолжились");
  assert.ok(sm.fuel < 4 || sm.busy, "стартовое топливо пошло в дело");
  ok(f, "возврат на уголь");
}

// ---- плавильня на энергии, уголь подаётся сбоку: слитки идут, бак в пределах, бур упирается ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, { ore: 1 });
  const sm = force(f, BT.SMELTER, 1, 0, 0);
  const coalMiner = force(f, BT.MINER, 1, 1, 3, { ore: 3 });
  force(f, BT.BELT, 2, 0, 0);
  force(f, BT.STORAGE, 3, 0);
  force(f, BT.POLE, 1, -2);
  force(f, BT.SOLAR, 0, -2);
  run(f, 120);
  assert.ok((f.stock.iron_ingot || 0) >= 30, `слитки идут: ${f.stock.iron_ingot}`);
  assert.ok(sm.fuel <= FUEL_CAP);
  assert.equal(coalMiner.blocked, true, "бак полон: угольный бур просто стоит");
  ok(f, "энергия и уголь сбоку");
}

// ---- станция принимает уголь до 4; столб и панель ничего не берут; снос станции возвращает горящий уголь ----
{
  const f = new Factory(SEED);
  const plant = force(f, BT.POWERPLANT, 0, 0);
  for (let i = 0; i < 4; i++) assert.equal(f.push("coal", 0, 0, 1, 0), true);
  assert.equal(f.push("coal", 0, 0, 1, 0), false, "пятый уголь не берёт");
  assert.equal(f.push("iron_ore", 0, 0, 1, 0), false, "руду не берёт");
  f.created.coal = 4;
  force(f, BT.POLE, 2, 0);
  assert.equal(f.push("coal", 2, 0, 3, 0), false);
  force(f, BT.SOLAR, 9, 9); // далеко от столбов: в сеть не входит и спрос не покрывает
  assert.equal(f.push("coal", 9, 9, 9, 10), false);
  force(f, BT.CONSTRUCTOR, 0, 4, 0, { recipe: "plate" });
  f.get(0, 4).have = 1; // спрос есть
  f.created.iron_ingot = 1;
  force(f, BT.POLE, 1, 2);
  run(f, 0.2); // четыре шага: станок только начал работу
  assert.equal(plant.burning, true, "уголь загорелся");
  assert.equal(f.grid.demand, 5);
  f.remove(0, 0);
  assert.equal(f.stock.coal, 4, "из станции вернулись 3 в запасе и 1 горящий");
  ok(f, "снос станции на ходу");
}

// ---- цены и возврат ----
{
  assert.deepEqual(COSTS.pole, { iron_ingot: 1 });
  assert.deepEqual(COSTS.powerplant, { iron_ingot: 20, copper_ingot: 5 });
  assert.deepEqual(COSTS.solar, { iron_plate: 5, gear: 5, copper_wire: 5 });
  const f = new Factory(SEED);
  assert.equal(f.canPlace(BT.SOLAR, 2, 2).reason, "cost");
  assert.deepEqual(f.canPlace(BT.POWERPLANT, 2, 2).missing, { iron_ingot: 20, copper_ingot: 5 });
  give(f, "iron_ingot", 21);
  give(f, "copper_ingot", 5);
  assert.ok(f.place(BT.POWERPLANT, 2, 2));
  assert.deepEqual([f.stock.iron_ingot, f.stock.copper_ingot], [1, 0]);
  assert.ok(f.place(BT.POLE, 4, 2));
  assert.equal(f.stock.iron_ingot, 0);
  assert.equal(f.place(BT.POLE, 5, 2), null, "слитков больше нет");
  ok(f, "после покупок");
  f.remove(2, 2);
  f.remove(4, 2);
  assert.deepEqual([f.stock.iron_ingot, f.stock.copper_ingot], [21, 5], "снос вернул всё");
  ok(f, "после возврата");
  for (const t of [BT.POLE, BT.POWERPLANT, BT.SOLAR]) {
    const g = new Factory(SEED);
    force(g, t, 0, 0);
    assert.equal(g.rotateAt(0, 0, 2), false, t + " не поворачивается");
  }
}

// ---- линии для картинки ----
{
  const f = new Factory(SEED);
  force(f, BT.POLE, 0, 0);
  force(f, BT.POLE, 8, 0);
  force(f, BT.POLE, 9, 0);
  force(f, BT.CONSTRUCTOR, 3, 0);
  force(f, BT.BELT, 1, 0);
  const links = powerLinks(f);
  assert.equal(links.toBuildings.filter((l) => l[2] === 3 && l[3] === 0).length, 1, "станок подключён к ближнему столбу");
  assert.equal(links.toBuildings.some((l) => l[2] === 1 && l[3] === 0), false, "конвейер к столбам не подключается");
  assert.equal(links.toPoles.length, 2, "(0,0)-(8,0) и (8,0)-(9,0); (0,0)-(9,0) дальше 8");
  assert.equal(links.toPoles.some((l) => l[0] === 0 && l[2] === 9), false);
}

// ---- сохранение и старые сохранения ----
{
  const f = new Factory(SEED);
  force(f, BT.POLE, 0, 0);
  force(f, BT.POWERPLANT, 1, 0);
  force(f, BT.SOLAR, 2, 0);
  force(f, BT.CONSTRUCTOR, 3, 0, 0, { recipe: "wire" });
  f.stock = { gear: 2, iron_plate: 1 };
  const json = JSON.parse(JSON.stringify(f.toJSON()));
  const g = new Factory(SEED);
  assert.equal(g.loadJSON(json), 4);
  assert.deepEqual([g.get(0, 0).type, g.get(1, 0).type, g.get(2, 0).type, g.get(3, 0).recipe], [BT.POLE, BT.POWERPLANT, BT.SOLAR, "wire"]);
  g.tick();
  assert.equal(g.get(3, 0).pw, true);
  ok(g, "после загрузки");
  // станок из сохранения этапа 3 без столба: «не подключено»
  const old = new Factory(SEED);
  old.loadJSON({ v: 1, seed: SEED, buildings: [["c", 5, 5, 0, "gear"]], stock: { iron_ingot: 4 } });
  old.tick();
  assert.equal(old.status(old.get(5, 5)), "unplugged");
}

// ---- с нуля без тупика: каждая покупка по-настоящему, бурить на руде можно бесплатно ----
{
  const f = new Factory(SEED);
  const ore = (x, y, kind) => force(f, BT.MINER, x, y, 0, { ore: kind });
  const side = (x, y, kind) => force(f, BT.MINER, x, y, 3, { ore: kind }); // смотрит на клетку выше: подаёт в машину сбоку
  const must = (type, x, y, d = 0) => {
    const b = f.place(type, x, y, d);
    assert.ok(b, `покупка ${type} в (${x},${y}) не удалась: ${JSON.stringify(f.canPlace(type, x, y))}, склад ${JSON.stringify(f.stock)}`);
    return b;
  };
  // 1) руда на склад бесплатно: бур и склад
  ore(0, 16, 1);
  must(BT.STORAGE, 1, 16);
  run(f, 90);
  assert.ok(f.stock.iron_ore >= 40, `руды на 4 плавильни: ${f.stock.iron_ore}`);
  // 2) четыре плавильни: A и C отдают слитки на склад, B и E будут кормить станки
  const rows = { A: [0, 1], C: [4, 2], B: [8, 1], E: [12, 2] }; // y и вид руды
  for (const [name, [y, kind]] of Object.entries(rows)) {
    ore(0, y, kind);
    must(BT.SMELTER, 1, y);
    side(1, y + 1, 3); // уголь сбоку
    if (name === "A" || name === "C") must(BT.STORAGE, 2, y);
  }
  must(BT.STORAGE, 3, 8);
  must(BT.STORAGE, 3, 12);
  run(f, 160);
  assert.ok(f.stock.iron_ingot >= 41 && f.stock.copper_ingot >= 5, `на станцию, столб и два станка: железа ${f.stock.iron_ingot}, меди ${f.stock.copper_ingot}`);
  // 3) электростанция с угольным буром, столб, два станка прямо на выходе плавилен B и E
  must(BT.POWERPLANT, 5, 10);
  side(5, 11, 3);
  must(BT.POLE, 4, 10);
  const k1 = must(BT.CONSTRUCTOR, 2, 8);
  const k2 = must(BT.CONSTRUCTOR, 2, 12);
  f.setRecipe(2, 12, "wire");
  assert.equal(k1.recipe, "plate");
  assert.equal(k2.recipe, "wire");
  // 4) ждём детали: пластины, потом шестерёнки, провод; смена рецепта у первого станка
  let swapped = false;
  let solar = null;
  for (let sec = 0; sec < 900 && !solar; sec++) {
    run(f, 1);
    if (!swapped && (f.stock.iron_plate || 0) >= 5) {
      f.setRecipe(2, 8, "gear");
      swapped = true;
    }
    if (f.canAfford(BT.SOLAR)) solar = f.place(BT.SOLAR, 4, 11);
  }
  assert.ok(solar, `солнечная панель так и не куплена: склад ${JSON.stringify(f.stock)}, сеть ${JSON.stringify(f.grid)}`);
  ok(f, "цепочка с нуля");
  assert.ok(f.get(2, 8).pw && f.get(2, 12).pw, "станки подключены");
  run(f, 5);
  assert.ok(f.get(4, 11).pw, "панель подключена");
  assert.ok(f.grid.supply >= POWER.solar, "в сети есть выработка");
}

// ---- случайная игра со всей энергетикой: учёт сходится, значения в границах ----
{
  let s = 4242;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const f = new Factory(SEED);
  const types = [BT.BELT, BT.BELT, BT.MINER, BT.STORAGE, BT.SMELTER, BT.CONSTRUCTOR, BT.SPLITTER, BT.POLE, BT.POLE, BT.POWERPLANT, BT.SOLAR];
  for (let step = 0; step < 10000; step++) {
    if (step % 4 === 0) {
      const x = Math.floor(rnd() * 8), y = Math.floor(rnd() * 8), r = rnd();
      if (r < 0.15) f.remove(x, y); // в том числе столбы и станции на ходу
      else if (r < 0.2) f.rotateAt(x, y, Math.floor(rnd() * 4));
      else if (r < 0.25) f.setRecipe(x, y, RECIPE_ORDER[Math.floor(rnd() * 3)]);
      else if (r < 0.3) for (const t of ITEMS) give(f, t, 6);
      else {
        const t = types[Math.floor(rnd() * types.length)];
        if (r < 0.65) force(f, t, x, y, Math.floor(rnd() * 4), { ore: 1 + Math.floor(rnd() * 3), recipe: RECIPE_ORDER[Math.floor(rnd() * 3)], coal: Math.floor(rnd() * 5) });
        else f.place(t, x, y, Math.floor(rnd() * 4));
      }
    }
    f.tick();
    if (step % 100 === 0) {
      ok(f, `шаг ${step}`);
      assert.ok(f.grid.ratio >= 0 && f.grid.ratio <= 1);
      for (const b of f.map.values()) {
        if (b.type === BT.POWERPLANT) assert.ok(b.coal >= 0 && b.coal <= 4 && b.burn <= BURN_TICKS, "станция в границах");
        if (b.type === BT.SMELTER) assert.ok(b.fuel >= 0 && b.fuel <= FUEL_CAP);
      }
      for (const t of ITEMS) assert.ok((f.stock[t] || 0) >= 0, "отрицательный склад: " + t);
    }
  }
}

console.log("power.test: проверки пройдены");
