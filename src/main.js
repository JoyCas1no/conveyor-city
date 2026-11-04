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
import { UNLOCK_AT } from "./contracts.js";
import { isUpgradable } from "./upgrades.js";
import { drawGhost, drawRing, drawTileOutline } from "./buildingdraw.js";
import { readLastSeed, writeLastSeed, sanitizeCam } from "./save.js";
import { MapStore, createMirror, openIdbBackend, exportFile, parseImport } from "./storage.js";
import { buildVersion, registerSw, applyUpdate, offlineReady, persistStatus, saveFile } from "./pwa.js";
import { PAL } from "./palette.js";
import { STR, missingText, costText } from "./strings.js";

const MAX_IMPORT = 5_000_000; // байт
const params = new URLSearchParams(location.search);
const seedParam = Number(params.get("seed"));
// Номер карты и завод появляются в начале start(): сначала нужно прочитать хранилище.
let seed = 0;
let factory = null;

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // доступ к localStorage запрещён
  }
}

// Какую карту открыть: из адреса (?seed=), иначе последнюю, иначе самую свежую из сохранённых, иначе 1337.
async function pickSeed(store) {
  if (Number.isInteger(seedParam) && seedParam > 0) return seedParam;
  const last = readLastSeed();
  if (last) return last;
  const maps = await store.list();
  return maps.length ? maps[0].seed : 1337;
}

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

// Вкладки палитры.
const TAB = {
  miner: "mining", sawmill: "mining", pump: "mining",
  belt: "factory", storage: "factory", splitter: "factory", smelter: "factory", constructor: "factory",
  pole: "power", powerplant: "power", solar: "power",
  house: "city", shop: "city", park: "city",
};
const TABS = ["mining", "factory", "power", "city"].map((id) => ({ id, name: STR.tabs[id] }));

// Текст состояния здания: у бура, лесопилки и насоса «стоит» говорит о причине по-своему.
function statusText(b, st) {
  if (st === "blocked" && (b.type === BT.MINER || b.type === BT.SAWMILL || b.type === BT.PUMP)) return STR.minerBlocked;
  if (st === "idle" && STR.resIdle[b.type]) return STR.resIdle[b.type];
  return STR.status[st];
}

function lockText(tool) {
  const info = factory.lockInfo(tool);
  return `${STR.lockedBy} «${info.title}»`;
}

function buildingText(b) {
  let s = STR.building[b.type] + (isUpgradable(b.type) ? ` Mk${b.lvl}` : "");
  if (b.type === BT.POLE) return `${s} · ${STR.pole.connects}: ${poleTargets(b.x, b.y).length}`;
  if (b.type === BT.POWERPLANT) return `${s} · ${STR.status.unplugged && !b.pw ? STR.status.unplugged : STR.plantStatus[factory.status(b)]} · ${STR.coal} ${b.coal}/4`;
  if (b.type === BT.SOLAR) return `${s} · ${b.pw ? STR.status.work : STR.status.unplugged}`;
  if (b.type === BT.STORAGE || b.type === BT.SPLITTER) return s;
  if (b.type === BT.HOUSE) return `${s} · ${STR.cityWindow.pop.toLowerCase()} ${b.pop}/4 · ${STR.status[factory.status(b)]}`;
  if (b.type === BT.SHOP || b.type === BT.PARK) return `${s} · ${STR.cityStatus[factory.status(b)]}`;
  if (b.type === BT.CONSTRUCTOR) s += ` (${STR.recipes[b.recipe].name})`;
  s += `, ${STR.dirs[b.dir]}`;
  const st = factory.status(b);
  s += ` · ${statusText(b, st)}`;
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
  const store = new MapStore(await openIdbBackend(typeof indexedDB !== "undefined" ? indexedDB : null), createMirror(safeStorage()));
  await store.migrate(); // прежние сохранения (localStorage) подхватываются один раз
  seed = await pickSeed(store);
  writeLastSeed(seed);
  factory = new Factory(seed);
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

  const save = await store.load(seed);
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
  const fxLayer = new Container(); // всплывающие значки (улучшение)
  world.addChild(fxLayer);
  const fx = [];
  function spawnFx(x, y) {
    const g = new Graphics();
    const c = tileToScreen(x + 0.5, y + 0.5);
    g.poly([0, -16, 9, -4, 3.5, -4, 3.5, 6, -3.5, 6, -3.5, -4, -9, -4]).fill(0xffd23f).stroke({ width: 1.4, color: 0x8a5a00 });
    g.position.set(c.x, c.y - 34);
    fxLayer.addChild(g);
    fx.push({ g, age: 0 });
  }

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
  let autosave = true; // выключается перед переходом на другую карту или загрузкой файла, чтобы старое состояние не затёрло новое
  let lastSaved = 0;
  const payload = () => ({ ...factory.toJSON(), cam: { x: cam.x, y: cam.y, zoom: cam.zoom }, ts: Date.now(), pop: factory.city.pop });
  const saveNow = async () => {
    if (!autosave) return false;
    const ok = await store.save(seed, payload());
    if (ok) lastSaved = Date.now();
    return ok;
  };
  // Закрывающейся вкладке успеть можно только синхронно: зеркало localStorage сразу, IndexedDB как получится.
  const saveQuick = () => {
    if (!autosave) return;
    const p = payload();
    store.saveSync(seed, p);
    store.save(seed, p);
  };
  setInterval(saveNow, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveQuick();
  });
  window.addEventListener("pagehide", saveQuick);

  // ---- панель ----
  const hud = createHud({
    seed,
    palette: BUILD_TOOLS.map((t) => ({ tool: t, name: STR.tools[t], cost: costText(COSTS[t]), tab: TAB[t] })),
    tabs: TABS,
    onDeliver: (id) => {
      const c = factory.contracts().find((q) => q.id === id);
      if (c && factory.deliver(id)) {
        hud.toast(`${STR.contractDone}: +${c.coins} ${STR.coin}`);
        refreshCity();
      }
    },
    onUpgrade: () => doUpgrade(),
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
    onNewMap: async () => {
      if (factory.count > 0 && !window.confirm(STR.newMapConfirm)) return;
      await saveNow();
      autosave = false;
      location.search = "?seed=" + (1 + Math.floor(Math.random() * 999999));
    },
    onMenuOpen: () => refreshMenu(),
    onOpenMap: async (n) => {
      await saveNow();
      autosave = false;
      location.search = "?seed=" + n;
    },
    onDeleteMap: async (n) => {
      if (n === seed || !window.confirm(STR.menu.deleteConfirm(n))) return; // текущую карту удалить нельзя
      await store.remove(n);
      refreshMenu();
    },
    onExport: async () => {
      const file = exportFile(payload(), buildVersion());
      const how = await saveFile(file.name, file.text);
      if (how !== "cancel") hud.toast(how === "share" ? STR.menu.shared : STR.menu.exported);
    },
    onImport: async (file) => {
      if (file.size > MAX_IMPORT) return hud.toast(STR.menu.importError.size, true);
      const r = parseImport(await file.text());
      if (!r.ok) return hud.toast(STR.menu.importError[r.error] || STR.menu.importError.map, true);
      const n = r.payload.seed;
      if ((await store.load(n)) && !window.confirm(STR.menu.importConfirm(n))) return;
      await saveNow(); // текущая карта цела; затем загруженная кладётся как свежая и открывается
      autosave = false;
      await store.save(n, { ...r.payload, ts: Date.now() });
      hud.toast(STR.menu.imported);
      location.search = "?seed=" + n;
    },
    onUpdate: () => {
      if (updateWaiting)
        applyUpdate(updateWaiting, async () => {
          await saveNow();
          autosave = false;
        });
    },
    onTool: (t) => setTool(builder.tool === t && t !== "hand" ? "hand" : t),
    onRotate: () => rotate(),
  });

  // ---- меню и офлайн-режим ----
  let swReg = null;
  let updateWaiting = null;
  let persistent = false;
  persistStatus().then((p) => (persistent = p));
  async function refreshMenu() {
    hud.setMenu({
      maps: await store.list(),
      current: seed,
      saved: lastSaved,
      version: buildVersion(),
      offline: await offlineReady(swReg),
      persistent,
      storageOk: store.works,
      updateReady: !!updateWaiting,
    });
  }
  registerSw({
    onWaiting: (w) => {
      updateWaiting = w;
      hud.setMenuBadge(true);
      hud.toast(STR.menu.updateToast);
    },
  }).then((r) => (swReg = r));

  // Панель здания: в режиме руки у станка рецепты, у любого улучшаемого здания улучшение Mk1-Mk3.
  let panelSig = "";
  function showRecipePanel(force = true) {
    const b = selected && factory.get(selected.x, selected.y);
    if (!b || builder.active || (b.type !== BT.CONSTRUCTOR && !isUpgradable(b.type))) {
      panelSig = "";
      return hud.hideRecipes();
    }
    const recipes = b.type === BT.CONSTRUCTOR ? RECIPE_ORDER.map((id) => ({ id, name: STR.recipes[id].name, desc: STR.recipes[id].desc })) : null;
    let upgrade = null;
    if (isUpgradable(b.type)) {
      const c = factory.canUpgrade(b.x, b.y);
      upgrade = { now: `${STR.building[b.type]} Mk${b.lvl}` };
      if (c.reason === "max") upgrade.maxed = true;
      else {
        upgrade.level = c.level;
        upgrade.effect = STR.upgrade.effect[b.type][c.level];
        upgrade.cost = costText(c.cost);
        upgrade.ok = c.ok;
        upgrade.why = c.reason === "cost" ? missingText(c.missing) : c.reason === "locked" ? `${STR.upgrade.reason.locked} «${c.lock.title}»` : "";
      }
    }
    const sig = JSON.stringify([b.x, b.y, b.lvl, b.recipe, upgrade]);
    if (!force && sig === panelSig) return; // ничего не изменилось: не перерисовываем кнопки
    panelSig = sig;
    hud.showBuilding({ recipes, current: b.recipe, upgrade });
  }

  function doUpgrade() {
    if (!selected || builder.active) return;
    if (factory.upgrade(selected.x, selected.y)) {
      const b = factory.get(selected.x, selected.y);
      hud.toast(`${STR.upgrade.done} Mk${b.lvl}`);
      spawnFx(selected.x, selected.y);
      hud.setTile(tileText(selected.x, selected.y));
      showRecipePanel();
    }
  }

  // Окно «Город»: данные города и открытых контрактов.
  function refreshCity() {
    hud.setCity({ ...factory.city, coins: factory.coins }, factory.contracts().map((c) => ({ ...c, unlock: UNLOCK_AT[c.id] })));
  }

  function setTool(t) {
    builder.setTool(t);
    hud.hideRecipes();
    ghost = null;
    hud.setTool(builder.tool);
    hud.setTile(STR.toolHint[builder.tool]);
    redrawMark();
  }
  function rotate(step = 1) {
    if (builder.active) {
      builder.rotate(step);
      hud.setRot(builder.rot);
    } else if (selected) {
      const b = factory.get(selected.x, selected.y);
      if (b && !FIXED.has(b.type)) {
        factory.rotateAt(b.x, b.y, (b.dir + step + 4) % 4);
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
    else if (e.code === "KeyR") rotate(e.shiftKey ? -1 : 1);
    else if (e.code === "KeyU") doUpgrade();
    else if (e.code === "Escape") setTool("hand");
  });

  const applyKeys = attachInput(app.canvas, cam, {
    size,
    onChange: () => (dirty = true),
    onRightTap: (sx, sy) => {
      // правая кнопка: повернуть то, что строим, или здание под курсором
      if (!builder.active) {
        selected = pick(sx, sy);
        showRecipePanel();
      }
      rotate();
    },
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
        if (n === 0 && p && !p.ok && p.reason) hud.toast(p.reason === "cost" ? missingText(p.missing) : p.reason === "locked" ? lockText(builder.tool) : STR.reason[p.reason], true);
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
  let menuTick = 0;
  app.ticker.add((tk) => {
    applyKeys(tk.deltaMS);
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      e.age += tk.deltaMS / 1000;
      e.g.y -= (40 * tk.deltaMS) / 1000;
      e.g.alpha = Math.max(0, 1 - e.age / 1.1);
      if (e.age >= 1.1) {
        e.g.destroy();
        fx.splice(i, 1);
      }
    }
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
    for (const e of factory.takeEvents()) if (e.why !== "tax") hud.coinPop(e.delta); // налог мелкими монетами не всплывает

    statTimer += tk.deltaMS;
    if (statTimer > 300) {
      statTimer = 0;
      const items = STR.itemOrder.filter((k) => factory.stock[k] > 0);
      const num = (n) => (n >= 10000 ? (n / 1000).toFixed(1).replace(".", ",") + "к" : n); // 12345 -> 12,3к
      hud.setStock(items.length ? `${STR.stock}: ` + items.map((k) => `${STR.item[k]} ${num(factory.stock[k])}`).join(" · ") : factory.count === 0 ? STR.stockEmpty : "");
      const g = factory.grid;
      hud.setPower(factory.hasPower() ? `${STR.powerLabel}: ${Math.round(g.demand)} / ${g.supply} ${STR.units}` : "", g.demand > g.supply);
      for (const t of BUILD_TOOLS) {
        const m = factory.missing(t);
        hud.setLacking(t, factory.isLocked(t) ? lockText(t) : Object.keys(m).length ? missingText(m) : "");
      }
      hud.setCoins(factory.coins, factory.city.pop);
      if (hud.isCityOpen()) refreshCity();
      if (hud.isMenuOpen() && ++menuTick % 7 === 0) refreshMenu(); // раз в ~2 с, пока меню открыто
      if (hud.isInspectOpen()) showRecipePanel(false); // цена и наличие меняются: обновляем кнопку, только если что-то изменилось
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
