import { Application, Container, Graphics } from "pixi.js";
import { createCamera, screenToWorld, zoomAt } from "./camera.js";
import { ChunkLayer } from "./chunklayer.js";
import { attachInput } from "./input.js";
import { createHud } from "./hud.js";
import { HH, HW, pickTile, tileToScreen } from "./iso.js";
import { tileAt } from "./worldgen.js";
import { PAL } from "./palette.js";
import { STR } from "./strings.js";

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || 1337;

function tileText(x, y) {
  const t = tileAt(x, y, seed);
  const parts = [`${STR.tile} (${x}, ${y})`, STR.type[t.type]];
  if (t.ore) parts.push(STR.ore[t.ore]);
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

  const cam = createCamera(0, HH, 1);
  const world = new Container();
  app.stage.addChild(world);
  const layer = new ChunkLayer(seed);
  world.addChild(layer.container);
  const mark = new Graphics();
  world.addChild(mark);

  const size = () => ({ w: app.screen.width, h: app.screen.height });
  let dirty = true;
  let more = false;
  let selected = null;
  let hover = null;

  const outline = (t, color, alpha) => {
    const p = tileToScreen(t.x, t.y);
    const lift = tileAt(t.x, t.y, seed).h;
    const y = p.y - lift;
    mark.poly([p.x, y, p.x + HW, y + HH, p.x, y + 2 * HH, p.x - HW, y + HH]).stroke({ width: 2 / cam.zoom + 1, color, alpha });
  };
  const redrawMark = () => {
    mark.clear();
    if (hover) outline(hover, 0xffffff, 0.55);
    if (selected) outline(selected, 0xffd23f, 1);
  };
  const pick = (sx, sy) => {
    const { w, h } = size();
    const wp = screenToWorld(cam, sx, sy, w, h);
    return pickTile(wp.x, wp.y);
  };

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
      location.search = "?seed=" + (1 + Math.floor(Math.random() * 999999));
    },
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
        redrawMark();
      }
    },
  });
  window.addEventListener("resize", () => (dirty = true));

  let statTimer = 0;
  app.ticker.add((tk) => {
    applyKeys(tk.deltaMS);
    if (dirty || more) {
      const { w, h } = size();
      world.scale.set(cam.zoom);
      world.position.set(w / 2 - cam.x * cam.zoom, h / 2 - cam.y * cam.zoom);
      more = layer.update(cam, w, h);
      if (dirty) redrawMark();
      dirty = false;
    }
    statTimer += tk.deltaMS;
    if (statTimer > 500) {
      statTimer = 0;
      hud.setStats(`${Math.round(app.ticker.FPS)} fps · кусков ${layer.count} · x${cam.zoom.toFixed(2)}`);
    }
  });

  window.__game = { app, cam, layer, seed }; // для отладки в консоли
}

start().catch((err) => {
  console.error(err);
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;inset:0;padding:24px;color:#fff;font:16px sans-serif";
  d.textContent = "Не удалось запустить игру: " + err.message;
  document.body.appendChild(d);
});
