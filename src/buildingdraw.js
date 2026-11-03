// Рисование зданий и лент. Все функции принимают «g» с методами Pixi Graphics (poly, ellipse, circle, fill).
import { HW, HH, tileToScreen } from "./iso.js";
import { DIRS, BT, ORE_ITEM } from "./factory.js";
import { PAL, lerpColor, shade } from "./palette.js";

// Цвета предметов: номер руды из карты -> палитра.
export const ITEM_ORE = { iron_ore: 1, copper_ore: 2, coal: 3 };

const S = (tx, ty) => tileToScreen(tx, ty);

function polyTiles(g, pts, color, alpha = 1) {
  const flat = [];
  for (const [tx, ty] of pts) {
    const s = S(tx, ty);
    flat.push(s.x, s.y);
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

function minerColors(ore) {
  const c = PAL.ore[ore] || { base: 0x8a8f96, light: 0xc3c7cc };
  return c;
}

// Бур (на нём цветной бункер по виду руды, носик по ходу выдачи, лампочка статуса).
export function drawMiner(g, b) {
  const { x: cx, y: cy } = centerOf(b);
  const ore = minerColors(b.ore);
  const [dx, dy] = DIRS[b.dir];
  const nozzle = () => {
    const n = S(b.x + 0.5 + dx * 0.44, b.y + 0.5 + dy * 0.44);
    cube(g, n.x, n.y, HW * 0.22, HH * 0.22, 7, 0xe3963a, 0xb36f22, 0x9a5c1a);
  };
  g.ellipse(cx, cy + 2, HW * 0.85, HH * 0.85).fill({ color: 0x000000, alpha: 0.2 });
  if (dx < 0 || dy < 0) nozzle(); // носик сзади рисуем до корпуса
  cube(g, cx, cy, HW * 0.78, HH * 0.78, 14, 0x8796a6, 0x5d6a78, 0x4a5561);
  cube(g, cx, cy - 14, HW * 0.38, HH * 0.38, 12, ore.light, ore.base, shade(ore.base, 0.78));
  g.rect(cx - 2, cy - 14 - 12 - HH * 0.38 - 12, 4, 14).fill(0x2c333b); // бур-штанга
  g.poly([cx - 5, cy - 14 - 12 - HH * 0.38 - 12, cx + 5, cy - 14 - 12 - HH * 0.38 - 12, cx, cy - 14 - 12 - HH * 0.38 - 20]).fill(0xc2c8d0);
  if (dx > 0 || dy > 0) nozzle();
  const lamp = !b.ore ? 0x8a8f96 : b.blocked ? 0xe0524a : 0x6fdc6f;
  g.circle(cx - HW * 0.5, cy - 14 + HH * 0.2, 2.6).fill(lamp);
}

// Склад: деревянный ящик с крышкой и жёлто-чёрной полосой.
export function drawStorage(g, b) {
  const { x: cx, y: cy } = centerOf(b);
  g.ellipse(cx, cy + 2, HW * 0.88, HH * 0.88).fill({ color: 0x000000, alpha: 0.2 });
  cube(g, cx, cy, HW * 0.82, HH * 0.82, 18, 0xc9a36a, 0xa27a45, 0x865f33);
  const hw = HW * 0.82;
  const hh = HH * 0.82;
  g.poly([cx, cy - 18 - hh * 0.6, cx + hw * 0.62, cy - 18, cx, cy - 18 + hh * 0.6, cx - hw * 0.62, cy - 18]).fill(0xb48f56); // крышка
  g.poly([cx, cy + hh - 6, cx + hw, cy - 6, cx + hw, cy - 12, cx, cy + hh - 12]).fill(0xf2c74a); // полоса на правой грани
  g.poly([cx, cy + hh - 12, cx + hw, cy - 12, cx + hw, cy - 14, cx, cy + hh - 14]).fill(0x2c2c30);
}

// Руда на ленте.
export function drawItem(g, x, y, item) {
  const c = PAL.ore[ITEM_ORE[item]] || PAL.ore[1];
  g.ellipse(x, y + 1, 5, 2.4).fill({ color: 0x000000, alpha: 0.25 });
  g.ellipse(x, y - 2, 4.6, 3.6).fill(c.base);
  g.ellipse(x - 1.2, y - 3.2, 2.3, 1.6).fill(c.light);
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
