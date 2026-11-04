// Контроллер стройки: выбранный инструмент, поворот и «штрих» (проведение пальцем или мышью по клеткам).
// Штрих ленивый: первая клетка ставится только когда палец дошёл до второй клетки или отпущен без второго пальца.
// Так щипок двумя пальцами (первый палец успел коснуться карты раньше второго) ничего не строит.
import { BT, DIRS, dirIndex } from "./factory.js";

export const BUILD_TOOLS = ["miner", "sawmill", "pump", "belt", "storage", "splitter", "smelter", "constructor", "pole", "powerplant", "solar", "house", "shop", "park"];
export const TOOLS = ["hand", ...BUILD_TOOLS, "erase"];
const TOOL_TYPE = { miner: BT.MINER, belt: BT.BELT, storage: BT.STORAGE, smelter: BT.SMELTER, constructor: BT.CONSTRUCTOR, splitter: BT.SPLITTER, pole: BT.POLE, powerplant: BT.POWERPLANT, solar: BT.SOLAR, sawmill: BT.SAWMILL, pump: BT.PUMP, house: BT.HOUSE, shop: BT.SHOP, park: BT.PARK };

const HISTORY = 20;

export class Builder {
  constructor(factory) {
    this.f = factory;
    this.tool = "hand";
    this.rot = 0;
    this.plan = []; // лента, протянутая пальцем: показана, но ещё не поставлена
    this.history = [];
    this.cur = null;
    this.stroke = null;
  }

  get active() {
    return this.tool !== "hand";
  }

  setTool(tool) {
    if (!TOOLS.includes(tool)) return;
    this.tool = tool;
    this.stroke = null;
  }

  rotate(step = 1) {
    this.rot = (this.rot + step + 4) % 4;
  }

  // Направление новой ленты по соседям: если в клетку никто не упирается, а рядом есть одна лента, лента сама поворачивает к ней
  // (подключение сбоку к идущей прямо ленте). Иначе null: берётся ручной поворот.
  autoBeltDir(x, y) {
    const targets = [];
    for (let d = 0; d < 4; d++) {
      const n = this.f.get(x + DIRS[d][0], y + DIRS[d][1]);
      if (!n || (n.type !== BT.BELT && n.type !== BT.MINER)) continue;
      const feeds = n.x + DIRS[n.dir][0] === x && n.y + DIRS[n.dir][1] === y;
      if (feeds) return null; // уже есть питающая лента: направление выбирает игрок
      if (n.type === BT.BELT) targets.push(d);
    }
    return targets.length === 1 ? targets[0] : null;
  }

  // Можно ли здесь поставить текущей постройкой (для подсветки): {ok, reason, type, dir} или null для «руки».
  preview(x, y) {
    if (!this.active) return null;
    if (this.tool === "erase") return { ok: !!this.f.get(x, y), reason: "", type: "erase", dir: 0 };
    const type = TOOL_TYPE[this.tool];
    const r = this.f.canPlace(type, x, y);
    const auto = type === BT.BELT ? this.autoBeltDir(x, y) : null;
    return { ok: r.ok, reason: r.reason, missing: r.missing, type, dir: auto ?? this.rot };
  }

  // ---- отмена: каждое действие (касание или штрих) запоминает, что стояло в тронутых клетках ----
  _note(x, y) {
    if (!this.cur) return;
    const k = x + "," + y;
    if (this.cur.tiles.has(k)) return;
    const b = this.f.get(x, y);
    if (b && b.lvl > 1) this.cur.locked = true; // улучшенное здание цену не вернёт точно: дальше назад не отменяем
    this.cur.tiles.set(k, { x, y, was: b ? { type: b.type, dir: b.dir, recipe: b.recipe ?? null, lvl: b.lvl ?? 1 } : null });
  }

  _finish() {
    const c = this.cur;
    this.cur = null;
    if (!c || c.tiles.size === 0) return;
    if (c.locked) this.history.length = 0;
    else this.history.push([...c.tiles.values()]);
    if (this.history.length > HISTORY) this.history.shift();
  }

  get canUndo() {
    return this.history.length > 0;
  }

  // Откатывает последнее действие. Возвращает число восстановленных клеток.
  undo() {
    const tiles = this.history.pop();
    if (!tiles) return 0;
    for (const t of tiles) if (this.f.get(t.x, t.y)) this.f.remove(t.x, t.y);
    for (const t of tiles) {
      if (!t.was) continue;
      const b = this.f.place(t.was.type, t.x, t.y, t.was.dir);
      if (b && t.was.recipe) this.f.setRecipe(t.x, t.y, t.was.recipe);
    }
    return tiles.length;
  }

  // ---- штрих ----
  begin(x, y) {
    if (!this.active) return false;
    this.stroke = { pending: { x, y }, started: false, last: { x, y }, visited: new Set([x + "," + y]) };
    this.plan = [];
    this.cur = { tiles: new Map(), locked: false };
    return true;
  }

  move(x, y) {
    const s = this.stroke;
    if (!s) return 0;
    let changed = 0;
    if (!s.started) {
      if (x === s.last.x && y === s.last.y) return 0;
      changed += this._commitFirst(true);
    }
    return changed + this._walk(x, y);
  }

  // Конец штриха. Лента, протянутая пальцем, до этого момента только показана (this.plan): ставится сейчас.
  end() {
    const s = this.stroke;
    if (!s) return 0;
    let n = 0;
    if (this.tool === "belt" && s.started) n = this._commitPlan();
    else if (!s.started) n = this._commitFirst(false);
    this.stroke = null;
    this.plan = [];
    this._finish();
    return n;
  }

  // Второй палец коснулся карты: начатый штрих отменяется, ничего не поставлено.
  cancel() {
    this.stroke = null;
    this.plan = [];
    this._finish();
  }

  _commitFirst(dragging) {
    const s = this.stroke;
    s.started = true;
    const { x, y } = s.pending;
    if (this.tool === "belt") {
      // одиночное касание ставит сразу; при протяжке клетка входит в план и ставится вместе со всеми
      if (this.f.canPlace(BT.BELT, x, y).ok) this.plan.push({ x, y, d: this.autoBeltDir(x, y) ?? this.rot, din: this.rot });
      if (!dragging) return this._commitPlan();
      return 0;
    }
    this._note(x, y);
    if (this.tool === "erase") return this.f.remove(x, y) ? 1 : 0;
    return this.f.place(TOOL_TYPE[this.tool], x, y, this.rot) ? 1 : 0;
  }

  _commitPlan() {
    let n = 0;
    for (const e of this.plan) {
      this._note(e.x, e.y);
      if (!this.f.place(BT.BELT, e.x, e.y, e.d)) break; // не хватило ресурсов: остальное не ставим
      n++;
    }
    this.plan = [];
    return n;
  }

  _walk(tx, ty) {
    const s = this.stroke;
    let changed = 0;
    for (let guard = 0; guard < 200 && (s.last.x !== tx || s.last.y !== ty); guard++) {
      if (this.tool === "belt" && this._retreat(tx, ty)) continue;
      const dx = tx - s.last.x;
      const dy = ty - s.last.y;
      const sx = Math.sign(dx);
      const sy = Math.sign(dy);
      const steps = [];
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (sx) steps.push([sx, 0]);
        if (sy) steps.push([0, sy]);
      } else {
        if (sy) steps.push([0, sy]);
        if (sx) steps.push([sx, 0]);
      }
      let moved = false;
      for (const [cx, cy] of steps) {
        const nx = s.last.x + cx;
        const ny = s.last.y + cy;
        if (s.visited.has(nx + "," + ny)) continue;
        if (this.tool === "belt") {
          if (!this.f.canPlace(BT.BELT, nx, ny).ok) continue;
          const d = dirIndex(cx, cy);
          const tail = this.plan[this.plan.length - 1];
          if (tail && tail.x === s.last.x && tail.y === s.last.y) tail.d = d; // предыдущая лента поворачивает к новой
          this.plan.push({ x: nx, y: ny, d, din: d });
          changed++;
        } else if (this.tool === "erase") {
          this._note(nx, ny);
          if (this.f.remove(nx, ny)) changed++;
        } else {
          this._note(nx, ny);
          if (this.f.place(TOOL_TYPE[this.tool], nx, ny, this.rot)) changed++;
        }
        s.visited.add(nx + "," + ny);
        s.last = { x: nx, y: ny };
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return changed;
  }

  // Палец вернулся назад по уже намеченной ленте: лишние клетки убираются из плана.
  _retreat(tx, ty) {
    const s = this.stroke;
    const i = this.plan.findIndex((e) => e.x === tx && e.y === ty);
    if (i < 0 || i >= this.plan.length - 1) return false;
    while (this.plan.length - 1 > i) {
      const e = this.plan.pop();
      s.visited.delete(e.x + "," + e.y);
    }
    const tail = this.plan[this.plan.length - 1];
    tail.d = tail.din;
    s.last = { x: tail.x, y: tail.y };
    return true;
  }
}
