// Контроллер стройки: выбранный инструмент, поворот и «штрих» (проведение пальцем или мышью по клеткам).
// Штрих ленивый: первая клетка ставится только когда палец дошёл до второй клетки или отпущен без второго пальца.
// Так щипок двумя пальцами (первый палец успел коснуться карты раньше второго) ничего не строит.
import { BT, dirIndex } from "./factory.js";

export const BUILD_TOOLS = ["miner", "belt", "storage", "smelter", "constructor", "splitter", "pole", "powerplant", "solar"];
export const TOOLS = ["hand", ...BUILD_TOOLS, "erase"];
const TOOL_TYPE = { miner: BT.MINER, belt: BT.BELT, storage: BT.STORAGE, smelter: BT.SMELTER, constructor: BT.CONSTRUCTOR, splitter: BT.SPLITTER, pole: BT.POLE, powerplant: BT.POWERPLANT, solar: BT.SOLAR };

export class Builder {
  constructor(factory) {
    this.f = factory;
    this.tool = "hand";
    this.rot = 0;
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

  rotate() {
    this.rot = (this.rot + 1) % 4;
  }

  // Можно ли здесь поставить текущей постройкой (для подсветки): {ok, reason, type, dir} или null для «руки».
  preview(x, y) {
    if (!this.active) return null;
    if (this.tool === "erase") return { ok: !!this.f.get(x, y), reason: "", type: "erase", dir: 0 };
    const type = TOOL_TYPE[this.tool];
    const r = this.f.canPlace(type, x, y);
    return { ok: r.ok, reason: r.reason, missing: r.missing, type, dir: this.rot };
  }

  begin(x, y) {
    if (!this.active) return false;
    this.stroke = { pending: { x, y }, started: false, last: { x, y }, visited: new Set([x + "," + y]) };
    return true;
  }

  move(x, y) {
    const s = this.stroke;
    if (!s) return 0;
    let changed = 0;
    if (!s.started) {
      if (x === s.last.x && y === s.last.y) return 0;
      changed += this._commitFirst();
    }
    return changed + this._walk(x, y);
  }

  end() {
    const s = this.stroke;
    if (!s) return 0;
    const n = s.started ? 0 : this._commitFirst();
    this.stroke = null;
    return n;
  }

  // Второй палец коснулся карты: начатый штрих отменяется, ничего не поставлено.
  cancel() {
    this.stroke = null;
  }

  _commitFirst() {
    const s = this.stroke;
    s.started = true;
    const { x, y } = s.pending;
    if (this.tool === "erase") return this.f.remove(x, y) ? 1 : 0;
    return this.f.place(TOOL_TYPE[this.tool], x, y, this.rot) ? 1 : 0;
  }

  _walk(tx, ty) {
    const s = this.stroke;
    let changed = 0;
    for (let guard = 0; guard < 200 && (s.last.x !== tx || s.last.y !== ty); guard++) {
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
          const prev = this.f.get(s.last.x, s.last.y);
          if (prev && prev.type === BT.BELT) this.f.place(BT.BELT, s.last.x, s.last.y, d); // предыдущая лента поворачивает к новой
          this.f.place(BT.BELT, nx, ny, d);
          changed++;
        } else if (this.tool === "erase") {
          if (this.f.remove(nx, ny)) changed++;
        } else if (this.f.place(TOOL_TYPE[this.tool], nx, ny, this.rot)) changed++;
        s.visited.add(nx + "," + ny);
        s.last = { x: nx, y: ny };
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return changed;
  }
}
