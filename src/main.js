import { Application, Container, Graphics } from "pixi.js";
import { createCamera, screenToWorld, zoomAt } from "./camera.js";
import { ChunkLayer } from "./chunklayer.js";
import { FactoryLayer } from "./factorylayer.js";
import { attachInput } from "./input.js";
import { createHud } from "./hud.js";
import { HH, HW, pickTileRaised, tileToScreen } from "./iso.js";
import { tileAt } from "./worldgen.js";
import { Factory, BT, TICK } from "./factory.js";
import { Builder } from "./builder.js";
import { drawGhost } from "./buildingdraw.js";
import { readSave, writeSave, readLastSeed, writeLastSeed, sanitizeCam } from "./save.js";
import { PAL } from "./palette.js";
import { STR } from "./strings.js";

const params = new URLSearchParams(location.search);
const seedParam = Number(params.get("seed"));
const seed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : readLastSeed() || 1337;
writeLastSeed(seed);

const factory = new Factory(seed);

function buildingText(b) {
  let s = `${STR.building[b.type]}`;
  if (b.type === BT.STORAGE) return s;
  s += `, ${STR.dirs[b.dir]}`;
  if (b.type === BT.MINER) s += ` · ${!b.ore ? STR.minerIdle : b.blocked ? STR.minerBlocked : STR.minerWork}`;
  return s;
}

function tileText(x, y) {
  const t = tileAt(x, y, seed);
  const parts = [`${STR.tile} (${x}, ${y})`, STR.type[t.type]];
  if (t.ore) parts.push(STR.ore[t.ore]);
  const b = factory.get(x, y);
  if (b) parts.push(buildingText(b));
  return parts.join(" · ");
}

async function start() {
  const app = new Application();
  await app.init({
    preference: "webgl",
    resizeTo: window,
    background: PAL.sky,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.getElementById("game").appendChild(app.canvas);

  const save = readSave(seed);
  const loaded = save ? factory.loadJSON(save) : -1;
  const startCam = (loaded >= 0 && sanitizeCam(save.cam)) || { x: 0, y: HH, zoom: 1 };
  const cam = createCamera(startCam.x, startCam.y, startCam.zoom);

  const world = new Container();
  app.stage.addChild(world);
  const chunks = new ChunkLayer(seed);
  world.addChild(chunks.container);
  const fl = new FactoryLayer(factory);
  world.addChild(fl.container);
  const mark = new Graphics();
  world.addChild(mark);

  const builder = new Builder(factory);
  const size = () => ({ w: app.screen.width, h: app.screen.height });
  let dirty = true;
  let more = false;
  let selected = null;
  let hover = null;
  let ghost = null;

  const heightAt = (x, y) => tileAt(x, y, seed).h;
  const pick = (sx, sy) => {
    const { w, h } = size();
    const wp = screenToWorld(cam, sx, sy, w, h);
    return pickTileRaised(wp.x, wp.y, heightAt);
  };

  const outline = (t, color, alpha) => {
    const p = tileToScreen(t.x, t.y);
    const y = p.y - heightAt(t.x, t.y);
    mark.poly([p.x, y, p.x + HW, y + HH, p.x, y + 2 * HH, p.x - HW, y + HH]).stroke({ width: 2 / cam.zoom + 1, color, alpha });
  };
  const redrawMark = () => {
    mark.clear();
    if (builder.active) {
      if (ghost) {
        const p = builder.preview(ghost.x, ghost.y);
        if (p.type === "erase") {
          if (p.ok) drawGhost(mark, ghost.x, ghost.y, false, 0, false);
        } else drawGhost(mark, ghost.x, ghost.y, p.ok, p.dir, p.type !== BT.STORAGE);
      }
    } else if (hover) outline(hover, 0xffffff, 0.55);
    if (selected) outline(selected, 0xffd23f, 1);
  };

  // ---- сохранение ----
  const saveNow = () => writeSave(seed, { ...factory.toJSON(), cam: { x: cam.x, y: cam.y, zoom: cam.zoom } });
  setInterval(saveNow, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });
  window.addEventListener("pagehide", saveNow);

  // ---- панель ----
  const hud = createHud({
    seed,
    onZoom: (f) => {
      const { w, h } = size();
      zoomAt(cam, f, w / 2, h / 2, w, h);
      dirty = true;
    },
    onHome: () => {
      cam.x = 0;
      cam.y = HH;
      cam.zoom = 1;
      dirty = true;
    },
    onNewMap: () => {
      if (factory.count > 0 && !window.confirm(STR.newMapConfirm)) return;
      saveNow();
      location.search = "?seed=" + (1 + Math.floor(Math.random() * 999999));
    },
    onTool: (t) => setTool(builder.tool === t && t !== "hand" ? "hand" : t),
    onRotate: () => rotate(),
  });

  function setTool(t) {
    builder.setTool(t);
    ghost = null;
    hud.setTool(builder.tool);
    hud.setTile(STR.toolHint[builder.tool]);
    redrawMark();
  }
  function rotate() {
    if (builder.active) {
      builder.rotate();
      hud.setRot(builder.rot);
    } else if (selected) {
      const b = factory.get(selected.x, selected.y);
      if (b && b.type !== BT.STORAGE) {
        factory.rotateAt(b.x, b.y, (b.dir + 1) % 4);
        hud.setTile(tileText(selected.x, selected.y));
      }
    }
    redrawMark();
  }
  hud.setTool("hand");

  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { Digit1: "miner", Digit2: "belt", Digit3: "storage", Digit4: "erase" };
    if (map[e.code]) setTool(builder.tool === map[e.code] ? "hand" : map[e.code]);
    else if (e.code === "KeyR") rotate();
    else if (e.code === "Escape") setTool("hand");
  });

  const applyKeys = attachInput(app.canvas, cam, {
    size,
    onChange: () => (dirty = true),
    onTap: (sx, sy) => {
      selected = pick(sx, sy);
      hud.setTile(tileText(selected.x, selected.y));
      redrawMark();
    },
    onHover: (sx, sy) => {
      const t = pick(sx, sy);
      if (!hover || hover.x !== t.x || hover.y !== t.y) {
        hover = t;
        if (builder.active) ghost = t;
        redrawMark();
      }
    },
    build: {
      active: () => builder.active,
      down: (sx, sy) => {
        const t = pick(sx, sy);
        ghost = t;
        builder.begin(t.x, t.y);
        redrawMark();
      },
      move: (sx, sy) => {
        const t = pick(sx, sy);
        ghost = t;
        builder.move(t.x, t.y);
        redrawMark();
      },
      up: (sx, sy) => {
        if (sx !== undefined) {
          const t = pick(sx, sy);
          ghost = t;
          builder.move(t.x, t.y);
        }
        const target = ghost;
        const p = target && builder.preview(target.x, target.y);
        const n = builder.end();
        if (n === 0 && p && !p.ok && p.reason) hud.toast(STR.reason[p.reason], true);
        ghost = null;
        redrawMark();
      },
      cancel: () => {
        builder.cancel();
        ghost = null;
        redrawMark();
      },
    },
  });
  window.addEventListener("resize", () => (dirty = true));

  // ---- главный цикл: симуляция по шагам TICK, отрисовка каждый кадр ----
  let acc = 0;
  let statTimer = 0;
  app.ticker.add((tk) => {
    applyKeys(tk.deltaMS);
    acc += Math.min(tk.deltaMS / 1000, 0.25);
    let steps = 0;
    while (acc >= TICK && steps < 8) {
      factory.tick();
      acc -= TICK;
      steps++;
    }
    if (steps === 8) acc = 0; // отстали сильно: не копим долг

    const { w, h } = size();
    if (dirty || more) {
      world.scale.set(cam.zoom);
      world.position.set(w / 2 - cam.x * cam.zoom, h / 2 - cam.y * cam.zoom);
      more = chunks.update(cam, w, h);
      if (dirty) redrawMark();
      dirty = false;
    }
    fl.render(cam, w, h, acc / TICK);

    statTimer += tk.deltaMS;
    if (statTimer > 300) {
      statTimer = 0;
      const items = Object.entries(factory.stock).filter(([, v]) => v > 0);
      hud.setStock(items.length ? `${STR.stock}: ` + items.map(([k, v]) => `${STR.item[k]} ${v}`).join(" · ") : factory.count === 0 ? STR.stockEmpty : "");
      hud.setStats(`${Math.round(app.ticker.FPS)} fps · кусков ${chunks.count} · построек ${factory.count} · x${cam.zoom.toFixed(2)}`);
      if (selected && !builder.active) hud.setTile(tileText(selected.x, selected.y));
    }
  });

  if (loaded > 0) hud.toast(`${STR.saved}: ${loaded}`);
  window.__game = { app, cam, layer: chunks, factory, builder, fl, seed, saveNow }; // для отладки в консоли
}

start().catch((err) => {
  console.error(err);
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;inset:0;padding:24px;color:#fff;font:16px sans-serif";
  d.textContent = "Не удалось запустить игру: " + err.message;
  document.body.appendChild(d);
});
