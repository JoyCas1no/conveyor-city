// Рисование куска на «пустом» Graphics: без браузера проверяем, что drawChunk не падает и рисует разумно.
import assert from "node:assert/strict";
import { drawChunk } from "../src/chunkdraw.js";

function fakeG() {
  const calls = { shapes: 0, bad: 0 };
  const chain = {
    fill() { return chain; },
    stroke() { return chain; },
    moveTo() { return chain; },
    lineTo() { return chain; },
  };
  const shape = (...args) => {
    calls.shapes++;
    for (const a of args.flat()) if (typeof a === "number" && !Number.isFinite(a)) calls.bad++;
    return chain;
  };
  return Object.assign({ calls }, { poly: shape, ellipse: shape, circle: shape, moveTo: shape, lineTo: shape });
}

let total = 0;
for (const seed of [1, 1337, 777]) {
  for (const [cx, cy] of [[0, 0], [-1, -1], [3, -5], [-7, 2], [40, 40]]) {
    const g = fakeG();
    drawChunk(g, cx, cy, seed);
    assert.equal(g.calls.bad, 0, `NaN в координатах куска ${cx},${cy}`);
    assert.ok(g.calls.shapes >= 256, "в куске меньше фигур, чем клеток");
    assert.ok(g.calls.shapes < 8000, `слишком много фигур: ${g.calls.shapes}`);
    total += g.calls.shapes;
  }
}
console.log(`draw.test: проверки пройдены (${total} фигур в 15 кусках)`);
