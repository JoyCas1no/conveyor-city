// Панели поверх карты (DOM): сведения, склад, масштаб, нижняя панель, палитра построек, выбор рецепта станка.
import { STR } from "./strings.js";

export const ICONS = { hand: "✋", build: "🏗", miner: "⛏", belt: "➡", storage: "📦", smelter: "🔥", constructor: "⚙", splitter: "🔀", pole: "🔌", powerplant: "🏭", solar: "☀️", erase: "🗑" };
const ARROWS = ["↘", "↙", "↖", "↗"]; // как направления 0..3 выглядят на экране

// palette: [{tool, name, cost}] в порядке показа. onRecipe(id) вызывается при выборе рецепта станка.
export function createHud({ seed, palette, onZoom, onHome, onNewMap, onTool, onRotate, onRecipe }) {
  const root = document.createElement("div");
  root.id = "hud";
  const paletteButtons = palette
    .map(
      (p) =>
        `<button class="pal" data-tool="${p.tool}"><span class="ico">${ICONS[p.tool]}</span><span class="nm">${p.name}</span><span class="cost">${p.cost}</span></button>`
    )
    .join("");
  root.innerHTML = `
    <div class="panel top">
      <b>${STR.title}</b> <span class="dim">${STR.stage}</span>
      <div class="dim small">${STR.seed}${seed} · <button id="b-new" class="link">${STR.newMap}</button></div>
      <div id="tileinfo" class="info">${STR.hintHand}</div>
      <div id="stock" class="stock"></div>
      <div id="power" class="power"></div>
      <div id="stats" class="dim small"></div>
    </div>
    <div class="zoom">
      <button id="b-in" aria-label="${STR.zoomIn}">+</button>
      <button id="b-out" aria-label="${STR.zoomOut}">−</button>
      <button id="b-home" aria-label="${STR.home}">⌂</button>
    </div>
    <div id="toast" class="toast"></div>
    <div id="recipes" class="sheet recipes" hidden><div class="sheet-title">${STR.recipes.title}</div><div class="sheet-grid" id="recipe-grid"></div></div>
    <div id="palette" class="sheet" hidden><div class="sheet-grid pal-grid">${paletteButtons}</div></div>
    <div class="bar">
      <button class="tool" data-tool="hand" aria-label="${STR.tools.hand}"><span class="ico">${ICONS.hand}</span><span class="lbl">${STR.tools.hand}</span></button>
      <button class="tool" id="b-build" aria-label="${STR.tools.build}"><span class="ico" id="build-ico">${ICONS.build}</span><span class="lbl" id="build-lbl">${STR.tools.build}</span></button>
      <button class="tool" data-tool="erase" aria-label="${STR.tools.erase}"><span class="ico">${ICONS.erase}</span><span class="lbl">${STR.tools.erase}</span></button>
      <button id="b-rot" class="tool rot" aria-label="${STR.tools.rotate}"><span class="ico" id="rot-ico">↘</span><span class="lbl">${STR.tools.rotate}</span></button>
    </div>`;
  document.body.appendChild(root);
  const q = (id) => root.querySelector(id);
  const paletteEl = q("#palette");
  const recipesEl = q("#recipes");
  q("#b-in").onclick = () => onZoom(1.3);
  q("#b-out").onclick = () => onZoom(1 / 1.3);
  q("#b-home").onclick = () => onHome();
  q("#b-new").onclick = () => onNewMap();
  q("#b-rot").onclick = () => onRotate();
  q("#b-build").onclick = () => {
    recipesEl.hidden = true;
    paletteEl.hidden = !paletteEl.hidden;
    q("#b-build").classList.toggle("open", !paletteEl.hidden);
    root.classList.toggle("pal-open", !paletteEl.hidden);
  };
  for (const btn of root.querySelectorAll("button.tool[data-tool]")) btn.onclick = () => (closePalette(), onTool(btn.dataset.tool));
  const lacking = {}; // tool -> текст нехватки (пусто, если хватает)
  for (const btn of root.querySelectorAll("button.pal")) {
    btn.onclick = () => {
      const t = btn.dataset.tool;
      if (lacking[t]) return toast(lacking[t], true);
      closePalette();
      onTool(t);
    };
  }

  function closePalette() {
    paletteEl.hidden = true;
    q("#b-build").classList.remove("open");
    root.classList.remove("pal-open");
  }
  let toastTimer = 0;
  function toast(text, bad = false) {
    const el = q("#toast");
    el.textContent = text;
    el.classList.toggle("bad", bad);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  return {
    setTile: (text) => (q("#tileinfo").textContent = text),
    setStats: (text) => (q("#stats").textContent = text),
    setStock: (text) => (q("#stock").textContent = text),
    setPower(text, bad) {
      const el = q("#power");
      el.textContent = text;
      el.classList.toggle("bad", !!bad);
    },
    // Подсветка выбранного инструмента; на кнопке «Постройки» показывается выбранная постройка.
    setTool(tool) {
      for (const btn of root.querySelectorAll("button.tool[data-tool]")) btn.classList.toggle("on", btn.dataset.tool === tool);
      for (const btn of root.querySelectorAll("button.pal")) btn.classList.toggle("on", btn.dataset.tool === tool);
      const isBuild = palette.some((p) => p.tool === tool);
      q("#b-build").classList.toggle("on", isBuild);
      q("#build-ico").textContent = isBuild ? ICONS[tool] : ICONS.build;
      q("#build-lbl").textContent = isBuild ? STR.tools[tool] : STR.tools.build;
    },
    setRot: (dir) => (q("#rot-ico").textContent = ARROWS[dir]),
    // Серые кнопки палитры: text = «Не хватает: ...» или пусто.
    setLacking(tool, text) {
      lacking[tool] = text;
      const btn = q(`button.pal[data-tool="${tool}"]`);
      if (btn) btn.classList.toggle("off", !!text);
    },
    closePalette,
    // Панель выбора рецепта станка: list [{id, name, desc}], current id.
    showRecipes(list, current) {
      closePalette();
      root.classList.add("pal-open"); // панель рецептов тоже занимает низ экрана: колонку масштаба прячем
      const grid = q("#recipe-grid");
      grid.innerHTML = list
        .map((r) => `<button class="pal rec${r.id === current ? " on" : ""}" data-id="${r.id}"><span class="nm">${r.name}</span><span class="cost">${r.desc}</span></button>`)
        .join("");
      for (const b of grid.querySelectorAll("button")) b.onclick = () => onRecipe(b.dataset.id);
      recipesEl.hidden = false;
    },
    hideRecipes() {
      recipesEl.hidden = true;
      if (paletteEl.hidden) root.classList.remove("pal-open");
    },
    toast,
  };
}
