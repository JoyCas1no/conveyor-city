// Рисование зданий, лент и предметов. Все функции принимают «g» с методами Pixi Graphics (poly, ellipse, circle, rect, fill).
import { HW, HH, tileToScreen } from "./iso.js";
import { DIRS, BT, ORE_ITEM } from "./factory.js";
import { PAL, lerpColor, shade } from "./palette.js";

// Цвета руд: название предмета -> номер руды в палитре.
export const ITEM_ORE = { iron_ore: 1, copper_ore: 2, coal: 3 };
// Лампочка состояния: зелёная работает, красная стоит (выход занят или забито), жёлтая ждёт сырьё или топливо.
export const LAMP = {
  work: 0x6fdc6f,
  power: 0x6fdc6f,
  blocked: 0xe0524a,
  clog: 0xe0524a,
  nopower: 0xe0524a,
  idle: 0x8a8f96,
  noore: 0xf2c74a,
  nofuel: 0xf2c74a,
  noinput: 0xf2c74a,
  unplugged: 0xf2c74a,
  happy: 0x6fdc6f,
  needwater: 0xf2c74a,
  needplank: 0xf2c74a,
  needboth: 0xe0524a,
};
// Цвета готовых предметов для панели и рецептов: [верх, бок].
export const ITEM_COLORS = {
  iron_ingot: [0xc3cedc, 0x8392a3],
  copper_ingot: [0xf0a05a, 0xc0702a],
  iron_plate: [0xdfe5ec, 0x9aa6b4],
  gear: [0x8c98a6, 0x5d6a78],
  copper_wire: [0xe08a3c, 0x7a3d12],
  plank: [0xdfb374, 0x9a6f3a],
  water: [0x62b8ee, 0x2d78b8],
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

// Столб: деревянная опора с перекладиной и изоляторами.
export function drawPole(g, b) {
  const { x: cx, y: cy } = centerOf(b);
  shadow(g, cx, cy, 0.3);
  g.rect(cx - 2, cy - 34, 4, 36).fill(0x8a6a46);
  g.rect(cx - 2, cy - 34, 1.5, 36).fill({ color: 0xffffff, alpha: 0.18 });
  g.rect(cx - 10, cy - 31, 20, 3).fill(0x6b4f33);
  g.circle(cx - 8.5, cy - 33, 2.2).fill(0x9fd0e8);
  g.circle(cx + 8.5, cy - 33, 2.2).fill(0x9fd0e8);
  g.circle(cx, cy - 35, 2).fill(0xe0524a);
}

// Электростанция: бетонный корпус, полосатая труба, молния на стене, окно светится при работе.
export function drawPowerPlant(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.82;
  const hh = HH * 0.82;
  const h = 16;
  shadow(g, cx, cy);
  cube(g, cx, cy, hw, hh, h, 0xa9aeb5, 0x7a8089, 0x646a72);
  // молния на левой грани
  const bx = cx - hw * 0.5;
  const by = cy + hh * 0.5 - h * 0.5;
  g.poly([bx + 3, by - 7, bx - 3, by + 1, bx, by + 1, bx - 3, by + 8, bx + 4, by - 1, bx + 1, by - 1]).fill(0xffd23f);
  // окно на правой грани
  const gy = (t) => cy + hh * (1 - t);
  const x1 = cx + hw * 0.3;
  const x2 = cx + hw * 0.7;
  const win = st === "work" ? 0xffcf5a : 0x2a2f36;
  g.poly([x1, gy(0.3) - 4, x2, gy(0.7) - 4, x2, gy(0.7) - 11, x1, gy(0.3) - 11]).fill(win);
  // труба в два цвета
  cube(g, cx - hw * 0.3, cy - h - 1, HW * 0.2, HH * 0.2, 12, 0xeeeeef, 0xc6c6cc, 0xaaaab0);
  cube(g, cx - hw * 0.3, cy - h - 13, HW * 0.2, HH * 0.2, 10, 0xd8584a, 0xb04236, 0x923529);
  if ((b.lvl || 1) >= 2) {
    cube(g, cx - hw * 0.3 + 12, cy - h + 2, HW * 0.16, HH * 0.16, 9, 0xeeeeef, 0xc6c6cc, 0xaaaab0); // вторая труба
    cube(g, cx - hw * 0.3 + 12, cy - h - 7, HW * 0.16, HH * 0.16, 7, 0xd8584a, 0xb04236, 0x923529);
  }
  if (st === "work") {
    g.ellipse(cx - hw * 0.3 + 1, cy - h - 31, 5.5, 3.6).fill({ color: 0xd9dbe0, alpha: 0.5 });
    g.ellipse(cx - hw * 0.3 + 4, cy - h - 39, 4.5, 3).fill({ color: 0xd9dbe0, alpha: 0.3 });
  }
  lamp(g, cx, cy, h, st);
}

// Солнечная панель: низкая рама и синий щит с сеткой.
export function drawSolar(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.9;
  const hh = HH * 0.9;
  shadow(g, cx, cy, 0.92);
  cube(g, cx, cy, hw, hh, 4, 0xb6bcc4, 0x7d848c, 0x666c74);
  const c = [b.x + 0.5, b.y + 0.5];
  polyTiles(g, [[c[0] - 0.4, c[1] - 0.4], [c[0] + 0.4, c[1] - 0.4], [c[0] + 0.4, c[1] + 0.4], [c[0] - 0.4, c[1] + 0.4]], 0x2f5fa8, 1, 4);
  polyTiles(g, [[c[0] - 0.4, c[1] - 0.4], [c[0] + 0.4, c[1] - 0.4], [c[0] + 0.4, c[1] - 0.1], [c[0] - 0.4, c[1] - 0.1]], 0x4a86d4, 0.55, 4);
  for (const k of [-0.133, 0.133]) {
    polyTiles(g, [[c[0] + k - 0.012, c[1] - 0.4], [c[0] + k + 0.012, c[1] - 0.4], [c[0] + k + 0.012, c[1] + 0.4], [c[0] + k - 0.012, c[1] + 0.4]], 0xcfe3f7, 0.7, 4);
    polyTiles(g, [[c[0] - 0.4, c[1] + k - 0.012], [c[0] + 0.4, c[1] + k - 0.012], [c[0] + 0.4, c[1] + k + 0.012], [c[0] - 0.4, c[1] + k + 0.012]], 0xcfe3f7, 0.7, 4);
  }
  if (st === "unplugged") g.circle(cx - hw * 0.55, cy - 4 + hh * 0.3, 2.4).fill(LAMP.unplugged);
}

// Линии энергосети: столб -> здание и столб -> столб. Одним росчерком.
export function drawLinks(g, links) {
  const top = (x, y, up) => {
    const s = S(x + 0.5, y + 0.5);
    return [s.x, s.y - up];
  };
  let any = false;
  for (const [px, py, bx, by] of links.toBuildings) {
    const a = top(px, py, 33);
    const c = top(bx, by, 8);
    g.moveTo(a[0], a[1]).lineTo(c[0], c[1]);
    any = true;
  }
  for (const [ax, ay, bx, by] of links.toPoles) {
    const a = top(ax, ay, 32);
    const c = top(bx, by, 32);
    g.moveTo(a[0], a[1]).lineTo(c[0], c[1]);
    any = true;
  }
  if (any) g.stroke({ width: 1.5, color: 0xffe9a0, alpha: 0.6 });
}

// Круг подключения столба и контур клетки (для подсказки «что подключится»).
export function drawRing(g, x, y, r) {
  const c = S(x + 0.5, y + 0.5);
  g.ellipse(c.x, c.y, r * HW * Math.SQRT2, r * HH * Math.SQRT2).fill({ color: 0xffe9a0, alpha: 0.08 }).stroke({ width: 1.5, color: 0xffe9a0, alpha: 0.7 });
}

export function drawTileOutline(g, x, y, color, alpha = 0.95) {
  const p = tileToScreen(x, y);
  g.poly([p.x, p.y, p.x + HW, p.y + HH, p.x, p.y + 2 * HH, p.x - HW, p.y + HH]).fill({ color, alpha: 0.18 }).stroke({ width: 2, color, alpha });
}

// Пузырёк над недовольным домом, магазином или парком: чего не хватает.
function bubble(g, cx, cy, color) {
  g.circle(cx, cy, 7.5).fill({ color: 0xffffff, alpha: 0.95 });
  g.poly([cx - 2.5, cy + 6, cx + 2.5, cy + 6, cx, cy + 10]).fill({ color: 0xffffff, alpha: 0.95 });
  g.circle(cx, cy, 4.4).fill(color);
}

// Лесопилка: бревенчатый сарай с пилой на стене и кучкой брёвен.
export function drawSawmill(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.78;
  const hh = HH * 0.78;
  const h = 13;
  shadow(g, cx, cy);
  if (nozzleBehind(b)) nozzle(g, b);
  cube(g, cx, cy, hw, hh, h, 0xb98a55, 0x8a6338, 0x6f4f2c);
  // крыша-плита и пила на правой стене
  g.poly([cx, cy - h - hh - 3, cx + hw + 2, cy - h - 1, cx, cy - h + hh + 2, cx - hw - 2, cy - h - 1]).fill(0x7a5632);
  const sx = cx + hw * 0.5;
  const sy = cy + hh * 0.5 - h * 0.45;
  g.circle(sx, sy, 6).fill(0xc9ced6);
  g.circle(sx, sy, 2.2).fill(0x4b525b);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + (st === "work" ? 0.4 : 0);
    g.circle(sx + Math.cos(a) * 6.3, sy + Math.sin(a) * 6.3, 1.1).fill(0xe8ebef);
  }
  // брёвна
  for (const [dx, dy] of [[-hw * 0.55, hh * 0.55], [-hw * 0.38, hh * 0.72]]) {
    g.ellipse(cx + dx, cy + dy - 2, 8, 3.6).fill(0x8a5e34);
    g.ellipse(cx + dx + 6, cy + dy - 3, 2.6, 3.4).fill(0xdcb27a);
  }
  if (!nozzleBehind(b)) nozzle(g, b);
  lamp(g, cx, cy, h, st);
}

// Насос: голубой бак на стальной подставке с трубой и каплей на боку.
export function drawPump(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  shadow(g, cx, cy);
  if (nozzleBehind(b)) nozzle(g, b);
  cube(g, cx, cy, HW * 0.72, HH * 0.72, 5, 0x9aa5b1, 0x6d7885, 0x59636f);
  // бак-цилиндр
  const r = HW * 0.44;
  g.ellipse(cx, cy - 5, r, r * 0.5).fill(0x5d99c4);
  g.poly([cx - r, cy - 5, cx - r, cy - 22, cx + r, cy - 22, cx + r, cy - 5]).fill(0x7bbbe6);
  g.poly([cx, cy - 5 + r * 0.5, cx + r, cy - 5, cx + r, cy - 22, cx, cy - 22 + r * 0.5]).fill({ color: 0x1f4f7a, alpha: 0.28 });
  g.ellipse(cx, cy - 22, r, r * 0.5).fill(0xa8d8f5);
  // капля
  g.circle(cx - 3, cy - 12, 3).fill(0xffffff);
  g.poly([cx - 5.6, cy - 13.5, cx - 3, cy - 19, cx - 0.4, cy - 13.5]).fill(0xffffff);
  // труба
  g.rect(cx + r - 1, cy - 20, 5, 3).fill(0x6d7885);
  if (!nozzleBehind(b)) nozzle(g, b);
  lamp(g, cx, cy, 5, st);
}

// Дом: беленые стены, красная пирамидальная крыша, окна светятся у довольных, пузырёк у недовольных.
// Уровень даёт этажи: Mk2 второй, Mk3 третий с золотым балконом и флажком.
export function drawHouse(g, b, st = "happy") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.74;
  const hh = HH * 0.74;
  const fh = 14;
  const floors = Math.min(3, Math.max(1, b.lvl || 1));
  const lit = st === "happy" ? 0xffe28a : 0x59616b;
  shadow(g, cx, cy);
  for (let i = 0; i < floors; i++) {
    const base = cy - fh * i;
    cube(g, cx, base, hw, hh, fh, 0xe9dcc0, 0xdccba4, 0xc2b08a);
    g.poly([cx - hw * 0.72, base + hh * 0.28 - 5, cx - hw * 0.3, base + hh * 0.72 - 5, cx - hw * 0.3, base + hh * 0.72 - 10, cx - hw * 0.72, base + hh * 0.28 - 10]).fill(lit);
    g.poly([cx + hw * 0.3, base + hh * 0.7 - 5, cx + hw * 0.7, base + hh * 0.3 - 5, cx + hw * 0.7, base + hh * 0.3 - 10, cx + hw * 0.3, base + hh * 0.7 - 10]).fill(lit);
    if (i === 0) g.poly([cx + hw * 0.05, base + hh * 0.95 - 1, cx + hw * 0.22, base + hh * 0.83 - 1, cx + hw * 0.22, base + hh * 0.83 - 8, cx + hw * 0.05, base + hh * 0.95 - 8]).fill(0x7a4e2d);
  }
  if (floors === 3) {
    const by = cy - fh * 2; // золотой балкон на правой стене третьего этажа
    g.poly([cx + hw * 0.1, by + hh * 0.92, cx + hw * 0.92, by + hh * 0.1, cx + hw * 0.92, by + hh * 0.1 - 3, cx + hw * 0.1, by + hh * 0.92 - 3]).fill(0xffd23f);
  }
  // крыша: пирамида
  const rx = hw + 3;
  const ry = hh + 2;
  const top = cy - fh * floors;
  const apex = top - 15;
  g.poly([cx - rx, top, cx, top + ry, cx, apex]).fill(0xc4553f);
  g.poly([cx, top + ry, cx + rx, top, cx, apex]).fill(0x9e4331);
  g.poly([cx - rx, top, cx, top - ry, cx, apex]).fill(0xd96a52);
  g.poly([cx, top - ry, cx + rx, top, cx, apex]).fill(0xb24b37);
  // труба с дымом
  g.rect(cx + hw * 0.3, apex - 1, 4, 9).fill(0x6b5646);
  if (b.pop > 0 && st === "happy") {
    g.ellipse(cx + hw * 0.3 + 2, apex - 6, 3.6, 2.4).fill({ color: 0xd9dbe0, alpha: 0.5 });
    g.ellipse(cx + hw * 0.3 + 5, apex - 12, 3, 2).fill({ color: 0xd9dbe0, alpha: 0.3 });
  }
  if (floors === 3) {
    g.rect(cx - 0.7, apex - 12, 1.4, 12).fill(0x6b5646); // флажок на крыше
    g.poly([cx + 0.7, apex - 12, cx + 8, apex - 9.5, cx + 0.7, apex - 7]).fill(0xffd23f);
  }
  if (st === "needwater") bubble(g, cx - hw * 0.6, apex - 10, 0x4aa8e0);
  else if (st === "needplank") bubble(g, cx - hw * 0.6, apex - 10, 0xb98a55);
  else if (st === "needboth") bubble(g, cx - hw * 0.6, apex - 10, 0xe0524a);
}

// Магазин: низкое здание с полосатым навесом и вывеской-шестерёнкой.
export function drawShop(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.8;
  const hh = HH * 0.8;
  const h = 13;
  shadow(g, cx, cy);
  cube(g, cx, cy, hw, hh, h, 0xf1d9a8, 0xd9b97a, 0xb89a5e);
  // навес на правой грани: красно-белые полосы
  const gy = (t) => cy + hh * (1 - t);
  for (let i = 0; i < 4; i++) {
    const t1 = 0.1 + i * 0.2;
    const t2 = t1 + 0.2;
    g.poly([cx + hw * t1, gy(t1) - 5, cx + hw * t2, gy(t2) - 5, cx + hw * t2 + 2, gy(t2) - 1, cx + hw * t1 + 2, gy(t1) - 1]).fill(i % 2 ? 0xffffff : (b.lvl || 1) >= 3 ? 0xe0a43a : 0xd94a3c);
  }
  // витрина
  g.poly([cx + hw * 0.2, gy(0.2) - 6, cx + hw * 0.8, gy(0.8) - 6, cx + hw * 0.8, gy(0.8) - 12, cx + hw * 0.2, gy(0.2) - 12]).fill(st === "work" ? 0xffe28a : 0x59616b);
  // вывеска сверху
  g.rect(cx - 7, cy - h - hh - 8, 14, 8).fill(0x5a3f26);
  g.circle(cx, cy - h - hh - 4, 3).fill(0xe0a43a);
  g.circle(cx, cy - h - hh - 4, 1.2).fill(0x5a3f26);
  if (st !== "work") bubble(g, cx - hw * 0.6, cy - h - hh - 14, 0xe0a43a);
}

// Парк: зелёный сквер с дорожкой, деревьями и скамейкой.
export function drawPark(g, b, st = "work") {
  const { x: cx, y: cy } = centerOf(b);
  const hw = HW * 0.94;
  const hh = HH * 0.94;
  g.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]).fill(st === "work" ? 0x58a845 : 0x7a9a58);
  const c = [b.x + 0.5, b.y + 0.5];
  polyTiles(g, [[c[0] - 0.06, c[1] - 0.44], [c[0] + 0.06, c[1] - 0.44], [c[0] + 0.06, c[1] + 0.44], [c[0] - 0.06, c[1] + 0.44]], 0xe3d3a2, 1);
  polyTiles(g, [[c[0] - 0.44, c[1] - 0.06], [c[0] + 0.44, c[1] - 0.06], [c[0] + 0.44, c[1] + 0.06], [c[0] - 0.44, c[1] + 0.06]], 0xe3d3a2, 1);
  g.ellipse(cx, cy, 6, 3).fill(0x6bb8e6); // фонтанчик
  g.ellipse(cx, cy - 1, 3.5, 1.7).fill(0xcfeaff);
  for (const [dx, dy, sc] of [[-0.26, -0.24, 1], [0.27, 0.22, 0.85]]) {
    const t = S(c[0] + dx, c[1] + dy);
    g.ellipse(t.x, t.y + 1, 8 * sc, 3.5 * sc).fill({ color: 0x000000, alpha: 0.18 });
    g.rect(t.x - 1.6, t.y - 9 * sc, 3.2, 9 * sc).fill(0x6b4a2f);
    g.circle(t.x, t.y - 14 * sc, 8 * sc).fill(0x3d9a4f);
    g.circle(t.x - 2.5, t.y - 16 * sc, 4.5 * sc).fill(0x5cb86a);
  }
  if ((b.lvl || 1) >= 2) {
    for (const [dx, dy] of [[-0.38, 0.3], [0.36, -0.28]]) {
      const lp = S(c[0] + dx, c[1] + dy);
      g.rect(lp.x - 0.8, lp.y - 12, 1.6, 12).fill(0x4b525b);
      if (b.lvl === 3) g.circle(lp.x, lp.y - 13, 6).fill({ color: 0xffe28a, alpha: 0.3 });
      g.circle(lp.x, lp.y - 13, 2.6).fill(b.lvl === 3 ? 0xfff2a8 : 0xe3c36a);
    }
  }
  const bn = S(c[0] + 0.12, c[1] - 0.3);
  g.rect(bn.x - 5, bn.y - 5, 10, 2.5).fill(0x8a5e34);
  g.rect(bn.x - 4.5, bn.y - 2.5, 1.6, 3).fill(0x5a3f26);
  g.rect(bn.x + 3, bn.y - 2.5, 1.6, 3).fill(0x5a3f26);
  if (st !== "work") bubble(g, cx, cy - 22, 0xb98a55);
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

// Отделка уровней: Mk2 медная, Mk3 золотая со свечением.
const MK = { 2: { main: 0xcd7f32, light: 0xf0b070 }, 3: { main: 0xffd23f, light: 0xfff2a8 } };
const UPGRADABLE_DRAW = new Set([BT.MINER, BT.SAWMILL, BT.PUMP, BT.SMELTER, BT.CONSTRUCTOR, BT.POWERPLANT, BT.HOUSE, BT.SHOP, BT.PARK]);
const MACHINE_DRAW = new Set([BT.MINER, BT.SAWMILL, BT.PUMP, BT.SMELTER, BT.CONSTRUCTOR, BT.POWERPLANT]);
// Высота значка над землёй (px) по типу здания.
const BADGE_UP = { miner: 66, sawmill: 36, pump: 36, smelter: 56, constructor: 44, powerplant: 56, house: 0, shop: 44, park: 40 };

// Значок уровня римскими палочками на тёмной табличке: «II» и «III» видны издали.
export function drawBadge(g, cx, y, lvl) {
  const c = MK[lvl];
  const w = lvl * 4 - 2;
  g.poly([cx - w / 2 - 3, y - 6, cx + w / 2 + 3, y - 6, cx + w / 2 + 3, y + 6, cx - w / 2 - 3, y + 6]).fill({ color: 0x1b2a33, alpha: 0.94 });
  g.poly([cx - w / 2 - 3, y + 6, cx + w / 2 + 3, y + 6, cx + w / 2 + 3, y + 4.6, cx - w / 2 - 3, y + 4.6]).fill(c.main);
  for (let i = 0; i < lvl; i++) g.rect(cx - w / 2 + i * 4, y - 4, 2, 7.6).fill(c.light);
}

// Под зданием: кольцо у основания (на Mk3 ещё золотое свечение).
function levelBase(g, b) {
  const { x: cx, y: cy } = centerOf(b);
  const c = MK[b.lvl];
  if (b.lvl === 3) g.ellipse(cx, cy + 2, HW * 1.02, HH * 1.02).fill({ color: 0xffd23f, alpha: 0.2 });
  g.ellipse(cx, cy + 2, HW * 0.94, HH * 0.94).stroke({ width: 2.4, color: c.main, alpha: 0.95 });
}

// Поверх здания: у машин две трубы по углам основания, значок над зданием.
function levelTop(g, b) {
  const { x: cx, y: cy } = centerOf(b);
  const c = MK[b.lvl];
  if (MACHINE_DRAW.has(b.type)) {
    for (const sx of [-1, 1]) {
      const px = cx + sx * HW * 0.84;
      g.rect(px - 1.9, cy - 11, 3.8, 11).fill(c.main);
      g.rect(px - 1.9, cy - 11, 1.4, 11).fill({ color: c.light, alpha: 0.85 });
      if (b.lvl === 3) g.circle(px, cy - 12, 5).fill({ color: 0xffe28a, alpha: 0.35 });
      g.circle(px, cy - 12, 2.2).fill(c.light);
    }
  }
  const up = b.type === BT.HOUSE ? 14 * Math.min(3, b.lvl) + 30 : BADGE_UP[b.type] || 40;
  drawBadge(g, cx, cy - up, b.lvl);
}

// Любое высокое здание по типу. st: состояние (work, blocked, nofuel, ...).
export function drawTall(g, b, st) {
  const marked = (b.lvl || 1) >= 2 && UPGRADABLE_DRAW.has(b.type);
  if (marked) levelBase(g, b);
  drawTallBase(g, b, st);
  if (marked) levelTop(g, b);
}

function drawTallBase(g, b, st) {
  switch (b.type) {
    case BT.MINER:
      return drawMiner(g, b, st);
    case BT.SMELTER:
      return drawSmelter(g, b, st);
    case BT.CONSTRUCTOR:
      return drawConstructor(g, b, st);
    case BT.SPLITTER:
      return drawSplitter(g, b);
    case BT.POLE:
      return drawPole(g, b);
    case BT.POWERPLANT:
      return drawPowerPlant(g, b, st);
    case BT.SOLAR:
      return drawSolar(g, b, st);
    case BT.SAWMILL:
      return drawSawmill(g, b, st);
    case BT.PUMP:
      return drawPump(g, b, st);
    case BT.HOUSE:
      return drawHouse(g, b, st);
    case BT.SHOP:
      return drawShop(g, b, st);
    case BT.PARK:
      return drawPark(g, b, st);
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
  } else if (item === "plank") {
    g.poly([x - 8, y - 2, x + 1, y - 6.5, x + 8, y - 3, x - 1, y + 1.5]).fill(top);
    g.poly([x - 8, y - 2, x - 1, y + 1.5, x - 1, y + 3.5, x - 8, y]).fill(side);
    g.poly([x - 1, y + 1.5, x + 8, y - 3, x + 8, y - 1, x - 1, y + 3.5]).fill(shade(side, 0.85));
    g.poly([x - 5, y - 2.6, x + 3.5, y - 5.4, x + 4, y - 4.8, x - 4.6, y - 2]).fill({ color: 0x7a5530, alpha: 0.5 }); // волокно
  } else if (item === "water") {
    g.circle(x, y - 4, 3.8).fill(side);
    g.poly([x - 3.2, y - 5.4, x, y - 12, x + 3.2, y - 5.4]).fill(side);
    g.circle(x - 0.4, y - 4.4, 2.8).fill(top);
    g.ellipse(x - 1.4, y - 5.2, 1, 1.6).fill({ color: 0xffffff, alpha: 0.65 });
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
