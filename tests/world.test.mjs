// Проверки чистой логики: изометрия, камера, шум и генерация мира.
import assert from "node:assert/strict";
import { tileToScreen, screenToTile, pickTile } from "../src/iso.js";
import { createCamera, panBy, zoomAt, screenToWorld, worldToScreen, ZOOM_MIN, ZOOM_MAX } from "../src/camera.js";
import { CHUNK, T, ORE, tileAt, chunkTiles, oreSpawnCenter } from "../src/worldgen.js";
import { fbm } from "../src/noise.js";

// Изометрия: клетка -> экран -> клетка
for (let x = -50; x <= 50; x += 7) {
  for (let y = -50; y <= 50; y += 5) {
    const p = tileToScreen(x, y);
    const t = pickTile(p.x, p.y + 16); // центр ромба клетки
    assert.deepEqual(t, { x, y }, `iso round-trip ${x},${y}`);
    const f = screenToTile(p.x, p.y);
    assert.ok(Math.abs(f.x - x) < 1e-9 && Math.abs(f.y - y) < 1e-9);
  }
}

// Камера: масштаб вокруг точки не двигает точку под курсором; границы масштаба
const cam = createCamera(100, 50, 1);
const before = screenToWorld(cam, 300, 200, 800, 600);
zoomAt(cam, 1.7, 300, 200, 800, 600);
const after = screenToWorld(cam, 300, 200, 800, 600);
assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9, "zoomAt keeps cursor point");
zoomAt(cam, 1000, 0, 0, 800, 600);
assert.equal(cam.zoom, ZOOM_MAX);
zoomAt(cam, 1e-6, 0, 0, 800, 600);
assert.equal(cam.zoom, ZOOM_MIN);
const c2 = createCamera(0, 0, 2);
panBy(c2, 20, -10);
assert.equal(c2.x, -10);
assert.equal(c2.y, 5);
const ws = worldToScreen(c2, c2.x, c2.y, 800, 600);
assert.deepEqual(ws, { x: 400, y: 300 });

// Детерминизм: один seed даёт ту же карту, другой даёт другую
const a = chunkTiles(3, -2, 1337);
const b = chunkTiles(3, -2, 1337);
assert.deepEqual(a.types, b.types);
assert.deepEqual(a.ores, b.ores);
let differ = 0;
const c = chunkTiles(3, -2, 4242);
for (let i = 0; i < a.types.length; i++) if (a.types[i] !== c.types[i]) differ++;
assert.ok(differ > 10, "другой seed должен менять карту");

// Кусок = tileAt по абсолютным координатам (швов нет по построению)
{
  const ch = chunkTiles(-1, 4, 99);
  for (let j = 0; j < CHUNK; j++)
    for (let i = 0; i < CHUNK; i++) {
      const t = tileAt(-1 * CHUNK + i, 4 * CHUNK + j, 99);
      assert.equal(ch.types[j * CHUNK + i], t.type);
      assert.equal(ch.heights[j * CHUNK + i], t.h);
    }
}

// Гладкость рельефа через границу куска не хуже, чем внутри куска
{
  const seed = 1337;
  let inside = 0, across = 0;
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 63; x++) {
      const d = Math.abs(fbm((x + 1) / 40, y / 40, seed, 4) - fbm(x / 40, y / 40, seed, 4));
      if ((x + 1) % CHUNK === 0) across = Math.max(across, d);
      else inside = Math.max(inside, d);
    }
  assert.ok(across <= inside * 1.5 + 1e-9, `шов на границе куска: ${across} vs ${inside}`);
}

// Состав карты и старт: суша вокруг (0,0), все три руды рядом с центром, разумные доли
for (const seed of [1, 1337, 42, 99999, 123456]) {
  const counts = [0, 0, 0, 0, 0];
  const ores = [0, 0, 0, 0];
  let land = 0;
  for (let y = -150; y < 150; y++)
    for (let x = -150; x < 150; x++) {
      const t = tileAt(x, y, seed);
      counts[t.type]++;
      if (t.type !== T.WATER) land++;
      if (t.ore) ores[t.ore]++;
    }
  const total = 300 * 300;
  const water = counts[T.WATER] / total, hill = counts[T.HILL] / total, forest = counts[T.FOREST] / total;
  assert.ok(water > 0.03 && water < 0.45, `seed ${seed}: воды ${water.toFixed(2)}`);
  assert.ok(hill > 0.01 && hill < 0.3, `seed ${seed}: скал ${hill.toFixed(2)}`);
  assert.ok(forest > 0.02 && forest < 0.4, `seed ${seed}: леса ${forest.toFixed(2)}`);
  for (const k of [ORE.IRON, ORE.COPPER, ORE.COAL]) {
    const share = ores[k] / land;
    assert.ok(share > 0.004 && share < 0.03, `seed ${seed}: руда ${k} доля ${share.toFixed(4)}`);
  }
  // старт: в радиусе 24 нет воды и скал; пятна руды рядом
  const near = [0, 0, 0, 0];
  for (let y = -30; y <= 30; y++)
    for (let x = -30; x <= 30; x++) {
      const t = tileAt(x, y, seed);
      if (Math.hypot(x, y) <= 24) assert.ok(t.type !== T.WATER && t.type !== T.HILL, `seed ${seed}: вода/скала у старта ${x},${y}`);
      if (t.ore) near[t.ore]++;
    }
  for (const k of [ORE.IRON, ORE.COPPER, ORE.COAL]) {
    assert.ok(near[k] >= 8, `seed ${seed}: у старта мало руды ${k}: ${near[k]}`);
    const cc = oreSpawnCenter(k, seed);
    assert.ok(Math.hypot(cc.x, cc.y) < 24);
  }
  console.log(`seed ${seed}: вода ${(water * 100).toFixed(0)}% скалы ${(hill * 100).toFixed(0)}% лес ${(forest * 100).toFixed(0)}% руда ${ores.slice(1).join("/")}`);
}

console.log("world.test: проверки пройдены");
