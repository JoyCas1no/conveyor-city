// Симуляция завода: бур, конвейер, склад, плавильня, станок, разветвитель. Чистая логика без DOM и Pixi.
// Направления: 0 = +x (вправо-вниз на экране), 1 = +y (влево-вниз), 2 = -x (влево-вверх), 3 = -y (вправо-вверх).
import { tileAt, T } from "./worldgen.js";

export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const TICK = 0.05; // секунд на один шаг симуляции (20 в секунду)
export const BELT_SPEED = 2; // клеток в секунду
export const MINER_PERIOD = 2; // секунд на одну руду
export const SMELT_TICKS = Math.round(3 / TICK); // плавильня: слиток за 3 с
export const FUEL_PER_COAL = 4; // один уголь = 4 слитка
export const FUEL_CAP = 16; // в баке не больше 16 единиц топлива (4 угля)
export const BUFFER_CAP = 2; // входной запас машины по каждому предмету

export const BT = {
  BELT: "belt",
  MINER: "miner",
  STORAGE: "storage",
  SMELTER: "smelter",
  CONSTRUCTOR: "constructor",
  SPLITTER: "splitter",
};
export const MACHINES = [BT.SMELTER, BT.CONSTRUCTOR];
export const ORE_ITEM = { 1: "iron_ore", 2: "copper_ore", 3: "coal" };
export const ITEMS = ["iron_ore", "copper_ore", "coal", "iron_ingot", "copper_ingot", "iron_plate", "gear", "copper_wire"];
export const SMELT = { iron_ore: "iron_ingot", copper_ore: "copper_ingot" };
export const RECIPES = {
  plate: { in: "iron_ingot", out: "iron_plate", ticks: Math.round(2 / TICK) },
  gear: { in: "iron_ingot", out: "gear", ticks: Math.round(3 / TICK) },
  wire: { in: "copper_ingot", out: "copper_wire", ticks: Math.round(2 / TICK) },
};
export const RECIPE_ORDER = ["plate", "gear", "wire"];
// Цены: платим из общего счёта склада. Бур, конвейер и склад бесплатные, чтобы всегда можно было начать с нуля.
export const COSTS = {
  smelter: { iron_ore: 10 },
  constructor: { iron_ingot: 10 },
  splitter: { iron_ingot: 5 },
};
const CODE = { belt: "b", miner: "m", storage: "s", smelter: "f", constructor: "c", splitter: "p" };
const TYPE_OF = { b: BT.BELT, m: BT.MINER, s: BT.STORAGE, f: BT.SMELTER, c: BT.CONSTRUCTOR, p: BT.SPLITTER };
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
    this.created = {}; // сколько предметов каждого вида появилось (бур, готовая продукция, возврат цены)
    this.sunk = {}; // сколько исчезло (сырьё в переработке, уголь в бак, оплата построек)
    this.produced = 0; // сколько руды добыто бурами
    this.lost = 0; // зарезервировано: предметы не теряются, снос возвращает всё на склад
    this.tickCount = 0;
    this.rev = 0; // растёт при любом изменении состава построек
    this.dirty = new Set(); // ключи клеток, изменённых с прошлой отрисовки
    this._listRev = -1;
    this._lists_ = null;
  }

  get(x, y) {
    return this.map.get(key(x, y)) || null;
  }

  get count() {
    return this.map.size;
  }

  _add(map, item, n = 1) {
    map[item] = (map[item] || 0) + n;
  }

  // ---- цены ----
  missing(type) {
    const cost = COSTS[type];
    const out = {};
    if (!cost) return out;
    for (const t of Object.keys(cost)) {
      const lack = cost[t] - (this.stock[t] || 0);
      if (lack > 0) out[t] = lack;
    }
    return out;
  }

  canAfford(type) {
    return Object.keys(this.missing(type)).length === 0;
  }

  // Можно ли поставить здание: суша без леса и скал, бур только на руде, хватает ресурсов. Результат {ok, reason, missing}.
  canPlace(type, x, y) {
    const t = tileAt(x, y, this.seed);
    if (t.type !== T.GRASS && t.type !== T.SAND) return { ok: false, reason: "terrain" };
    const ex = this.get(x, y);
    if (ex && !(type === BT.BELT && ex.type === BT.BELT)) return { ok: false, reason: "occupied" };
    if (type === BT.MINER && !t.ore) return { ok: false, reason: "noore" };
    if (!ex) {
      const missing = this.missing(type);
      if (Object.keys(missing).length) return { ok: false, reason: "cost", missing };
    }
    return { ok: true, reason: "" };
  }

  // Ставит здание за плату; конвейер поверх конвейера поворачивается. Возвращает здание или null.
  place(type, x, y, dir = 0) {
    if (!this.canPlace(type, x, y).ok) return null;
    const ex = this.get(x, y);
    if (ex) {
      if (ex.dir !== dir) this._rotate(ex, dir);
      return ex;
    }
    const cost = COSTS[type];
    if (cost) {
      for (const t of Object.keys(cost)) {
        this.stock[t] -= cost[t];
        this._add(this.sunk, t, cost[t]);
      }
    }
    const b = this._make(type, x, y, dir);
    this.map.set(key(x, y), b);
    this._touch(x, y);
    return b;
  }

  _make(type, x, y, dir, extra) {
    const b = { type, x, y, dir: type === BT.STORAGE || type === BT.SPLITTER ? 0 : dir };
    if (type === BT.BELT) b.item = null;
    if (type === BT.MINER) {
      b.ore = tileAt(x, y, this.seed).ore;
      b.prog = 0;
      b.out = null;
      b.blocked = false;
    }
    if (type === BT.SMELTER) {
      b.in = { iron_ore: 0, copper_ore: 0 };
      b.fuel = FUEL_PER_COAL; // новая плавильня заправлена на 4 слитка: хватает, чтобы дошёл первый уголь
      b.busy = null;
      b.prog = 0;
      b.out = null;
      b.last = 0;
      b.blocked = false;
    }
    if (type === BT.CONSTRUCTOR) {
      b.recipe = RECIPES[extra] ? extra : "plate";
      b.have = 0;
      b.busy = false;
      b.prog = 0;
      b.out = null;
      b.blocked = false;
    }
    if (type === BT.SPLITTER) {
      b.item = null;
      b.from = 0;
      b.rr = 0;
    }
    return b;
  }

  rotateAt(x, y, dir) {
    const b = this.get(x, y);
    if (!b || b.type === BT.STORAGE || b.type === BT.SPLITTER) return false;
    this._rotate(b, dir);
    return true;
  }

  _rotate(b, dir) {
    b.dir = dir;
    if (b.type === BT.BELT && b.item && b.item.from === dir) b.item.from = (dir + 2) % 4;
    this._touch(b.x, b.y);
  }

  // Меняет рецепт станка: накопленные слитки возвращаются на склад.
  setRecipe(x, y, name) {
    const b = this.get(x, y);
    if (!b || b.type !== BT.CONSTRUCTOR || !RECIPES[name] || b.recipe === name) return false;
    const old = RECIPES[b.recipe];
    if (b.have) this._add(this.stock, old.in, b.have);
    if (b.busy) this._add(this.stock, old.in);
    b.have = 0;
    b.busy = false;
    b.prog = 0;
    b.recipe = name;
    this._touch(b.x, b.y);
    return true;
  }

  // Всё, что лежит внутри здания, возвращается на склад (оплата не возвращается: её делает remove).
  _giveBack(b) {
    const give = (t, n = 1) => this._add(this.stock, t, n);
    if (b.type === BT.BELT && b.item) give(b.item.t);
    if (b.type === BT.MINER && b.out) give(b.out);
    if (b.type === BT.SMELTER) {
      for (const t of Object.keys(b.in)) if (b.in[t]) give(t, b.in[t]);
      if (b.busy) give(b.busy);
      if (b.out) give(b.out);
    }
    if (b.type === BT.CONSTRUCTOR) {
      if (b.have) give(RECIPES[b.recipe].in, b.have);
      if (b.busy) give(RECIPES[b.recipe].in);
      if (b.out) give(b.out);
    }
    if (b.type === BT.SPLITTER && b.item) give(b.item);
  }

  // Снос возвращает цену и всё, что было внутри.
  remove(x, y) {
    const b = this.get(x, y);
    if (!b) return false;
    this._giveBack(b);
    const cost = COSTS[b.type];
    if (cost) {
      for (const t of Object.keys(cost)) {
        this._add(this.stock, t, cost[t]);
        this._add(this.created, t, cost[t]);
      }
    }
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
      const L = { belts: [], miners: [], smelters: [], constructors: [], splitters: [] };
      for (const b of this.map.values()) {
        if (b.type === BT.BELT) L.belts.push(b);
        else if (b.type === BT.MINER) L.miners.push(b);
        else if (b.type === BT.SMELTER) L.smelters.push(b);
        else if (b.type === BT.CONSTRUCTOR) L.constructors.push(b);
        else if (b.type === BT.SPLITTER) L.splitters.push(b);
      }
      this._lists_ = L;
      this._listRev = this.rev;
    }
    return this._lists_;
  }

  // Предмет едет из клетки (fx, fy) в клетку (tx, ty). true, если принят.
  push(item, tx, ty, fx, fy) {
    const target = this.get(tx, ty);
    if (!target) return false;
    const from = dirIndex(fx - tx, fy - ty);
    if (from < 0) return false;
    switch (target.type) {
      case BT.STORAGE:
        this._add(this.stock, item);
        return true;
      case BT.BELT:
        if (target.item || from === target.dir) return false; // в лоб (с передней стороны) конвейер не принимает
        target.item = { t: item, p: 0, from, moving: true };
        return true;
      case BT.SMELTER:
        if (from === target.dir) return false;
        if (item === "coal") {
          if (target.fuel > FUEL_CAP - FUEL_PER_COAL) return false; // бак полон
          target.fuel += FUEL_PER_COAL;
          this._add(this.sunk, "coal");
          return true;
        }
        if (SMELT[item] && target.in[item] < BUFFER_CAP) {
          target.in[item]++;
          return true;
        }
        return false;
      case BT.CONSTRUCTOR:
        if (from === target.dir) return false;
        if (item === RECIPES[target.recipe].in && target.have < BUFFER_CAP) {
          target.have++;
          return true;
        }
        return false;
      case BT.SPLITTER:
        if (target.item) return false;
        target.item = item;
        target.from = from;
        return true;
      default:
        return false;
    }
  }

  _pushOut(m) {
    const [dx, dy] = DIRS[m.dir];
    if (this.push(m.out, m.x + dx, m.y + dy, m.x, m.y)) {
      m.out = null;
      m.blocked = false;
    } else m.blocked = true;
  }

  tick() {
    this.tickCount++;
    const { belts, miners, smelters, constructors, splitters } = this._lists();

    for (const m of miners) {
      const kind = ORE_ITEM[m.ore];
      if (!kind) continue; // под буром больше нет руды (карту могли изменить): стоит
      if (!m.out) {
        m.prog += TICK;
        if (m.prog >= MINER_PERIOD) {
          m.out = kind;
          m.prog = 0;
          this.produced++;
          this._add(this.created, kind);
        }
      }
      if (m.out) this._pushOut(m);
    }

    for (const m of smelters) {
      if (!m.busy && !m.out && m.fuel > 0) {
        const order = m.last ? ["copper_ore", "iron_ore"] : ["iron_ore", "copper_ore"];
        for (const t of order) {
          if (m.in[t] > 0) {
            m.in[t]--;
            m.busy = t;
            m.prog = 0;
            m.fuel--;
            m.last = t === "iron_ore" ? 1 : 0;
            break;
          }
        }
      }
      if (m.busy) {
        m.prog = Math.min(SMELT_TICKS, m.prog + 1);
        if (m.prog >= SMELT_TICKS && !m.out) {
          m.out = SMELT[m.busy];
          this._add(this.sunk, m.busy);
          this._add(this.created, m.out);
          m.busy = null;
          m.prog = 0;
        }
      }
      if (m.out) this._pushOut(m);
    }

    for (const m of constructors) {
      const r = RECIPES[m.recipe];
      if (!m.busy && !m.out && m.have > 0) {
        m.have--;
        m.busy = true;
        m.prog = 0;
      }
      if (m.busy) {
        m.prog = Math.min(r.ticks, m.prog + 1);
        if (m.prog >= r.ticks && !m.out) {
          m.out = r.out;
          this._add(this.sunk, r.in);
          this._add(this.created, r.out);
          m.busy = false;
          m.prog = 0;
        }
      }
      if (m.out) this._pushOut(m);
    }

    for (const m of splitters) {
      if (!m.item) continue;
      for (let k = 0; k < 4; k++) {
        const d = (m.rr + k) % 4;
        if (d === m.from) continue;
        const t = this.get(m.x + DIRS[d][0], m.y + DIRS[d][1]);
        if (!t || t.type === BT.SPLITTER) continue;
        if (this.push(m.item, t.x, t.y, m.x, m.y)) {
          m.item = null;
          m.rr = (d + 1) % 4;
          break;
        }
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

  // Состояние здания для подсказки и лампочки: work, blocked, idle, noore, nofuel, clog, noinput.
  status(b) {
    switch (b.type) {
      case BT.MINER:
        return !ORE_ITEM[b.ore] ? "idle" : b.blocked ? "blocked" : "work";
      case BT.SMELTER: {
        if (b.out && b.blocked) return "blocked";
        if (b.busy) return "work";
        if (b.in.iron_ore + b.in.copper_ore === 0) return b.fuel > FUEL_CAP - FUEL_PER_COAL ? "clog" : "noore";
        return b.fuel === 0 ? "nofuel" : "work";
      }
      case BT.CONSTRUCTOR:
        if (b.out && b.blocked) return "blocked";
        if (b.busy) return "work";
        return b.have === 0 ? "noinput" : "work";
      default:
        return "work";
    }
  }

  // Учёт по видам: появилось = на складе + на лентах + внутри машин + исчезло. Для каждого вида отдельно.
  audit() {
    const onBelts = {};
    const inside = {};
    for (const b of this.map.values()) {
      if (b.type === BT.BELT && b.item) this._add(onBelts, b.item.t);
      if (b.type === BT.MINER && b.out) this._add(inside, b.out);
      if (b.type === BT.SMELTER) {
        for (const t of Object.keys(b.in)) if (b.in[t]) this._add(inside, t, b.in[t]);
        if (b.busy) this._add(inside, b.busy);
        if (b.out) this._add(inside, b.out);
      }
      if (b.type === BT.CONSTRUCTOR) {
        const r = RECIPES[b.recipe];
        if (b.have) this._add(inside, r.in, b.have);
        if (b.busy) this._add(inside, r.in);
        if (b.out) this._add(inside, b.out);
      }
      if (b.type === BT.SPLITTER && b.item) this._add(inside, b.item);
    }
    let ok = true;
    const bad = [];
    for (const t of ITEMS) {
      const left = (this.created[t] || 0) - (this.stock[t] || 0) - (onBelts[t] || 0) - (inside[t] || 0) - (this.sunk[t] || 0);
      if (left !== 0) {
        ok = false;
        bad.push(`${t}: ${left}`);
      }
    }
    const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
    return { ok, bad, produced: this.produced, stock: sum(this.stock), onBelts: sum(onBelts), inMachines: sum(inside), lost: this.lost };
  }

  toJSON() {
    const buildings = [];
    for (const b of this.map.values()) {
      const e = [CODE[b.type], b.x, b.y, b.dir];
      if (b.type === BT.CONSTRUCTOR) e.push(b.recipe);
      buildings.push(e);
    }
    return { v: SAVE_VERSION, seed: this.seed, buildings, stock: { ...this.stock } };
  }

  // Загрузка без проверки canPlace: генерация мира могла измениться. Возвращает число построек или -1.
  loadJSON(data) {
    if (!data || data.v !== SAVE_VERSION || data.seed !== this.seed || !Array.isArray(data.buildings)) return -1;
    this.map.clear();
    this.stock = {};
    this.created = {};
    this.sunk = {};
    let n = 0;
    for (const e of data.buildings) {
      if (!Array.isArray(e)) continue;
      const [c, x, y, d, extra] = e;
      const type = TYPE_OF[c];
      if (!type || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(d) || d < 0 || d > 3) continue;
      this.map.set(key(x, y), this._make(type, x, y, d, extra));
      this.dirty.add(key(x, y));
      n++;
    }
    if (data.stock && typeof data.stock === "object") {
      for (const k of Object.keys(data.stock)) {
        const v = data.stock[k];
        if (Number.isFinite(v) && v >= 0 && ITEMS.includes(k)) this.stock[k] = Math.floor(v);
      }
    }
    for (const k of Object.keys(this.stock)) this.created[k] = this.stock[k]; // учёт продолжается со склада
    this.produced = 0;
    this.lost = 0;
    this.rev++;
    return n;
  }
}
