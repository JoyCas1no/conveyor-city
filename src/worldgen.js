// Генерация мира. tileAt зависит только от (x, y, seed), поэтому швов между кусками карты нет по построению.
import { fbm, rand2 } from "./noise.js";

export const CHUNK = 16; // клеток в стороне куска карты

export const T = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, HILL: 4 };
export const ORE = { NONE: 0, IRON: 1, COPPER: 2, COAL: 3 };

export const WATER_LEVEL = 0.4;
export const SAND_LEVEL = 0.43;
export const HILL_LEVEL = 0.7;
const FOREST_M = 0.56;
const SPAWN_R = 30; // вокруг (0,0) суша: полностью до радиуса 24, до 30 переход
const ORE_THRESHOLD = 0.82;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Центр стартового пятна руды k: на кольце радиуса 14..22 в направлении от seed.
export function oreSpawnCenter(k, seed) {
  const ang = rand2(k, 99, seed) * Math.PI * 2;
  const r = 12 + k * 3;
  return { x: Math.round(Math.cos(ang) * r), y: Math.round(Math.sin(ang) * r) };
}

function oreAt(x, y, seed) {
  let best = 0;
  let bestScore = ORE_THRESHOLD;
  for (let k = 1; k <= 3; k++) {
    let score = fbm(x / 9 + k * 31.7, y / 9 - k * 17.3, seed + 101 * k, 2);
    const c = oreSpawnCenter(k, seed);
    const d = Math.hypot(x - c.x, y - c.y);
    score += Math.max(0, 1 - d / 4.5) * 0.9;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

// Что в клетке: тип земли, руда, высота скалы (px), высота рельефа e и влажность m.
export function tileAt(x, y, seed) {
  const d = Math.hypot(x, y);
  let e = fbm(x / 40, y / 40, seed, 4);
  const w = clamp((SPAWN_R - d) / 6, 0, 1); // полное сглаживание до SPAWN_R-6, дальше плавный переход
  if (w > 0) e = e * (1 - w) + clamp(e, 0.44, 0.66) * w;
  const m = fbm(x / 26, y / 26, seed + 777, 3);
  let type;
  let h = 0;
  if (e < WATER_LEVEL) type = T.WATER;
  else if (e < SAND_LEVEL) type = T.SAND;
  else if (e >= HILL_LEVEL) {
    type = T.HILL;
    h = 10 + Math.floor(Math.min(1, (e - HILL_LEVEL) / 0.12) * 26);
  } else type = m > FOREST_M && d >= 22 ? T.FOREST : T.GRASS;
  const ore = type === T.GRASS || type === T.SAND ? oreAt(x, y, seed) : ORE.NONE;
  return { type, ore, h, e, m };
}

// Куски карты нужны для проверок и сохранений изменённых кусков: массивы длиной CHUNK*CHUNK, порядок j*CHUNK+i.
export function chunkTiles(cx, cy, seed) {
  const types = new Uint8Array(CHUNK * CHUNK);
  const ores = new Uint8Array(CHUNK * CHUNK);
  const heights = new Uint8Array(CHUNK * CHUNK);
  for (let j = 0; j < CHUNK; j++) {
    for (let i = 0; i < CHUNK; i++) {
      const t = tileAt(cx * CHUNK + i, cy * CHUNK + j, seed);
      types[j * CHUNK + i] = t.type;
      ores[j * CHUNK + i] = t.ore;
      heights[j * CHUNK + i] = t.h;
    }
  }
  return { types, ores, heights };
}
