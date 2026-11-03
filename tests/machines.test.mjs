// Плавильня, станок, разветвитель, цены и учёт по видам предметов.
import assert from "node:assert/strict";
import { Factory, BT, TICK, RECIPES, RECIPE_ORDER, COSTS, ITEMS, FUEL_CAP } from "../src/factory.js";

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
  f.map.set(x + "," + y, b);
  f._touch(x, y);
  return b;
};
// Питание для станка в (x, y): столб рядом и солнечные панели (по 6 ед.).
const power = (f, x, y, solars = 2) => {
  force(f, BT.POLE, x, y + 2);
  for (let i = 0; i < solars; i++) force(f, BT.SOLAR, x - 1 + i, y + 3);
};
const ok = (f, msg = "") => {
  const a = f.audit();
  assert.ok(a.ok, `учёт предметов ${msg}: ${a.bad.join(", ")}`);
  return a;
};

// ---- плавильня: руда спереди, уголь сбоку, слитки на склад; топливо 1 уголь на 4 слитка ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, { ore: 1 });
  const sm = force(f, BT.SMELTER, 1, 0, 0);
  force(f, BT.MINER, 1, 1, 3, { ore: 3 }); // уголь подаётся в плавильню сбоку
  force(f, BT.BELT, 2, 0, 0);
  force(f, BT.STORAGE, 3, 0);
  run(f, 120);
  ok(f, "плавильня");
  const ingots = f.stock.iron_ingot || 0;
  assert.ok(ingots >= 30 && ingots <= 41, `за 120 с ожидаем 30-41 слиток, а ${ingots}`);
  assert.ok(f.sunk.coal * 4 + 4 >= ingots, "угля потрачено не меньше, чем нужно на слитки (минус 4 слитка стартового топлива)");
  assert.ok(f.sunk.coal * 4 <= ingots + FUEL_CAP + 4, "угля потрачено не больше запаса бака");
  assert.equal(f.stock.coal || 0, 0, "уголь не доезжает до склада: он идёт в бак");
  assert.ok(sm.fuel <= FUEL_CAP);
}

// ---- без топлива плавильня стоит и говорит об этом; с углём заводится ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, { ore: 1 });
  const sm = force(f, BT.SMELTER, 1, 0, 0);
  force(f, BT.BELT, 2, 0, 0);
  force(f, BT.STORAGE, 3, 0);
  run(f, 60);
  assert.equal(sm.in.iron_ore, 2, "руда накопилась во входном запасе");
  assert.equal(f.stock.iron_ingot, 4, "стартового топлива хватило на 4 слитка");
  assert.equal(f.status(sm), "nofuel");
  force(f, BT.MINER, 1, 1, 3, { ore: 3 });
  run(f, 20);
  assert.ok(f.stock.iron_ingot >= 8, "с углём пошли новые слитки");
  ok(f, "топливо");
}

// ---- железо и медь вместе: плавильня чередует ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, 0, 0, 0, { ore: 1 });
  force(f, BT.MINER, 1, 1, 3, { ore: 2 }); // медь сбоку
  force(f, BT.MINER, 1, -1, 1, { ore: 3 }); // уголь с другой стороны
  force(f, BT.SMELTER, 1, 0, 0);
  force(f, BT.BELT, 2, 0, 0);
  force(f, BT.STORAGE, 3, 0);
  run(f, 120);
  assert.ok(f.stock.iron_ingot >= 10 && f.stock.copper_ingot >= 10, `железо ${f.stock.iron_ingot}, медь ${f.stock.copper_ingot}`);
  ok(f, "железо и медь");
}

// ---- лента вперемешку: пропорция 1:1 забивает плавильню углём (ограничение), пропорция 4:1 работает ----
{
  const feed = (pattern) => {
    const f = new Factory(SEED);
    force(f, BT.BELT, 0, 0, 0);
    force(f, BT.BELT, 1, 0, 0);
    const sm = force(f, BT.SMELTER, 2, 0, 0);
    force(f, BT.BELT, 3, 0, 0);
    force(f, BT.STORAGE, 4, 0);
    let k = 0;
    let at200 = 0;
    run(f, 300, (i) => {
      if (i === 4000) at200 = f.stock.iron_ingot || 0;
      const item = pattern[k % pattern.length];
      if (f.push(item, 0, 0, -1, 0)) {
        k++;
        f.created[item] = (f.created[item] || 0) + 1;
      }
    });
    return { f, sm, at200, end: f.stock.iron_ingot || 0 };
  };
  const bad = feed(["iron_ore", "coal"]);
  assert.ok(bad.f.audit().ok, "и в заторе учёт сходится");
  assert.equal(bad.f.status(bad.sm), "clog", "лента 1:1 забивается углём: это видно по статусу");
  assert.equal(bad.end, bad.at200, "ничего не едет, когда забито");
  const good = feed(["iron_ore", "iron_ore", "iron_ore", "iron_ore", "coal"]);
  assert.ok(good.f.audit().ok);
  assert.ok(good.end - good.at200 >= 20, `при 4:1 работа не прекращается: +${good.end - good.at200} слитков за 100 с`);
  assert.notEqual(good.f.status(good.sm), "clog");
}

// ---- решение затора: разветвитель сбрасывает излишек угля на склад ----
{
  const f = new Factory(SEED);
  force(f, BT.MINER, -1, 0, 0, { ore: 1 }); // железо
  force(f, BT.MINER, 0, -1, 1, { ore: 3 }); // уголь: поровну с железом
  force(f, BT.SPLITTER, 0, 0);
  force(f, BT.SMELTER, 1, 0, 0);
  force(f, BT.STORAGE, 0, 1); // излишек уходит сюда
  force(f, BT.BELT, 2, 0, 0);
  force(f, BT.STORAGE, 3, 0);
  run(f, 120);
  assert.ok((f.stock.iron_ingot || 0) >= 8, `слитки идут при равных потоках: ${f.stock.iron_ingot}`);
  assert.ok((f.stock.coal || 0) > 0, "излишек угля попал на склад");
  ok(f, "разветвитель со складом");
}

// ---- разветвитель делит поровну; закрытый выход не мешает ----
{
  const split = new Factory(SEED);
  force(split, BT.MINER, -2, 0, 0, { ore: 1 });
  force(split, BT.BELT, -1, 0, 0);
  force(split, BT.SPLITTER, 0, 0);
  force(split, BT.BELT, 1, 0, 0);
  force(split, BT.STORAGE, 2, 0);
  force(split, BT.BELT, 0, 1, 1);
  force(split, BT.STORAGE, 0, 2);
  const sent = { "1,0": 0, "0,1": 0 };
  const orig = split.push.bind(split);
  split.push = (item, tx, ty, fx, fy) => {
    const r = orig(item, tx, ty, fx, fy);
    if (r && fx === 0 && fy === 0) sent[tx + "," + ty]++; // что разветвитель отдал в каждую сторону
    return r;
  };
  run(split, 100);
  const a = sent["1,0"];
  const b = sent["0,1"];
  assert.ok(Math.abs(a - b) <= 1 && a >= 20, `поровну: ${a} и ${b}`);
  ok(split, "поровну");
  const one = new Factory(SEED);
  force(one, BT.MINER, -2, 0, 0, { ore: 1 });
  force(one, BT.BELT, -1, 0, 0);
  force(one, BT.SPLITTER, 0, 0);
  force(one, BT.BELT, 1, 0, 0);
  force(one, BT.STORAGE, 2, 0);
  run(one, 60);
  assert.ok(one.stock.iron_ore >= 10, "единственный выход получает всё");
  ok(one, "один выход");
}

// ---- станок: рецепты, лишний предмет не берёт, с передней стороны не берёт ----
{
  for (const name of RECIPE_ORDER) {
    const f = new Factory(SEED);
    const r = RECIPES[name];
    force(f, BT.CONSTRUCTOR, 0, 0, 0, { recipe: name });
    force(f, BT.STORAGE, 1, 0);
    power(f, 0, 0);
    const wrong = r.in === "iron_ingot" ? "copper_ingot" : "iron_ingot";
    assert.equal(f.push(wrong, 0, 0, -1, 0), false, `станок ${name} не берёт чужое`);
    assert.equal(f.push(r.in, 0, 0, 1, 0), false, "с передней стороны станок не принимает");
    run(f, 40, () => {
      if (f.get(0, 0).have < 2) {
        f.push(r.in, 0, 0, -1, 0);
        f.created[r.in] = (f.created[r.in] || 0) + 1;
      }
    });
    const made = f.stock[r.out] || 0;
    const expected = Math.floor(40 / (r.ticks * TICK));
    assert.ok(made >= expected - 2 && made <= expected + 1, `${name}: ${made} вместо ~${expected}`);
    ok(f, name);
  }
}

// ---- смена рецепта возвращает накопленное на склад ----
{
  const f = new Factory(SEED);
  const c = force(f, BT.CONSTRUCTOR, 0, 0, 0, { recipe: "plate" });
  for (let i = 0; i < 2; i++) {
    f.push("iron_ingot", 0, 0, -1, 0);
    f.created.iron_ingot = (f.created.iron_ingot || 0) + 1;
  }
  assert.equal(c.have, 2);
  assert.equal(f.setRecipe(0, 0, "wire"), true);
  assert.equal(c.have, 0);
  assert.equal(f.stock.iron_ingot, 2, "слитки вернулись");
  assert.equal(c.recipe, "wire");
  assert.equal(f.setRecipe(0, 0, "wire"), false, "тот же рецепт: ничего не меняется");
  assert.equal(f.setRecipe(0, 0, "взрыв"), false);
  assert.equal(f.setRecipe(5, 5, "gear"), false);
  ok(f, "смена рецепта");
}

// ---- цены: оплата, нехватка, возврат при сносе ----
{
  const f = new Factory(SEED);
  const r = f.canPlace(BT.SMELTER, 2, 2);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cost");
  assert.deepEqual(r.missing, { iron_ore: 10 });
  assert.equal(f.place(BT.SMELTER, 2, 2), null);
  assert.equal(f.count, 0);
  f.stock.iron_ore = 25;
  f.created.iron_ore = 25;
  assert.ok(f.place(BT.SMELTER, 2, 2, 1));
  assert.equal(f.stock.iron_ore, 15, "заплатили 10 руды");
  assert.ok(f.place(BT.SMELTER, 3, 3));
  assert.equal(f.stock.iron_ore, 5);
  assert.equal(f.place(BT.SMELTER, 4, 4), null, "на третью не хватает");
  assert.equal(f.stock.iron_ore, 5, "неудачная покупка ничего не списывает");
  ok(f, "после покупок");
  assert.ok(f.remove(2, 2));
  assert.equal(f.stock.iron_ore, 15, "снос вернул цену");
  ok(f, "после возврата");
  assert.equal(COSTS.belt, undefined, "конвейер бесплатный");
  assert.ok(new Factory(SEED).place(BT.STORAGE, 2, 2));
  assert.ok(new Factory(SEED).place(BT.BELT, 2, 2, 0));
  const g = new Factory(SEED);
  g.place(BT.BELT, 2, 2, 0);
  assert.ok(g.place(BT.BELT, 2, 2, 1), "поворот ленты бесплатный");
}

// ---- снос машины возвращает цену и всё, что внутри ----
{
  const f = new Factory(SEED);
  f.stock.iron_ingot = 10;
  f.created.iron_ingot = 10;
  assert.ok(f.place(BT.CONSTRUCTOR, 2, 2, 0));
  assert.equal(f.stock.iron_ingot, 0);
  f.push("iron_ingot", 2, 2, 1, 2);
  f.created.iron_ingot++;
  f.tick();
  f.remove(2, 2);
  assert.equal(f.stock.iron_ingot, 11, "цена 10 и слиток из запаса вернулись");
  ok(f, "снос станка");
}

// ---- сохранение: слитки, рецепт станка, старые сохранения ----
{
  const f = new Factory(SEED);
  force(f, BT.CONSTRUCTOR, 0, 0, 0, { recipe: "gear" });
  force(f, BT.SMELTER, 1, 0, 2);
  force(f, BT.SPLITTER, 2, 0);
  f.stock = { iron_ingot: 7, gear: 3, copper_wire: 2, coal: 1 };
  const json = JSON.parse(JSON.stringify(f.toJSON()));
  const g = new Factory(SEED);
  assert.equal(g.loadJSON(json), 3);
  assert.equal(g.get(0, 0).recipe, "gear");
  assert.equal(g.get(1, 0).type, BT.SMELTER);
  assert.equal(g.get(1, 0).dir, 2);
  assert.equal(g.get(2, 0).type, BT.SPLITTER);
  assert.deepEqual(g.stock, { iron_ingot: 7, gear: 3, copper_wire: 2, coal: 1 });
  ok(g, "после загрузки");
  const old = new Factory(SEED);
  assert.equal(old.loadJSON({ v: 1, seed: SEED, buildings: [["m", 0, 0, 0], ["b", 1, 0, 0], ["s", 2, 0, 0]], stock: { iron_ore: 12 } }), 3);
  assert.equal(old.stock.iron_ore, 12);
  const bad = new Factory(SEED);
  bad.loadJSON({ v: 1, seed: SEED, buildings: [["c", 0, 0, 0, "взрыв"]], stock: {} });
  assert.equal(bad.get(0, 0).recipe, "plate");
}

// ---- случайная игра со всеми машинами: учёт по видам сходится ----
{
  let s = 777;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const f = new Factory(SEED);
  const types = [BT.BELT, BT.BELT, BT.BELT, BT.MINER, BT.STORAGE, BT.SMELTER, BT.CONSTRUCTOR, BT.SPLITTER];
  for (let step = 0; step < 8000; step++) {
    if (step % 4 === 0) {
      const x = Math.floor(rnd() * 7), y = Math.floor(rnd() * 7), r = rnd();
      if (r < 0.12) f.remove(x, y);
      else if (r < 0.2) f.rotateAt(x, y, Math.floor(rnd() * 4));
      else if (r < 0.27) f.setRecipe(x, y, RECIPE_ORDER[Math.floor(rnd() * 3)]);
      else if (r < 0.3) {
        for (const t of ["iron_ore", "iron_ingot"]) {
          f.stock[t] = (f.stock[t] || 0) + 10;
          f.created[t] = (f.created[t] || 0) + 10;
        }
      } else if (r < 0.65) {
        const t = types[Math.floor(rnd() * types.length)];
        if (t === BT.MINER) force(f, t, x, y, Math.floor(rnd() * 4), { ore: 1 + Math.floor(rnd() * 3) });
        else force(f, t, x, y, Math.floor(rnd() * 4), { recipe: RECIPE_ORDER[Math.floor(rnd() * 3)] });
      } else f.place(types[Math.floor(rnd() * types.length)], x, y, Math.floor(rnd() * 4));
    }
    f.tick();
    if (step % 100 === 0) {
      ok(f, `шаг ${step}`);
      for (const b of f.map.values()) {
        if (b.type === BT.SMELTER) assert.ok(b.fuel >= 0 && b.fuel <= FUEL_CAP && b.in.iron_ore <= 2 && b.in.copper_ore <= 2);
        if (b.type === BT.CONSTRUCTOR) assert.ok(b.have >= 0 && b.have <= 2);
        if (b.type === BT.BELT && b.item) assert.ok(ITEMS.includes(b.item.t) && b.item.p >= 0 && b.item.p <= 1);
      }
      for (const t of ITEMS) assert.ok((f.stock[t] || 0) >= 0, "отрицательный склад: " + t);
    }
  }
}

console.log("machines.test: проверки пройдены");
