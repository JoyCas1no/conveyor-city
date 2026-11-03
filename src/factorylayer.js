// Слой построек: ленты по кускам карты (перерисовка только изменённого куска), высокие здания по одному,
// предметы на лентах одним Graphics каждый кадр. Порядок: ленты, предметы, высокие здания.
import { Container, Graphics } from "pixi.js";
import { CHUNK } from "./worldgen.js";
import { tileToScreen } from "./iso.js";
import { BT, DIRS, BELT_SPEED, TICK, itemPosition, powerLinks } from "./factory.js";
import { drawBelt, drawTall, drawItem, drawLinks } from "./buildingdraw.js";
import { ChunkLayer } from "./chunklayer.js";

const chunkOf = (v) => Math.floor(v / CHUNK);

export class FactoryLayer {
  constructor(factory) {
    this.f = factory;
    this.beltsC = new Container();
    this.items = new Graphics();
    this.tall = new Container();
    this.tall.sortableChildren = true;
    this.beltChunks = new Map(); // "cx,cy" -> Graphics
    this.talls = new Map(); // "x,y" -> {g, blocked}
    this.links = new Graphics(); // линии энергосети поверх всего
    this.linksRev = -1;
    this.container = new Container();
    this.container.addChild(this.beltsC, this.items, this.tall, this.links);
  }

  // Клетки, из которых в эту ленту что-то подаётся (для формы поворота).
  _inputs(b) {
    const ins = [];
    for (let i = 0; i < 4; i++) {
      if (i === b.dir) continue;
      const n = this.f.get(b.x + DIRS[i][0], b.y + DIRS[i][1]);
      if (!n || (n.type !== BT.BELT && n.type !== BT.MINER)) continue;
      if (n.x + DIRS[n.dir][0] === b.x && n.y + DIRS[n.dir][1] === b.y) ins.push(i);
    }
    return ins;
  }

  _redrawBeltChunk(cx, cy) {
    const k = cx + "," + cy;
    let g = this.beltChunks.get(k);
    let any = false;
    const list = [];
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const b = this.f.get(cx * CHUNK + i, cy * CHUNK + j);
        if (b && b.type === BT.BELT) list.push(b);
      }
    }
    list.sort((a, b) => a.x + a.y - (b.x + b.y));
    any = list.length > 0;
    if (!any) {
      if (g) {
        g.destroy();
        this.beltChunks.delete(k);
      }
      return;
    }
    if (!g) {
      g = new Graphics();
      g.cx = cx;
      g.cy = cy;
      this.beltChunks.set(k, g);
      this.beltsC.addChild(g);
    }
    g.clear();
    for (const b of list) drawBelt(g, b, this._inputs(b));
  }

  _syncTall(x, y) {
    const k = x + "," + y;
    const old = this.talls.get(k);
    const b = this.f.get(x, y);
    const wanted = b && b.type !== BT.BELT;
    if (old && (!wanted || old.type !== b.type)) {
      old.g.destroy();
      this.talls.delete(k);
    }
    if (!wanted) return;
    let e = this.talls.get(k);
    if (!e) {
      const g = new Graphics();
      g.zIndex = x + y;
      this.tall.addChild(g);
      e = { g, type: b.type, state: null };
      this.talls.set(k, e);
    }
    this._drawTall(e, b);
  }

  // Картинка высокого здания зависит от состояния (лампочка, свечение): перерисовываем, когда оно сменилось.
  _stateOf(b) {
    const st = this.f.status(b);
    const lv = "|" + (b.lvl || 1);
    if (b.type === BT.CONSTRUCTOR) return st + "|" + b.recipe + lv;
    if (b.type === BT.HOUSE) return st + "|" + b.pop + lv;
    return st + lv;
  }

  _drawTall(e, b) {
    e.g.clear();
    drawTall(e.g, b, this.f.status(b));
    e.state = this._stateOf(b);
  }

  // Применяет изменения построек к картинке (вызывать каждый кадр до отрисовки).
  sync() {
    const d = this.f.dirty;
    if (d.size) {
      const chunks = new Set();
      for (const k of d) {
        const [x, y] = k.split(",").map(Number);
        this._syncTall(x, y);
        for (const [dx, dy] of [[0, 0], ...DIRS]) chunks.add(chunkOf(x + dx) + "," + chunkOf(y + dy));
      }
      d.clear();
      for (const ck of chunks) {
        const [cx, cy] = ck.split(",").map(Number);
        this._redrawBeltChunk(cx, cy);
      }
    }
    for (const [k, e] of this.talls) {
      if (e.type === BT.STORAGE || e.type === BT.SPLITTER || e.type === BT.POLE) continue;
      const [x, y] = k.split(",").map(Number);
      const b = this.f.get(x, y);
      if (b && this._stateOf(b) !== e.state) this._drawTall(e, b);
    }
  }

  // alpha: доля текущего шага симуляции (0..1) для плавного движения предметов между шагами.
  render(cam, vw, vh, alpha) {
    this.sync();
    if (this.f.rev !== this.linksRev) {
      this.links.clear();
      drawLinks(this.links, powerLinks(this.f));
      this.linksRev = this.f.rev;
    }
    const rect = ChunkLayer.viewRect(cam, vw, vh, 60);
    for (const g of this.beltChunks.values()) g.visible = ChunkLayer.overlaps(ChunkLayer.chunkBox(g.cx, g.cy), rect);
    const g = this.items;
    g.clear();
    for (const b of this.f.map.values()) {
      if (b.type !== BT.BELT || !b.item) continue;
      const it = b.item;
      const p = Math.min(1, it.p + (it.moving ? BELT_SPEED * TICK * alpha : 0));
      const pos = itemPosition(b, it.from, p);
      const s = tileToScreen(pos.x, pos.y);
      if (s.x < rect.l || s.x > rect.r || s.y < rect.t || s.y > rect.b) continue;
      drawItem(g, s.x, s.y, it.t);
    }
  }

  clear() {
    for (const g of this.beltChunks.values()) g.destroy();
    for (const e of this.talls.values()) e.g.destroy();
    this.beltChunks.clear();
    this.talls.clear();
    this.items.clear();
    this.links.clear();
    this.linksRev = -1;
  }
}
