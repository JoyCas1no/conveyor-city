// Рисование построек и выбор клетки с учётом высоты: без браузера, на «пустом» Graphics.
import assert from "node:assert/strict";
import { drawBelt, drawMiner, drawStorage, drawItem, drawGhost } from "../src/buildingdraw.js";
import { pickTile, pickTileRaised, tileToScreen } from "../src/iso.js";
import { BT } from "../src/factory.js";

function fakeG() {
  const calls = { shapes: 0, bad: 0 };
  const chain = { fill() { return chain; }, stroke() { return chain; } };
  const shape = (...args) => {
    calls.shapes++;
    for (const a of args.flat()) if (typeof a === "number" && !Number.isFinite(a)) calls.bad++;
    return chain;
  };
  return { calls, poly: shape, ellipse: shape, circle: shape, rect: shape };
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
