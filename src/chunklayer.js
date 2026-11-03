// Слой кусков карты: создаёт куски в поле зрения и выгружает дальние.
import { Container, Graphics } from "pixi.js";
import { CHUNK } from "./worldgen.js";
import { HW, HH, screenToTile } from "./iso.js";
import { drawChunk } from "./chunkdraw.js";

const CHUNK_PX_W = CHUNK * HW; // полуширина ромба куска
const CHUNK_PX_H = CHUNK * 2 * HH; // высота ромба куска
const LIFT = 40; // насколько деревья и скалы выступают вверх

export class ChunkLayer {
  constructor(seed) {
    this.seed = seed;
    this.container = new Container();
    this.container.sortableChildren = true;
    this.chunks = new Map();
    this.maxPerFrame = 6;
  }

  setSeed(seed) {
    this.seed = seed;
    this.clear();
  }

  clear() {
    for (const c of this.chunks.values()) c.destroy();
    this.chunks.clear();
  }

  get count() {
    return this.chunks.size;
  }

  // Прямоугольник мира, который видит камера (px), расширенный на margin.
  static viewRect(cam, vw, vh, margin) {
    const hw = vw / 2 / cam.zoom + margin;
    const hh = vh / 2 / cam.zoom + margin;
    return { l: cam.x - hw, r: cam.x + hw, t: cam.y - hh, b: cam.y + hh };
  }

  static chunkBox(cx, cy) {
    const X0 = (cx - cy) * CHUNK * HW;
    const Y0 = (cx + cy) * CHUNK * HH;
    return { l: X0 - CHUNK_PX_W, r: X0 + CHUNK_PX_W, t: Y0 - LIFT, b: Y0 + CHUNK_PX_H };
  }

  static overlaps(a, b) {
    return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  }

  update(cam, vw, vh) {
    const need = ChunkLayer.viewRect(cam, vw, vh, 40);
    const keep = ChunkLayer.viewRect(cam, vw, vh, CHUNK_PX_W * 2);
    const corners = [
      screenToTile(keep.l, keep.t), screenToTile(keep.r, keep.t),
      screenToTile(keep.l, keep.b), screenToTile(keep.r, keep.b),
    ];
    const minX = Math.floor(Math.min(...corners.map((c) => c.x)) / CHUNK) - 1;
    const maxX = Math.floor(Math.max(...corners.map((c) => c.x)) / CHUNK) + 1;
    const minY = Math.floor(Math.min(...corners.map((c) => c.y)) / CHUNK) - 1;
    const maxY = Math.floor(Math.max(...corners.map((c) => c.y)) / CHUNK) + 1;

    for (const [key, g] of this.chunks) {
      if (!ChunkLayer.overlaps(ChunkLayer.chunkBox(g.cx, g.cy), keep)) {
        g.destroy();
        this.chunks.delete(key);
      }
    }

    const wanted = [];
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (this.chunks.has(cx + "," + cy)) continue;
        if (ChunkLayer.overlaps(ChunkLayer.chunkBox(cx, cy), need)) wanted.push({ cx, cy });
      }
    }
    // Сначала ближние к центру экрана.
    const mid = screenToTile(cam.x, cam.y);
    wanted.sort((a, b) => Math.hypot(a.cx * CHUNK - mid.x, a.cy * CHUNK - mid.y) - Math.hypot(b.cx * CHUNK - mid.x, b.cy * CHUNK - mid.y));
    for (const { cx, cy } of wanted.slice(0, this.maxPerFrame)) {
      const g = new Graphics();
      g.cx = cx;
      g.cy = cy;
      drawChunk(g, cx, cy, this.seed);
      g.zIndex = cx + cy;
      this.container.addChild(g);
      this.chunks.set(cx + "," + cy, g);
    }
    return wanted.length > this.maxPerFrame; // ещё есть что дорисовать
  }
}
