// Рисование зданий, лент и предметов. Все функции принимают «g» с методами Pixi Graphics (poly, ellipse, circle, rect, fill).
import { HW, HH, tileToScreen } from "./iso.js";
import { DIRS, BT, ORE_ITEM } from "./factory.js";
import { PAL, lerpColor, shade } from "./palette.js";

// Цвета руд: название предмета -> номер руды в палитре.
export const ITEM_ORE = { iron_ore: 1, copper_ore: 2, coal: 3 };
// Лампочка состояния: зелёная работает, красная стоит (выход занят или забито), жёлтая ждёт сырьё или топливо.
export const LAMP = { work: 0x6fdc6f, blocked: 0xe0524a, clog: 0xe0524a, idle: 0x8a8f96, noore: 0xf2c74a, nofuel: 0xf2c74a, noinput: 0xf2c74a };
// Цвета готовых предметов для панели и рецептов: [верх, бок].
export const ITEM_COLORS = {
  iron_ingot: [0xc3cedc, 0x8392a3],
  copper_ingot: [0xf0a05a, 0xc0702a],
  iron_plate: [0xdfe5ec, 0x9aa6b4],
  gear: [0x8c98a6, 0x5d6a78],
  copper_wire: [0xe08a3c, 0x7a3d12],
};

const S = (tx, ty) => tileToScreen(tx, ty);

function polyTiles(g, pts, color, alpha = 1, lift = 0) {
  const flat = [];
  for (const [tx, ty] of pts) {
    const s = S(tx, ty);
    flat.push(s.x, s.y - lift);
  }
  g.poly(flat).fill({ color, alpha });
}

// Полоса вдоль оси клетки от точки a к точке b (в координатах клеток), полуширина w.
function band(g, ax, ay, bx, by, w, color) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * w;
  const py = (dx / len) * w;
  polyTiles(g, [[ax + px, ay + py], [bx + px, by + py], [bx - px, by - py], [ax - px, ay - py]], color);
}

// Конвейер: полоса от каждой стороны входа к центру и к стороне выхода, жёлтый шеврон по ходу движения.
export function drawBelt(g, b, inputs) {
  const cx = b.x + 0.5;
  const cy = b.y + 0.5;
  const ins = inputs && inputs.length ? inputs : [(b.dir + 2) % 4];
  const [ex, ey] = DIRS[b.dir];
  for (const [w, color] of [[0.36, 0x7c8793], [0.28, 0x3f4852]]) {
    for (const d of ins) band(g, cx + DIRS[d][0] * 0.5, cy + DIRS[d][1] * 0.5, cx, cy, w, color);
    band(g, cx, cy, cx + ex * 0.5, cy + ey * 0.5, w, color);
    polyTiles(g, [[cx - w, cy - w], [cx + w, cy - w], [cx + w, cy + w], [cx - w, cy + w]], color);
  }
  const px = -ey;
  const py = ex;
  polyTiles(g, [[cx + ex * 0.24, cy + ey * 0.24], [cx - ex * 0.1 + px * 0.17, cy - ey * 0.1 + py * 0.17], [cx - ex * 0.1 - px * 0.17, cy - ey * 0.1 - py * 0.17]], 0xe8c24a, 0.9);
}

// Куб с основанием-ромбом (центр cx, cy; полуразмеры hw, hh) высотой h.
function cube(g, cx, cy, hw, hh, h, top, left, right) {
  g.poly([cx - hw, cy, cx, cy + hh, cx, cy + hh - h, cx - hw, cy - h]).fill(left);
  g.poly([cx, cy + hh, cx + hw, cy, cx + hw, cy - h, cx, cy + hh - h]).fill(right);
  g.poly([cx, cy - h - hh, cx + hw, cy - h, cx, cy - h + hh, cx - hw, cy - h]).fill(top);
}

function centerOf(b) {
  const s = S(b.x + 0.5, b.y + 0.5);
  return { x: s.x, y: s.y };
}

function shadow(g, cx, cy, k = 0.85) {
  g.ellipse(cx, cy + 2, HW * k, HH * k).fill({ color: 0x000000, alpha: 0.2 });
}

// Носик, из которого машина выдаёт предметы вперёд. Сзади рисуется до корпуса, спереди после.
function nozzle(g, b) {
  const [dx, dy] = DIRS[b.dir];
  const n = S(b.x + 0.5 + dx * 0.44, b.y + 0.5 + dy * 0.44);
  cube(g, n.x, n.y, HW * 0.22, HH * 0.22, 7, 0xe3963a, 0xb36f22, 0x9a5c1a);
}
const nozzleBehind = (b) => DIRS[b.dir][0] < 0 || DIRS[b.dir][1] < 0;

function lamp(g, cx, cy, h, st) {
  g.circle(cx - HW * 0.5, cy - h + HH * 0.2, 2.6).fill(LAMP[st] || LAMP.idle);
}

function defaultState(b) {
  return !b.ore ? "idle" : b.blocked ? "blocked" : "work";
}

// Бур (на нём цветной бункер по виду руды, носик по ходу выдачи, лампочка статуса).
export function drawMiner(g, b, st = defaultState(b)) {
  const { x: cx, y: cy } = centerOf(b);
  const ore = PAL.ore[b.ore] || { base: 0x8a8f96, light: 0xc3c7cc };
  shadow(g, cx, cy);
  if (nozzleBehind(b)) nozzle(g, b);
  cube(g, cx, cy, HW * 0.78, HH * 0.78, 14, 0x8796a6, 0x5d6a78, 0x4a5561);
  cube(g, cx, cy - 14, HW * 0.38, HH * 0.38, 12, ore.light, ore.base, shade(ore.base, 0.78));
  g.rect(cx - 2, cy - 14 - 12 - HH * 0.38 - 12, 4, 14).fill(0x2c333b); // бур-штанга
  g.poly([cx - 5, cy - 14 - 12 - HH * 0.38 - 12, cx + 5, cy - 14 - 12 - HH * 0.38 - 12, cx, cy - 14 - 12 - HH * 0.38 - 20]).fill(0xc2c8d0);
  if (!nozzleBehind(b)) nozzle(g, b);
  lamp(g, cx, cy, 14, st);
}

// Плавильня: кирпичная печь с трубой, устье светится, когда работает; дым над трубой.
export function drawSmelter(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.8;
  const hh = HH * 0.8;
  const h = 17;
  shadow(g, cx, cy);
  if (nozzleBehind(b)) nozzle(g, b);
  cube(g, cx, cy, hw, hh, h, 0xb86650, 0x9a4c39, 0x7d3a2c);
  // кирпичные полосы на гранях
  for (const k of [0.33, 0.66]) {
    g.poly([cx - hw, cy - h * k, cx, cy + hh - h * k, cx, cy + hh - h * k + 1.4, cx - hw, cy - h * k + 1.4]).fill({ color: 0x000000, alpha: 0.18 });
    g.poly([cx, cy + hh - h * k, cx + hw, cy - h * k, cx + hw, cy - h * k + 1.4, cx, cy + hh - h * k + 1.4]).fill({ color: 0x000000, alpha: 0.18 });
  }
  // устье на правой грани
  const gy = (t) => cy + hh * (1 - t);
  const x1 = cx + hw * 0.28;
  const x2 = cx + hw * 0.72;
  const mouth = st === "work" ? 0xffa733 : 0x2a1a14;
  g.poly([x1, gy(0.28) - 3, x2, gy(0.72) - 3, x2, gy(0.72) - 11, x1, gy(0.28) - 11]).fill(mouth);
  if (st === "work") g.poly([x1 + 2, gy(0.28) - 5, x2 - 2, gy(0.72) - 5, x2 - 2, gy(0.72) - 8, x1 + 2, gy(0.28) - 8]).fill(0xffe08a);
  // труба
  cube(g, cx - hw * 0.3, cy - h - 1, HW * 0.18, HH * 0.18, 12, 0x6b6b72, 0x4b4b52, 0x3a3a40);
  if (st === "work") {
    g.ellipse(cx - hw * 0.3 + 1, cy - h - 20, 5, 3.4).fill({ color: 0xc9ccd2, alpha: 0.5 });
    g.ellipse(cx - hw * 0.3 + 4, cy - h - 27, 4, 2.8).fill({ color: 0xc9ccd2, alpha: 0.3 });
  }
  if (!nozzleBehind(b)) nozzle(g, b);
  lamp(g, cx, cy, h, st);
}

// Станок: стальной корпус, на крыше манипулятор и цветная плитка рецепта.
const RECIPE_TILE = { plate: 0xdfe5ec, gear: 0xe0a43a, wire: 0xe08a3c };
export function drawConstructor(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.78;
  const hh = HH * 0.78;
  const h = 14;
  shadow(g, cx, cy);
  if (nozzleBehind(b)) nozzle(g, b);
  cube(g, cx, cy, hw, hh, h, 0x7f93a8, 0x5a6c7e, 0x465666);
  // плитка рецепта на крыше
  const tile = RECIPE_TILE[b.recipe] || 0xdfe5ec;
  g.poly([cx, cy - h - hh * 0.55, cx + hw * 0.55, cy - h, cx, cy - h + hh * 0.55, cx - hw * 0.55, cy - h]).fill(tile);
  // манипулятор: стойка и поворотная рука
  cube(g, cx - hw * 0.25, cy - h, HW * 0.14, HH * 0.14, 8, 0x3b4651, 0x2c353f, 0x232b33);
  const px = cx - hw * 0.25;
  const py = cy - h - 8 - HH * 0.14;
  const swing = st === "work" ? 0.5 + 0.5 * Math.sin(b.x * 3.1 + b.y * 1.7) : 0.2; // у каждой машины свой наклон
  const tx = px + 12 + swing * 6;
  const ty = py - 9 - swing * 4;
  g.poly([px - 2, py + 2, px + 2, py - 2, tx + 2, ty - 2, tx - 2, ty + 2]).fill(0xc2c8d0);
  g.circle(tx, ty, 3).fill(st === "work" ? 0xffd23f : 0x6b7682);
  if (!nozzleBehind(b)) nozzle(g, b);
  lamp(g, cx, cy, h, st);
}

// Разветвитель: низкая плита с жёлтой «звездой» из четырёх стрелок.
export function drawSplitter(g, b) {
  const { x: cx, y: cy } = centerOf(b);
  const h = 7;
  shadow(g, cx, cy, 0.7);
  cube(g, cx, cy, HW * 0.72, HH * 0.72, h, 0x646e7b, 0x424a55, 0x353c46);
  const c = [b.x + 0.5, b.y + 0.5];
  for (let d = 0; d < 4; d++) {
    const [dx, dy] = DIRS[d];
    polyTiles(g, [[c[0] + dx * 0.38, c[1] + dy * 0.38], [c[0] + dx * 0.12 - dy * 0.14, c[1] + dy * 0.12 + dx * 0.14], [c[0] + dx * 0.12 + dy * 0.14, c[1] + dy * 0.12 - dx * 0.14]], 0xe8c24a, 1, h);
  }
  g.circle(cx, cy - h, 3.2).fill(0xffe08a);
}

// Склад: деревянный ящик с крышкой и жёлто-чёрной полосой.
export function drawStorage(g, b) {
  const { x: cx, y: cy } = centerOf(b);
  shadow(g, cx, cy, 0.88);
  cube(g, cx, cy, HW * 0.82, HH * 0.82, 18, 0xc9a36a, 0xa27a45, 0x865f33);
  const hw = HW * 0.82;
  const hh = HH * 0.82;
  g.poly([cx, cy - 18 - hh * 0.6, cx + hw * 0.62, cy - 18, cx, cy - 18 + hh * 0.6, cx - hw * 0.62, cy - 18]).fill(0xb48f56); // крышка
  g.poly([cx, cy + hh - 6, cx + hw, cy - 6, cx + hw, cy - 12, cx, cy + hh - 12]).fill(0xf2c74a); // полоса на правой грани
  g.poly([cx, cy + hh - 12, cx + hw, cy - 12, cx + hw, cy - 14, cx, cy + hh - 14]).fill(0x2c2c30);
}

// Любое высокое здание по типу. st: состояние (work, blocked, nofuel, ...).
export function drawTall(g, b, st) {
  switch (b.type) {
    case BT.MINER:
      return drawMiner(g, b, st);
    case BT.SMELTER:
      return drawSmelter(g, b, st);
    case BT.CONSTRUCTOR:
      return drawConstructor(g, b, st);
    case BT.SPLITTER:
      return drawSplitter(g, b);
    default:
      return drawStorage(g, b);
  }
}

// Предмет на ленте или на значке: руда камешком, слиток бруском, пластина, шестерёнка, моток провода.
export function drawItem(g, x, y, item) {
  if (ITEM_ORE[item] || !ITEM_COLORS[item]) {
    const c = PAL.ore[ITEM_ORE[item]] || PAL.ore[1];
    g.ellipse(x, y + 1, 5, 2.4).fill({ color: 0x000000, alpha: 0.25 });
    g.ellipse(x, y - 2, 4.6, 3.6).fill(c.base);
    g.ellipse(x - 1.2, y - 3.2, 2.3, 1.6).fill(c.light);
    return;
  }
  const [top, side] = ITEM_COLORS[item];
  g.ellipse(x, y + 1, 6, 2.6).fill({ color: 0x000000, alpha: 0.25 });
  if (item === "iron_ingot" || item === "copper_ingot") {
    g.poly([x - 6, y - 1, x, y + 2, x + 6, y - 1, x + 6, y - 4, x, y - 1, x - 6, y - 4]).fill(side); // боковые грани
    g.poly([x - 6, y - 4, x, y - 7, x + 6, y - 4, x, y - 1]).fill(top);
    g.poly([x - 3.4, y - 4, x, y - 5.6, x + 3.4, y - 4, x, y - 2.6]).fill({ color: 0xffffff, alpha: 0.3 });
  } else if (item === "iron_plate") {
    g.poly([x - 6.5, y - 2, x, y + 1, x + 6.5, y - 2, x, y - 5]).fill(top);
    g.poly([x - 6.5, y - 2, x, y + 1, x, y + 2.6, x - 6.5, y - 0.4]).fill(side);
    g.poly([x, y + 1, x + 6.5, y - 2, x + 6.5, y - 0.4, x, y + 2.6]).fill(shade(side, 0.85));
  } else if (item === "gear") {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.circle(x + Math.cos(a) * 4.8, y - 3 + Math.sin(a) * 3.3, 1.5).fill(side);
    }
    g.ellipse(x, y - 3, 4.4, 3.2).fill(top);
    g.ellipse(x, y - 3, 1.8, 1.2).fill(0x2c333b);
  } else {
    g.ellipse(x, y - 2, 5, 3.6).fill(side);
    g.ellipse(x, y - 3, 5, 3.4).fill(top);
    g.ellipse(x, y - 3, 2.2, 1.5).fill(0x4d2209);
  }
}

// Подсказка постройки: ромб (зелёный или красный) и стрелка направления.
export function drawGhost(g, x, y, ok, dir, withArrow) {
  const p = tileToScreen(x, y);
  const color = ok ? 0x6fdc6f : 0xe0524a;
  g.poly([p.x, p.y, p.x + HW, p.y + HH, p.x, p.y + 2 * HH, p.x - HW, p.y + HH]).fill({ color, alpha: 0.35 }).stroke({ width: 2, color, alpha: 0.9 });
  if (withArrow) {
    const [ex, ey] = DIRS[dir];
    const cx = x + 0.5;
    const cy = y + 0.5;
    polyTiles(g, [[cx + ex * 0.36, cy + ey * 0.36], [cx - ex * 0.12 - ey * 0.22, cy - ey * 0.12 + ex * 0.22], [cx - ex * 0.12 + ey * 0.22, cy - ey * 0.12 - ex * 0.22]], 0xffffff, 0.9);
  }
}

export { BT, ORE_ITEM, lerpColor };
