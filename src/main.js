import { Application, Container, Graphics } from "pixi.js";
import { createCamera, screenToWorld, zoomAt } from "./camera.js";
import { ChunkLayer } from "./chunklayer.js";
import { FactoryLayer } from "./factorylayer.js";
import { attachInput } from "./input.js";
import { createHud } from "./hud.js";
import { HH, HW, pickTileRaised, tileToScreen } from "./iso.js";
import { tileAt } from "./worldgen.js";
import { Factory, BT, TICK, COSTS, FUEL_CAP, RECIPE_ORDER, FIXED, POLE_RADIUS, inPoleRange } from "./factory.js";
import { Builder, BUILD_TOOLS } from "./builder.js";
import { drawGhost, drawRing, drawTileOutline } from "./buildingdraw.js";
import { readSave, writeSave, readLastSeed, writeLastSeed, sanitizeCam } from "./save.js";
import { PAL } from "./palette.js";
import { STR, missingText, costText } from "./strings.js";

const params = new URLSearchParams(location.search);
const seedParam = Number(params.get("seed"));
const seed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : readLastSeed() || 1337;
writeLastSeed(seed);

const factory = new Factory(seed);

// Сколько зданий подключит столб в (x, y): по тем же правилам, что и в симуляции.
function poleTargets(x, y) {
  const out = [];
  for (let dy = -POLE_RADIUS; dy <= POLE_RADIUS; dy++) {
    for (let dx = -POLE_RADIUS; dx <= POLE_RADIUS; dx++) {
      if (!inPoleRange(dx, dy)) continue;
      const t = factory.get(x + dx, y + dy);
      if (t && t.pw !== undefined) out.push(t);
    }
  }
  return out;
}

function buildingText(b) {
  let s = STR.building[b.type];
  if (b.type === BT.POLE) return `${s} · ${STR.pole.connects}: ${poleTargets(b.x, b.y).length}`;
  if (b.type === BT.POWERPLANT) return `${s} · ${STR.status.unplugged && !b.pw ? STR.status.unplugged : STR.plantStatus[factory.status(b)]} · ${STR.coal} ${b.coal}/4`;
  if (b.type === BT.SOLAR) return `${s} · ${b.pw ? STR.status.work : STR.status.unplugged}`;
  if (b.type === BT.STORAGE || b.type === BT.SPLITTER) return s;
  if (b.type === BT.CONSTRUCTOR) s += ` (${STR.recipes[b.recipe].name})`;
  s += `, ${STR.dirs[b.dir]}`;
  const st = factory.status(b);
  s += ` · ${b.type === BT.MINER && st === "blocked" ? STR.minerBlocked : STR.status[st]}`;
  if (b.type === BT.SMELTER) s += ` · ${STR.fuel} ${b.fuel}/${FUEL_CAP}` + (b.pw ? "" : ` · ${STR.smelterOff}`);
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
        } else drawGhost(mark, ghost.x, ghost.y, p.ok, p.dir, !FIXED.has(p.type));
      }
    } else if (hover) outline(hover, 0xffffff, 0.55);
    // Круг столба и подсветка зданий, которые он подключит (при выборе столба и при касании поставленного столба).
    const poleAt = builder.tool === "pole" && ghost ? ghost : selected && factory.get(selected.x, selected.y)?.type === BT.POLE && !builder.active ? selected : null;
    if (poleAt) {
      drawRing(mark, poleAt.x, poleAt.y, POLE_RADIUS);
      for (const t of poleTargets(poleAt.x, poleAt.y)) drawTileOutline(mark, t.x, t.y, 0x6fdc6f);
    }
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
    palette: BUILD_TOOLS.map((t) => ({ tool: t, name: STR.tools[t], cost: costText(COSTS[t]) })),
    onRecipe: (id) => {
      if (selected && factory.setRecipe(selected.x, selected.y, id)) {
        hud.setTile(tileText(selected.x, selected.y));
        showRecipePanel();
      }
    },
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

  // Панель рецептов показывается, когда в режиме руки выбран станок.
  function showRecipePanel() {
    const b = selected && factory.get(selected.x, selected.y);
    if (b && b.type === BT.CONSTRUCTOR && !builder.active) {
      hud.showRecipes(RECIPE_ORDER.map((id) => ({ id, name: STR.recipes[id].name, desc: STR.recipes[id].desc })), b.recipe);
    } else hud.hideRecipes();
  }

  function setTool(t) {
    builder.setTool(t);
    hud.hideRecipes();
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
      if (b && !FIXED.has(b.type)) {
        factory.rotateAt(b.x, b.y, (b.dir + 1) % 4);
        hud.setTile(tileText(selected.x, selected.y));
      }
    }
    redrawMark();
  }
  hud.setTool("hand");

  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { Digit1: "miner", Digit2: "belt", Digit3: "storage", Digit4: "erase", Digit5: "smelter", Digit6: "constructor", Digit7: "splitter", Digit8: "pole", Digit9: "powerplant", Digit0: "solar", KeyX: "erase" };
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
      showRecipePanel();
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
        if (n === 0 && p && !p.ok && p.reason) hud.toast(p.reason === "cost" ? missingText(p.missing) : STR.reason[p.reason], true);
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
  app.canvas.addEventListener("pointerdown", () => hud.closePalette());
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
      const items = STR.itemOrder.filter((k) => factory.stock[k] > 0);
      hud.setStock(items.length ? `${STR.stock}: ` + items.map((k) => `${STR.item[k]} ${factory.stock[k]}`).join(" · ") : factory.count === 0 ? STR.stockEmpty : "");
      const g = factory.grid;
      hud.setPower(factory.hasPower() ? `${STR.powerLabel}: ${Math.round(g.demand)} / ${g.supply} ${STR.units}` : "", g.demand > g.supply);
      for (const t of BUILD_TOOLS) {
        const m = factory.missing(t);
        hud.setLacking(t, Object.keys(m).length ? missingText(m) : "");
      }
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
