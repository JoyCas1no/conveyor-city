// Панели поверх карты (DOM): сведения, склад, монеты, энергия, масштаб, нижняя панель, палитра с вкладками,
// выбор рецепта станка, окно «Город». Одновременно открыта одна из панелей снизу; все прячут колонку масштаба.
import { STR } from "./strings.js";

export const ICONS = {
  hand: "✋", build: "🏗", miner: "⛏", belt: "➡", storage: "📦", smelter: "🔥", constructor: "⚙", splitter: "🔀",
  pole: "🔌", powerplant: "🏭", solar: "☀️", sawmill: "🪚", pump: "🚰", house: "🏠", shop: "🏪", park: "🌳", erase: "🗑",
};
const ARROWS = ["↘", "↙", "↖", "↗"]; // как направления 0..3 выглядят на экране

// palette: [{tool, name, cost, tab}] в порядке показа; tabs: [{id, name}].
// onRecipe(id): рецепт станка; onDeliver(id): сдача контракта.
export function createHud({ seed, palette, tabs, onZoom, onHome, onNewMap, onTool, onRotate, onRecipe, onDeliver }) {
  const root = document.createElement("div");
  root.id = "hud";
  const tabButtons = tabs.map((t) => `<button class="tab" data-tab="${t.id}">${t.name}</button>`).join("");
  const paletteButtons = palette
    .map(
      (p) =>
        `<button class="pal" data-tool="${p.tool}" data-tab="${p.tab}"><span class="ico">${ICONS[p.tool]}</span><span class="nm">${p.name}</span><span class="cost">${p.cost}</span></button>`
    )
    .join("");
  root.innerHTML = `
    <div class="panel top">
      <b>${STR.title}</b> <span class="dim">${STR.stage}</span>
      <div class="dim small">${STR.seed}${seed} · <button id="b-new" class="link">${STR.newMap}</button></div>
      <div id="tileinfo" class="info">${STR.hintHand}</div>
      <div id="stock" class="stock"></div>
      <div id="power" class="power"></div>
      <div class="coinrow"><span id="coins" class="coins">🪙 0 · 👥 0</span><button id="b-city" class="citybtn">🏙 ${STR.cityWindow.button}</button></div>
      <div id="stats" class="dim small"></div>
    </div>
    <div class="zoom">
      <button id="b-in" aria-label="${STR.zoomIn}">+</button>
      <button id="b-out" aria-label="${STR.zoomOut}">−</button>
      <button id="b-home" aria-label="${STR.home}">⌂</button>
    </div>
    <div id="toast" class="toast"></div>
    <div id="recipes" class="sheet recipes" hidden><div class="sheet-title">${STR.recipes.title}</div><div class="sheet-grid" id="recipe-grid"></div></div>
    <div id="palette" class="sheet" hidden><div class="tabs">${tabButtons}</div><div class="sheet-grid pal-grid">${paletteButtons}</div></div>
    <div id="city" class="sheet citysheet" hidden>
      <div class="cityhead"><b>🏙 ${STR.cityWindow.title}</b><button id="city-close" class="closebtn" aria-label="${STR.cityWindow.close}">✕</button></div>
      <div id="citystats" class="citystats"></div>
      <div class="sheet-title">${STR.cityWindow.contracts}</div>
      <div id="contracts" class="contracts"></div>
    </div>
    <div class="bar">
      <button class="tool" data-tool="hand" aria-label="${STR.tools.hand}"><span class="ico">${ICONS.hand}</span><span class="lbl">${STR.tools.hand}</span></button>
      <button class="tool" id="b-build" aria-label="${STR.tools.build}"><span class="ico" id="build-ico">${ICONS.build}</span><span class="lbl" id="build-lbl">${STR.tools.build}</span></button>
      <button class="tool" data-tool="erase" aria-label="${STR.tools.erase}"><span class="ico">${ICONS.erase}</span><span class="lbl">${STR.tools.erase}</span></button>
      <button id="b-rot" class="tool rot" aria-label="${STR.tools.rotate}"><span class="ico" id="rot-ico">↘</span><span class="lbl">${STR.tools.rotate}</span></button>
    </div>`;
  document.body.appendChild(root);
  const q = (id) => root.querySelector(id);
  const sheets = { palette: q("#palette"), recipes: q("#recipes"), city: q("#city") };
  const tabOf = Object.fromEntries(palette.map((p) => [p.tool, p.tab]));
  let cityOpen = false;

  // Открыта ровно одна панель снизу (или ни одной); колонка масштаба прячется, пока что-то открыто.
  function openSheet(name) {
    for (const [k, el] of Object.entries(sheets)) el.hidden = k !== name;
    cityOpen = name === "city";
    q("#b-build").classList.toggle("open", name === "palette");
    q("#b-city").classList.toggle("open", name === "city");
    root.classList.toggle("pal-open", !!name);
  }
  const closeSheets = () => openSheet(null);

  function showTab(id) {
    for (const b of root.querySelectorAll(".tab")) b.classList.toggle("on", b.dataset.tab === id);
    for (const b of root.querySelectorAll("button.pal[data-tab]")) b.hidden = b.dataset.tab !== id;
  }
  showTab(tabs[0].id);
  for (const b of root.querySelectorAll(".tab")) b.onclick = () => showTab(b.dataset.tab);

  q("#b-in").onclick = () => onZoom(1.3);
  q("#b-out").onclick = () => onZoom(1 / 1.3);
  q("#b-home").onclick = () => onHome();
  q("#b-new").onclick = () => onNewMap();
  q("#b-rot").onclick = () => onRotate();
  q("#b-build").onclick = () => openSheet(sheets.palette.hidden ? "palette" : null);
  q("#b-city").onclick = () => openSheet(sheets.city.hidden ? "city" : null);
  q("#city-close").onclick = () => closeSheets();
  for (const btn of root.querySelectorAll("button.tool[data-tool]")) btn.onclick = () => (closeSheets(), onTool(btn.dataset.tool));
  const lacking = {}; // tool -> текст нехватки или закрытия (пусто, если можно строить)
  for (const btn of root.querySelectorAll("button.pal[data-tool]")) {
    btn.onclick = () => {
      const t = btn.dataset.tool;
      if (lacking[t]) return toast(lacking[t], true);
      closeSheets();
      onTool(t);
    };
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

  const itemName = (key) => (key === "residents" ? STR.cityWindow.population : STR.item[key]);

  return {
    setTile: (text) => (q("#tileinfo").textContent = text),
    setStats: (text) => (q("#stats").textContent = text),
    setStock: (text) => (q("#stock").textContent = text),
    setPower(text, bad) {
      const el = q("#power");
      el.textContent = text;
      el.classList.toggle("bad", !!bad);
    },
    setCoins(coins, pop) {
      q("#coins").firstChild.textContent = `🪙 ${coins} · 👥 ${pop}`;
    },
    // Всплывающая цифра у счёта монет: «−30» красным, «+100» зелёным.
    coinPop(delta) {
      const el = document.createElement("span");
      el.className = "coinpop " + (delta < 0 ? "neg" : "pos");
      el.textContent = (delta < 0 ? "−" : "+") + Math.abs(delta);
      q("#coins").appendChild(el);
      setTimeout(() => el.remove(), 1400);
    },
    // Подсветка выбранного инструмента; вкладка палитры следует за выбранной постройкой (в том числе по горячей клавише).
    setTool(tool) {
      for (const btn of root.querySelectorAll("button.tool[data-tool]")) btn.classList.toggle("on", btn.dataset.tool === tool);
      for (const btn of root.querySelectorAll("button.pal")) btn.classList.toggle("on", btn.dataset.tool === tool);
      const isBuild = tool in tabOf;
      q("#b-build").classList.toggle("on", isBuild);
      q("#build-ico").textContent = isBuild ? ICONS[tool] : ICONS.build;
      q("#build-lbl").textContent = isBuild ? STR.tools[tool] : STR.tools.build;
      if (isBuild) showTab(tabOf[tool]);
    },
    setRot: (dir) => (q("#rot-ico").textContent = ARROWS[dir]),
    // Серые кнопки палитры: text = «Не хватает: ...» / «Откроется после контракта ...» или пусто.
    setLacking(tool, text) {
      lacking[tool] = text;
      const btn = q(`button.pal[data-tool="${tool}"]`);
      if (btn) btn.classList.toggle("off", !!text);
    },
    closeSheets,
    closePalette: closeSheets, // касание карты закрывает палитру и окно «Город»
    isCityOpen: () => cityOpen,
    // Панель выбора рецепта станка: list [{id, name, desc}], current id.
    showRecipes(list, current) {
      const grid = q("#recipe-grid");
      grid.innerHTML = list
        .map((r) => `<button class="pal rec${r.id === current ? " on" : ""}" data-id="${r.id}"><span class="nm">${r.name}</span><span class="cost">${r.desc}</span></button>`)
        .join("");
      for (const b of grid.querySelectorAll("button")) b.onclick = () => onRecipe(b.dataset.id);
      openSheet("recipes");
    },
    hideRecipes() {
      if (!sheets.recipes.hidden) closeSheets();
    },
    // Окно «Город»: stats {pop, houses, happy, tax, coins, shops, parks}; contracts [{id, title, coins, unlock, progress, ready}].
    setCity(stats, contracts) {
      const C = STR.cityWindow;
      q("#citystats").innerHTML =
        `<div><span>${C.coins}</span><b>${stats.coins}</b></div>` +
        `<div><span>${C.pop}</span><b>${stats.pop}</b></div>` +
        `<div><span>${C.houses}</span><b>${stats.happy} / ${stats.houses} ${C.happy}</b></div>` +
        `<div><span>${C.tax}</span><b>${stats.tax % 1 ? stats.tax.toFixed(1) : stats.tax}</b></div>` +
        `<div><span>${C.shops}</span><b>${stats.shops}</b></div>` +
        `<div><span>${C.parks}</span><b>${stats.parks}</b></div>`;
      q("#contracts").innerHTML = contracts
        .map((c) => {
          const lines = c.progress.map((p) => `<span class="${p.have >= p.need ? "okp" : ""}">${itemName(p.key)}: ${Math.min(p.have, 99999)} / ${p.need}</span>`).join("");
          const unlock = c.unlock ? `<div class="small dim">${C.unlocks[c.unlock]}</div>` : "";
          return `<div class="contract${c.ready ? " ready" : ""}"><div class="ct"><b>№${c.id + 1} ${c.title}</b><div class="needs">${lines}</div><div class="small dim">${C.reward}: 🪙 ${c.coins}</div>${unlock}</div><button class="deliver" data-id="${c.id}" ${c.ready ? "" : "disabled"}>${C.deliver}</button></div>`;
        })
        .join("");
      for (const b of q("#contracts").querySelectorAll("button.deliver")) b.onclick = () => onDeliver(Number(b.dataset.id));
    },
    toast,
  };
}
