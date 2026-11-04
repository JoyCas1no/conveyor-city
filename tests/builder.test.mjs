// Контроллер стройки: инструменты, ленивые штрихи (щипок ничего не строит), повороты ленты, снос.
import assert from "node:assert/strict";
import { Factory, BT } from "../src/factory.js";
import { Builder } from "../src/builder.js";
import { oreSpawnCenter } from "../src/worldgen.js";

const SEED = 1337;
// Вокруг (0, 0) в радиусе ~24 только трава и песок без построек: безопасная площадка для проверок.
const fresh = () => {
  const f = new Factory(SEED);
  return { f, b: new Builder(f) };
};

// рука ничего не строит
{
  const { f, b } = fresh();
  assert.equal(b.begin(0, 0), false);
  assert.equal(b.preview(0, 0), null);
  assert.equal(f.count, 0);
}

// ленивый штрих: начатый и отменённый (второй палец) ничего не ставит
{
  const { f, b } = fresh();
  b.setTool("belt");
  assert.equal(b.begin(2, 2), true);
  assert.equal(f.count, 0, "касание ещё ничего не поставило");
  b.cancel();
  assert.equal(b.end(), 0);
  assert.equal(f.count, 0, "после щипка построек нет");
}

// простой тап ставит одну постройку с текущим поворотом
{
  const { f, b } = fresh();
  b.setTool("belt");
  b.rotate();
  b.rotate();
  b.begin(1, 1);
  assert.equal(b.end(), 1);
  assert.equal(f.get(1, 1).type, BT.BELT);
  assert.equal(f.get(1, 1).dir, 2);
}

// тап и лёгкое дрожание на той же клетке: одна лента
{
  const { f, b } = fresh();
  b.setTool("belt");
  b.begin(0, 0);
  assert.equal(b.move(0, 0), 0);
  assert.equal(b.end(), 1);
  assert.equal(f.count, 1);
}

// штрих лентой с поворотом: (0,0)->(3,0)->(3,2)
{
  const { f, b } = fresh();
  b.setTool("belt");
  b.begin(0, 0);
  b.move(3, 0);
  b.move(3, 2);
  b.end();
  assert.equal(f.count, 6);
  for (const x of [0, 1, 2]) assert.equal(f.get(x, 0).dir, 0, `лента (${x},0) смотрит вдоль x`);
  for (const [x, y] of [[3, 0], [3, 1], [3, 2]]) assert.equal(f.get(x, y).dir, 1, `лента (${x},${y}) смотрит вдоль y`);
}

// лента при протяжке только намечается (план), ставится при отпускании; возврат назад убирает лишнее из плана
{
  const { f, b } = fresh();
  b.setTool("belt");
  b.begin(0, 0);
  b.move(3, 0);
  assert.equal(f.count, 0, "пока палец не отпущен, ничего не поставлено");
  assert.equal(b.plan.length, 4);
  b.move(1, 0);
  assert.equal(b.plan.length, 2, "вернулись назад: лишние клетки ушли из плана");
  assert.equal(b.plan[1].d, 0);
  b.end();
  assert.equal(f.count, 2);
  assert.deepEqual([0, 1].map((x) => f.get(x, 0).dir), [0, 0]);
  assert.equal(b.plan.length, 0);
}

// отмена: возвращает прежнее состояние тронутых клеток и деньги
{
  const { f, b } = fresh();
  const stock0 = JSON.stringify(f.stock);
  b.setTool("belt");
  b.begin(0, 0);
  b.move(3, 0);
  b.end();
  assert.equal(f.count, 4);
  assert.equal(b.canUndo, true);
  b.undo();
  assert.equal(f.count, 0, "протяжка отменена целиком");
  assert.equal(JSON.stringify(f.stock), stock0, "ресурсы вернулись");
  assert.equal(b.canUndo, false);
  // снос тоже отменяется
  b.setTool("belt");
  b.begin(0, 0);
  b.move(2, 0);
  b.end();
  b.setTool("erase");
  b.begin(1, 0);
  b.end();
  assert.equal(f.get(1, 0), null);
  b.undo();
  assert.ok(f.get(1, 0) && f.get(1, 0).dir === 0, "снесённая лента вернулась с тем же направлением");
}

// препятствие на пути: штрих не падает и останавливается перед ним
{
  const { f, b } = fresh();
  f.place(BT.STORAGE, 2, 0);
  b.setTool("belt");
  b.begin(0, 0);
  b.move(4, 0);
  b.end();
  assert.ok(f.get(0, 0) && f.get(1, 0));
  assert.equal(f.get(2, 0).type, BT.STORAGE);
  assert.equal(f.get(3, 0), null);
}

// бур только на руде: на траве штрих ничего не ставит
{
  const { f, b } = fresh();
  b.setTool("miner");
  const p = b.preview(0, 0);
  assert.equal(p.ok, false);
  assert.equal(p.reason, "noore");
  b.begin(0, 0);
  assert.equal(b.end(), 0);
  assert.equal(f.count, 0);
  const c = oreSpawnCenter(1, SEED);
  assert.equal(b.preview(c.x, c.y).ok, true);
  b.begin(c.x, c.y);
  assert.equal(b.end(), 1);
  assert.equal(f.get(c.x, c.y).type, BT.MINER);
}

// склад протягиванием: ставится по клетке
{
  const { f, b } = fresh();
  b.setTool("storage");
  b.begin(0, 0);
  b.move(2, 0);
  b.end();
  assert.equal(f.count, 3);
}

// снос: тап и протягивание
{
  const { f, b } = fresh();
  b.setTool("belt");
  b.begin(0, 0);
  b.move(4, 0);
  b.end();
  assert.equal(f.count, 5);
  b.setTool("erase");
  assert.equal(b.preview(0, 0).ok, true);
  assert.equal(b.preview(0, 5).ok, false);
  b.begin(1, 0);
  b.move(3, 0);
  b.end();
  assert.equal(f.count, 2);
  assert.ok(f.get(0, 0) && f.get(4, 0));
}

// поворот делает полный круг; смена инструмента отменяет начатый штрих
{
  const { f, b } = fresh();
  for (let i = 0; i < 4; i++) b.rotate();
  assert.equal(b.rot, 0);
  b.setTool("belt");
  b.begin(1, 1);
  b.setTool("storage");
  assert.equal(b.end(), 0);
  assert.equal(f.count, 0);
  b.setTool("неизвестный");
  assert.equal(b.tool, "storage");
}

// подключение сбоку: лента рядом с идущей прямо лентой сама поворачивает к ней
{
  const { f, b } = fresh();
  f.place(BT.BELT, 4, 0, 0);
  f.place(BT.BELT, 5, 0, 0);
  b.setTool("belt");
  assert.equal(b.autoBeltDir(5, 1), 3, "снизу от ленты (5,0): смотрит вверх, в неё");
  assert.equal(b.preview(5, 1).dir, 3, "подсказка показывает уже повёрнутую ленту");
  b.begin(5, 1);
  b.end();
  assert.equal(f.get(5, 1).dir, 3, "поставленная лента повернулась к соседней");
  assert.equal(b.autoBeltDir(3, 0), 0, "перед началом ленты: смотрит на неё");
  f.place(BT.BELT, 3, 1, 3);
  assert.equal(b.autoBeltDir(3, 0), null, "а если в клетку упирается питающая лента, поворот остаётся ручным");
  assert.equal(b.autoBeltDir(10, 10), null, "рядом никого: ручной поворот");
}

console.log("builder.test: проверки пройдены");
