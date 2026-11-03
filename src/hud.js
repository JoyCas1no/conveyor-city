// Панели поверх карты (DOM): сведения, склад, масштаб, панель построек.
import { STR } from "./strings.js";

const ICONS = { hand: "✋", miner: "⛏", belt: "➡", storage: "📦", erase: "🗑" };
const ARROWS = ["↘", "↙", "↖", "↗"]; // как направления 0..3 выглядят на экране

export function createHud({ seed, onZoom, onHome, onNewMap, onTool, onRotate }) {
  const root = document.createElement("div");
  root.id = "hud";
  const toolButtons = ["hand", "miner", "belt", "storage", "erase"]
    .map((t) => `<button class="tool" data-tool="${t}" aria-label="${STR.tools[t]}"><span class="ico">${ICONS[t]}</span><span class="lbl">${STR.tools[t]}</span></button>`)
    .join("");
  root.innerHTML = `
    <div class="panel top">
      <b>${STR.title}</b> <span class="dim">${STR.stage}</span>
      <div class="dim small">${STR.seed}${seed} · <button id="b-new" class="link">${STR.newMap}</button></div>
      <div id="tileinfo" class="info">${STR.hintHand}</div>
      <div id="stock" class="stock"></div>
      <div id="stats" class="dim small"></div>
    </div>
    <div class="zoom">
      <button id="b-in" aria-label="${STR.zoomIn}">+</button>
      <button id="b-out" aria-label="${STR.zoomOut}">−</button>
      <button id="b-home" aria-label="${STR.home}">⌂</button>
    </div>
    <div id="toast" class="toast"></div>
    <div class="bar">${toolButtons}<button id="b-rot" class="tool rot" aria-label="${STR.tools.rotate}"><span class="ico" id="rot-ico">↘</span><span class="lbl">${STR.tools.rotate}</span></button></div>`;
  document.body.appendChild(root);
  const q = (id) => root.querySelector(id);
  q("#b-in").onclick = () => onZoom(1.3);
  q("#b-out").onclick = () => onZoom(1 / 1.3);
  q("#b-home").onclick = () => onHome();
  q("#b-new").onclick = () => onNewMap();
  q("#b-rot").onclick = () => onRotate();
  for (const btn of root.querySelectorAll("button.tool[data-tool]")) btn.onclick = () => onTool(btn.dataset.tool);

  let toastTimer = 0;
  return {
    setTile(text) {
      q("#tileinfo").textContent = text;
    },
    setStats(text) {
      q("#stats").textContent = text;
    },
    setStock(text) {
      q("#stock").textContent = text;
    },
    setTool(tool) {
      for (const btn of root.querySelectorAll("button.tool[data-tool]")) btn.classList.toggle("on", btn.dataset.tool === tool);
    },
    setRot(dir) {
      q("#rot-ico").textContent = ARROWS[dir];
    },
    toast(text, bad = false) {
      const el = q("#toast");
      el.textContent = text;
      el.classList.toggle("bad", bad);
      el.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
    },
  };
}
