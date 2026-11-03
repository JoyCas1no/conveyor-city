// Панели поверх карты (DOM): название, сведения о клетке, кнопки масштаба и смены карты.
import { STR } from "./strings.js";

export function createHud({ seed, onZoom, onHome, onNewMap }) {
  const root = document.createElement("div");
  root.id = "hud";
  root.innerHTML = `
    <div class="panel top">
      <b>${STR.title}</b> <span class="dim">${STR.stage}</span>
      <div class="dim small">${STR.seed}${seed}</div>
      <div id="tileinfo" class="info">${STR.hint}</div>
      <div id="stats" class="dim small"></div>
    </div>
    <div class="buttons">
      <button id="b-in" aria-label="${STR.zoomIn}">+</button>
      <button id="b-out" aria-label="${STR.zoomOut}">−</button>
      <button id="b-home" aria-label="${STR.home}">⌂</button>
    </div>
    <button id="b-new" class="newmap">${STR.newMap}</button>`;
  document.body.appendChild(root);
  const q = (id) => root.querySelector(id);
  q("#b-in").onclick = () => onZoom(1.3);
  q("#b-out").onclick = () => onZoom(1 / 1.3);
  q("#b-home").onclick = () => onHome();
  q("#b-new").onclick = () => onNewMap();
  return {
    setTile(text) {
      q("#tileinfo").textContent = text;
    },
    setStats(text) {
      q("#stats").textContent = text;
    },
  };
}
