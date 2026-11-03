// Рисование построек и выбор клетки с учётом высоты: без браузера, на «пустом» Graphics.
import assert from "node:assert/strict";
import { drawBelt, drawMiner, drawStorage, drawItem, drawGhost, drawSmelter, drawConstructor, drawSplitter, drawTall, drawPole, drawPowerPlant, drawSolar, drawLinks, drawRing, drawTileOutline, LAMP } from "../src/buildingdraw.js";
import { ITEMS, RECIPE_ORDER } from "../src/factory.js";
import { pickTile, pickTileRaised, tileToScreen } from "../src/iso.js";
import { BT } from "../src/factory.js";

function fakeG() {
  const calls = { shapes: 0, bad: 0 };
  const chain = { fill() { return chain; }, stroke() { return chain; }, lineTo() { return chain; }, moveTo() { return chain; } };
  const shape = (...args) => {
    calls.shapes++;
    for (const a of args.flat()) if (typeof a === "number" && !Number.isFinite(a)) calls.bad++;
    return chain;
  };
  return { calls, poly: shape, ellipse: shape, circle: shape, rect: shape, moveTo: shape, lineTo: shape, stroke: shape };
}

let total = 0;
for (let dir = 0; dir < 4; dir++) {
  for (const inputs of [[], [(dir + 2) % 4], [(dir + 1) % 4], [(dir + 1) % 4, (dir + 3) % 4, (dir + 2) % 4]]) {
    const g = fakeG();
    drawBelt(g, { type: BT.BELT, x: -3, y: 7, dir }, inputs);
    assert.equal(g.calls.bad, 0, "NaN в ленте");
    assert.ok(g.calls.shapes > 3);
    total += g.calls.shapes;
  }
  for (const ore of [0, 1, 2, 3]) {
    for (const blocked of [false, true]) {
      const g = fakeG();
      drawMiner(g, { type: BT.MINER, x: 5, y: -2, dir, ore, blocked });
      assert.equal(g.calls.bad, 0, "NaN в буре");
      assert.ok(g.calls.shapes > 8);
    }
  }
  const g = fakeG();
  drawGhost(g, 4, 4, true, dir, true);
  assert.equal(g.calls.bad, 0);
}
{
  const g = fakeG();
  drawStorage(g, { type: BT.STORAGE, x: 0, y: 0, dir: 0 });
  assert.equal(g.calls.bad, 0);
  drawItem(g, 10, 20, "coal");
  drawItem(g, 10, 20, "неизвестный");
  assert.equal(g.calls.bad, 0);
}

// новые машины и все предметы: без NaN, во всех состояниях и направлениях
for (const st of Object.keys(LAMP)) {
  for (let dir = 0; dir < 4; dir++) {
    for (const [fn, extra] of [[drawSmelter, {}], [drawConstructor, { recipe: "plate" }], [drawConstructor, { recipe: "gear" }], [drawConstructor, { recipe: "wire" }]]) {
      const g = fakeG();
      fn(g, { x: 2, y: -4, dir, ...extra }, st);
      assert.equal(g.calls.bad, 0, "NaN в машине");
      assert.ok(g.calls.shapes > 10);
    }
  }
}
{
  const g = fakeG();
  drawSplitter(g, { type: BT.SPLITTER, x: 1, y: 1, dir: 0 });
  assert.equal(g.calls.bad, 0);
  for (const type of [BT.MINER, BT.STORAGE, BT.SMELTER, BT.CONSTRUCTOR, BT.SPLITTER]) {
    const h = fakeG();
    drawTall(h, { type, x: 0, y: 0, dir: 1, ore: 1, recipe: "plate" }, "work");
    assert.equal(h.calls.bad, 0, "drawTall " + type);
  }
  for (const item of ITEMS) {
    const h = fakeG();
    drawItem(h, 5, 5, item);
    assert.equal(h.calls.bad, 0, "предмет " + item);
    assert.ok(h.calls.shapes >= 3, "предмет нарисован: " + item);
  }
  assert.equal(RECIPE_ORDER.length, 3);
}

// энергосеть: столб, станция, панель, линии, круг; во всех состояниях
{
  for (const st of Object.keys(LAMP)) {
    for (const [fn, b] of [[drawPowerPlant, { type: BT.POWERPLANT, x: 1, y: -3, dir: 0 }], [drawSolar, { type: BT.SOLAR, x: -2, y: 5, dir: 0 }]]) {
      const g = fakeG();
      fn(g, b, st);
      assert.equal(g.calls.bad, 0, "NaN: " + b.type + " " + st);
      assert.ok(g.calls.shapes >= 6);
    }
  }
  const g = fakeG();
  drawPole(g, { type: BT.POLE, x: 2, y: 2, dir: 0 });
  drawRing(g, 3, 3, 4);
  drawTileOutline(g, 4, 4, 0x6fdc6f);
  drawLinks(g, { toBuildings: [[0, 0, 3, 1], [0, 0, -2, 2]], toPoles: [[0, 0, 5, 5]] });
  drawLinks(g, { toBuildings: [], toPoles: [] });
  assert.equal(g.calls.bad, 0, "NaN в столбе, кругу или линиях");
  for (const type of [BT.POLE, BT.POWERPLANT, BT.SOLAR]) {
    const h = fakeG();
    drawTall(h, { type, x: 0, y: 0, dir: 0 }, "work");
    assert.ok(h.calls.shapes > 3, "drawTall " + type);
    assert.equal(h.calls.bad, 0);
  }
}

// выбор клетки с учётом скал: точка на поднятой вершине выбирает скалу, а не клетку позади
{
  const heights = new Map([["5,5", 24]]);
  const heightAt = (x, y) => heights.get(x + "," + y) || 0;
  const p = tileToScreen(5, 5);
  const topCenter = { x: p.x, y: p.y - 24 + 16 }; // центр поднятого ромба клетки (5,5)
  assert.deepEqual(pickTileRaised(topCenter.x, topCenter.y, heightAt), { x: 5, y: 5 });
  assert.notDeepEqual(pickTile(topCenter.x, topCenter.y), { x: 5, y: 5 }, "без учёта высоты выбралась бы другая клетка");
  const flat = tileToScreen(8, 3);
  assert.deepEqual(pickTileRaised(flat.x, flat.y + 16, heightAt), { x: 8, y: 3 });
}

console.log(`buildingdraw.test: проверки пройдены (${total} фигур в лентах)`);
