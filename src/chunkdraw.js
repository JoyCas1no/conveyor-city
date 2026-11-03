// Рисование куска карты в Pixi Graphics. Клетки идут по диагоналям (x + y растёт), чтобы дальние закрывались ближними.
import { CHUNK, T, tileAt, WATER_LEVEL, HILL_LEVEL } from "./worldgen.js";
import { HW, HH, tileToScreen } from "./iso.js";
import { rand2 } from "./noise.js";
import { PAL, lerpColor, shade } from "./palette.js";

function quad(g, x1, y1, x2, y2, x3, y3, x4, y4, color, alpha = 1) {
  g.poly([x1, y1, x2, y2, x3, y3, x4, y4]).fill({ color, alpha });
}

function diamond(g, sx, sy, color) {
  quad(g, sx, sy, sx + HW, sy + HH, sx, sy + 2 * HH, sx - HW, sy + HH, color);
}

// Точка внутри ромба клетки: u, v в [-1, 1], масштаб k < 1 держит декор подальше от краёв.
function spot(sx, sy, u, v, k = 0.6) {
  const a = u * k, b = v * k;
  const s = Math.abs(a) + Math.abs(b) > 1 ? 1 / (Math.abs(a) + Math.abs(b)) : 1;
  return { x: sx + a * s * HW, y: sy + HH + b * s * HH };
}

function tree(g, x, y, scale, tone) {
  g.ellipse(x, y + 1, 9 * scale, 4 * scale).fill({ color: 0x000000, alpha: 0.18 });
  quad(g, x - 2, y, x + 2, y, x + 2, y - 9 * scale, x - 2, y - 9 * scale, PAL.trunk);
  const dark = shade(PAL.leafDark, tone);
  const light = shade(PAL.leafLight, tone);
  g.poly([x - 10 * scale, y - 6 * scale, x + 10 * scale, y - 6 * scale, x, y - 24 * scale]).fill(dark);
  g.poly([x - 8 * scale, y - 15 * scale, x + 8 * scale, y - 15 * scale, x, y - 31 * scale]).fill(light);
  g.poly([x, y - 31 * scale, x + 8 * scale, y - 15 * scale, x + 1, y - 15 * scale]).fill({ color: dark, alpha: 0.45 });
}

function lump(g, x, y, r, ore) {
  const c = PAL.ore[ore];
  g.ellipse(x, y + 1, r * 1.1, r * 0.5).fill({ color: 0x000000, alpha: 0.22 });
  g.ellipse(x, y - r * 0.3, r, r * 0.7).fill(c.base);
  g.ellipse(x - r * 0.25, y - r * 0.55, r * 0.5, r * 0.32).fill(c.light);
  g.circle(x + r * 0.45, y - r * 0.15, Math.max(1, r * 0.22)).fill(c.spot);
}

function drawTile(g, t, downLeft, downRight, x, y, seed) {
  const p = tileToScreen(x, y);
  const sx = p.x;
  const sy = p.y;
  const v = rand2(x, y, seed + 5);
  const h = t.h;
  const top = sy - h;

  if (h > 0) {
    const hl = downLeft ? downLeft.h : 0;
    const hr = downRight ? downRight.h : 0;
    if (h > hl) quad(g, sx - HW, sy + HH - h, sx, sy + 2 * HH - h, sx, sy + 2 * HH - hl, sx - HW, sy + HH - hl, PAL.hillSideL);
    if (h > hr) quad(g, sx, sy + 2 * HH - h, sx + HW, sy + HH - h, sx + HW, sy + HH - hr, sx, sy + 2 * HH - hr, PAL.hillSideR);
  }

  let color;
  if (t.type === T.WATER) {
    const depth = Math.min(1, (WATER_LEVEL - t.e) / 0.14);
    color = lerpColor(PAL.waterShallow, PAL.waterDeep, depth);
  } else if (t.type === T.SAND) color = PAL.sand;
  else if (t.type === T.HILL) color = lerpColor(PAL.hillTop, 0xe8e8ec, Math.min(1, (t.e - HILL_LEVEL) / 0.2));
  else if (t.type === T.FOREST) color = PAL.forestFloor;
  else color = lerpColor(PAL.grass, PAL.grassDry, Math.min(1, Math.max(0, t.m - 0.3)));
  color = shade(color, 0.96 + v * 0.08);
  diamond(g, sx, top, color);

  if (t.type === T.WATER) {
    if (v < 0.18) {
      const a = spot(sx, top, rand2(x, y, seed + 6) * 2 - 1, rand2(x, y, seed + 7) * 2 - 1, 0.5);
      g.moveTo(a.x - 6, a.y).lineTo(a.x + 6, a.y - 2).stroke({ width: 1, color: 0xffffff, alpha: 0.28 });
    }
  } else if (t.type === T.GRASS) {
    if (v > 0.7) {
      const a = spot(sx, top, rand2(x, y, seed + 8) * 2 - 1, rand2(x, y, seed + 9) * 2 - 1);
      g.moveTo(a.x, a.y).lineTo(a.x - 1, a.y - 4).moveTo(a.x + 2, a.y).lineTo(a.x + 3, a.y - 3)
        .stroke({ width: 1, color: shade(PAL.grass, 0.75), alpha: 0.9 });
    }
  } else if (t.type === T.HILL) {
    if (v > 0.55) {
      g.poly([sx - 12, top + HH, sx, top + HH - 6, sx + 10, top + HH, sx, top + HH + 5]).fill({ color: 0xffffff, alpha: 0.18 });
    }
  } else if (t.type === T.FOREST) {
    const n = 1 + Math.floor(rand2(x, y, seed + 10) * 2.99);
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push(spot(sx, top, rand2(x, y, seed + 20 + i) * 2 - 1, rand2(x, y, seed + 30 + i) * 2 - 1, 0.65));
    }
    pts.sort((a, b) => a.y - b.y);
    for (const q of pts) tree(g, q.x, q.y, 0.85 + rand2(q.x | 0, q.y | 0, seed + 40) * 0.35, 0.9 + v * 0.2);
  }

  if (t.ore) {
    diamond(g, sx, top, PAL.ore[t.ore].base); // пятно руды под камнями: видно издалека
    g.poly([sx, top, sx + HW, top + HH, sx, top + 2 * HH, sx - HW, top + HH]).fill({ color: color, alpha: 0.55 });
    const n = 4 + Math.floor(rand2(x, y, seed + 50) * 3);
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push(spot(sx, top, rand2(x, y, seed + 60 + i) * 2 - 1, rand2(x, y, seed + 70 + i) * 2 - 1, 0.75));
    }
    pts.sort((a, b) => a.y - b.y);
    for (const q of pts) lump(g, q.x, q.y, 4 + rand2(q.x | 0, q.y | 0, seed + 80) * 3, t.ore);
  }
}

export function drawChunk(g, cx, cy, seed) {
  const N = CHUNK;
  const x0 = cx * N;
  const y0 = cy * N;
  const W = N + 2;
  const grid = new Array(W * W);
  for (let j = -1; j <= N; j++) {
    for (let i = -1; i <= N; i++) grid[(j + 1) * W + (i + 1)] = tileAt(x0 + i, y0 + j, seed);
  }
  const at = (i, j) => grid[(j + 1) * W + (i + 1)];
  for (let s = 0; s <= 2 * N - 2; s++) {
    for (let i = Math.max(0, s - N + 1); i <= Math.min(s, N - 1); i++) {
      const j = s - i;
      drawTile(g, at(i, j), at(i, j + 1), at(i + 1, j), x0 + i, y0 + j, seed);
    }
  }
}
