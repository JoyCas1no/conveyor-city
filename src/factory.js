// Симуляция завода: бур, конвейер, склад. Чистая логика без DOM и Pixi (гоняется автотестами в Node).
// Направления: 0 = +x (вправо-вниз на экране), 1 = +y (влево-вниз), 2 = -x (влево-вверх), 3 = -y (вправо-вверх).
import { tileAt, T } from "./worldgen.js";

export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const TICK = 0.05; // секунд на один шаг симуляции (20 в секунду)
export const BELT_SPEED = 2; // клеток в секунду
export const MINER_PERIOD = 2; // секунд на одну руду
export const BT = { BELT: "belt", MINER: "miner", STORAGE: "storage" };
export const ORE_ITEM = { 1: "iron_ore", 2: "copper_ore", 3: "coal" };
const CODE = { belt: "b", miner: "m", storage: "s" };
const TYPE_OF = { b: BT.BELT, m: BT.MINER, s: BT.STORAGE };
export const SAVE_VERSION = 1;

const key = (x, y) => x + "," + y;

export function dirIndex(dx, dy) {
  for (let i = 0; i < 4; i++) if (DIRS[i][0] === dx && DIRS[i][1] === dy) return i;
  return -1;
}

// Положение предмета на ленте в координатах клеток: от середины стороны входа к центру и к середине выхода.
export function itemPosition(b, from, p) {
  const cx = b.x + 0.5;
  const cy = b.y + 0.5;
  const [fx, fy] = DIRS[from];
  const [ex, ey] = DIRS[b.dir];
  if (p < 0.5) {
    const k = 1 - p / 0.5;
    return { x: cx + fx * 0.5 * k, y: cy + fy * 0.5 * k };
  }
  const k = (p - 0.5) / 0.5;
  return { x: cx + ex * 0.5 * k, y: cy + ey * 0.5 * k };
}

export class Factory {
  constructor(seed) {
    this.seed = seed;
    this.map = new Map();
    this.stock = {};
    this.produced = 0; // сколько руды добыто бурами
    this.lost = 0; // сколько предметов пропало при сносе
    this.tickCount = 0;
    this.rev = 0; // растёт при любом изменении состава построек
    this.dirty = new Set(); // ключи клеток, изменённых с прошлой отрисовки
    this._listRev = -1;
    this._belts = [];
    this._miners = [];
  }

  get(x, y) {
    return this.map.get(key(x, y)) || null;
  }

  get count() {
    return this.map.size;
  }

  // Можно ли поставить здание: суша без леса и скал, бур только на руде. Результат {ok, reason}.
  canPlace(type, x, y) {
    const t = tileAt(x, y, this.seed);
    if (t.type !== T.GRASS && t.type !== T.SAND) return { ok: false, reason: "terrain" };
    const ex = this.get(x, y);
    if (ex && !(type === BT.BELT && ex.type === BT.BELT)) return { ok: false, reason: "occupied" };
    if (type === BT.MINER && !t.ore) return { ok: false, reason: "noore" };
    return { ok: true, reason: "" };
  }

  // Ставит здание; конвейер поверх конвейера просто поворачивается. Возвращает здание или null.
  place(type, x, y, dir = 0) {
    if (!this.canPlace(type, x, y).ok) return null;
    const ex = this.get(x, y);
    if (ex) {
      if (ex.dir !== dir) this._rotate(ex, dir);
      return ex;
    }
    const b = this._make(type, x, y, dir);
    this.map.set(key(x, y), b);
    this._touch(x, y);
    return b;
  }

  _make(type, x, y, dir) {
    const b = { type, x, y, dir: type === BT.STORAGE ? 0 : dir };
    if (type === BT.BELT) b.item = null;
    if (type === BT.MINER) {
      b.ore = tileAt(x, y, this.seed).ore;
      b.prog = 0;
      b.out = null;
      b.blocked = false;
    }
    return b;
  }

  rotateAt(x, y, dir) {
    const b = this.get(x, y);
    if (!b || b.type === BT.STORAGE) return false;
    this._rotate(b, dir);
    return true;
  }

  _rotate(b, dir) {
    b.dir = dir;
    if (b.type === BT.BELT && b.item && b.item.from === dir) b.item.from = (dir + 2) % 4;
    this._touch(b.x, b.y);
  }

  remove(x, y) {
    const b = this.get(x, y);
    if (!b) return false;
    if (b.type === BT.BELT && b.item) this.lost++;
    if (b.type === BT.MINER && b.out) this.lost++;
    this.map.delete(key(x, y));
    this._touch(x, y);
    return true;
  }

  _touch(x, y) {
    this.rev++;
    this.dirty.add(key(x, y));
  }

  _lists() {
    if (this._listRev !== this.rev) {
      this._belts = [];
      this._miners = [];
      for (const b of this.map.values()) {
        if (b.type === BT.BELT) this._belts.push(b);
        else if (b.type === BT.MINER) this._miners.push(b);
      }
      this._listRev = this.rev;
    }
    return { belts: this._belts, miners: this._miners };
  }

  // Предмет едет из клетки (fx, fy) в клетку (tx, ty). true, если принят.
  push(item, tx, ty, fx, fy) {
    const target = this.get(tx, ty);
    if (!target) return false;
    if (target.type === BT.STORAGE) {
      this.stock[item] = (this.stock[item] || 0) + 1;
      return true;
    }
    if (target.type === BT.BELT) {
      if (target.item) return false;
      const from = dirIndex(fx - tx, fy - ty);
      if (from < 0 || from === target.dir) return false; // в лоб (с передней стороны) конвейер не принимает
      target.item = { t: item, p: 0, from, moving: true };
      return true;
    }
    return false;
  }

  tick() {
    this.tickCount++;
    const { belts, miners } = this._lists();

    for (const m of miners) {
      const kind = ORE_ITEM[m.ore];
      if (!kind) continue; // под буром больше нет руды (карту могли изменить): стоит
      if (!m.out) {
        m.prog += TICK;
        if (m.prog >= MINER_PERIOD) {
          m.out = kind;
          m.prog = 0;
          this.produced++;
        }
      }
      if (m.out) {
        const [dx, dy] = DIRS[m.dir];
        if (this.push(m.out, m.x + dx, m.y + dy, m.x, m.y)) {
          m.out = null;
          m.blocked = false;
        } else m.blocked = true;
      }
    }

    for (const b of belts) {
      const it = b.item;
      if (!it) continue;
      if (it.p < 1) {
        it.p = Math.min(1, it.p + BELT_SPEED * TICK);
        it.moving = it.p < 1;
      } else it.moving = false;
    }

    const n = belts.length;
    const reverse = (this.tickCount & 1) === 1; // чередуем порядок, чтобы слияния были честными
    for (let k = 0; k < n; k++) {
      const b = belts[reverse ? n - 1 - k : k];
      const it = b.item;
      if (!it || it.p < 1) continue;
      const [dx, dy] = DIRS[b.dir];
      if (this.push(it.t, b.x + dx, b.y + dy, b.x, b.y)) b.item = null;
    }
  }

  // Учёт предметов: добыто = на складе + на лентах + в бурах + потеряно при сносе.
  audit() {
    let onBelts = 0;
    let inMiners = 0;
    let stock = 0;
    for (const b of this.map.values()) {
      if (b.type === BT.BELT && b.item) onBelts++;
      if (b.type === BT.MINER && b.out) inMiners++;
    }
    for (const k of Object.keys(this.stock)) stock += this.stock[k];
    return { produced: this.produced, stock, onBelts, inMiners, lost: this.lost, ok: this.produced === stock + onBelts + inMiners + this.lost };
  }

  toJSON() {
    const buildings = [];
    for (const b of this.map.values()) buildings.push([CODE[b.type], b.x, b.y, b.dir]);
    return { v: SAVE_VERSION, seed: this.seed, buildings, stock: { ...this.stock } };
  }

  // Загрузка без проверки canPlace: генерация мира могла измениться. Возвращает число построек или -1.
  loadJSON(data) {
    if (!data || data.v !== SAVE_VERSION || data.seed !== this.seed || !Array.isArray(data.buildings)) return -1;
    this.map.clear();
    this.stock = {};
    let n = 0;
    for (const e of data.buildings) {
      if (!Array.isArray(e)) continue;
      const [c, x, y, d] = e;
      const type = TYPE_OF[c];
      if (!type || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(d) || d < 0 || d > 3) continue;
      this.map.set(key(x, y), this._make(type, x, y, d));
      this.dirty.add(key(x, y));
      n++;
    }
    if (data.stock && typeof data.stock === "object") {
      for (const k of Object.keys(data.stock)) {
        const v = data.stock[k];
        if (Number.isFinite(v) && v >= 0 && Object.values(ORE_ITEM).includes(k)) this.stock[k] = Math.floor(v);
      }
    }
    this.produced = Object.values(this.stock).reduce((a, v) => a + v, 0); // счётчик добычи продолжается со склада
    this.lost = 0;
    this.rev++;
    return n;
  }
}
