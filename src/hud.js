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
export function createHud({ seed, palette, tabs, onZoom, onHome, onNewMap, onTool, onRotate, onRecipe, onDeliver, onUpgrade, onMenuOpen, onOpenMap, onDeleteMap, onExport, onImport, onUpdate }) {
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
      <div class="dim small">${STR.seed}${seed}</div>
      <div id="tileinfo" class="info">${STR.hintHand}</div>
      <div id="stock" class="stock"></div>
      <div id="power" class="power"></div>
      <div class="coinrow"><span id="coins" class="coins">🪙 0 · 👥 0</span><span class="btnrow"><button id="b-city" class="citybtn">🏙 ${STR.cityWindow.button}</button><button id="b-menu" class="citybtn" aria-label="${STR.menu.button}">☰</button></span></div>
      <div id="stats" class="dim small"></div>
    </div>
    <div class="zoom">
      <button id="b-in" aria-label="${STR.zoomIn}">+</button>
      <button id="b-out" aria-label="${STR.zoomOut}">−</button>
      <button id="b-home" aria-label="${STR.home}">⌂</button>
    </div>
    <div id="toast" class="toast"></div>
    <div id="inspect" class="sheet" hidden>
      <div id="insp-recipes"><div class="sheet-title">${STR.recipes.title}</div><div class="sheet-grid" id="recipe-grid"></div></div>
      <div id="insp-up" class="upbox"></div>
    </div>
    <div id="palette" class="sheet" hidden><div class="tabs">${tabButtons}</div><div class="sheet-grid pal-grid">${paletteButtons}</div></div>
    <div id="city" class="sheet citysheet" hidden>
      <div class="cityhead"><b>🏙 ${STR.cityWindow.title}</b><button id="city-close" class="closebtn" aria-label="${STR.cityWindow.close}">✕</button></div>
      <div id="citystats" class="citystats"></div>
      <div class="sheet-title">${STR.cityWindow.contracts}</div>
      <div id="contracts" class="contracts"></div>
    </div>
    <div id="menu" class="sheet citysheet" hidden>
      <div class="cityhead"><b>☰ ${STR.menu.title}</b><button id="menu-close" class="closebtn" aria-label="${STR.menu.close}">✕</button></div>
      <div id="menustatus" class="menustatus"></div>
      <button id="menu-update" class="upbtn" hidden>${STR.menu.update}</button>
      <div class="menubtns">
        <button id="menu-new" class="mbtn">🗺<br>${STR.menu.newMap}</button>
        <button id="menu-export" class="mbtn">💾<br>${STR.menu.export}</button>
        <button id="menu-import" class="mbtn">📂<br>${STR.menu.import}</button>
      </div>
      <input id="file-in" type="file" accept=".json,application/json" hidden>
      <div class="sheet-title">${STR.menu.maps}</div>
      <div id="maplist" class="maplist"></div>
    </div>
    <div class="bar">
      <button class="tool" data-tool="hand" aria-label="${STR.tools.hand}"><span class="ico">${ICONS.hand}</span><span class="lbl">${STR.tools.hand}</span></button>
      <button class="tool" id="b-build" aria-label="${STR.tools.build}"><span class="ico" id="build-ico">${ICONS.build}</span><span class="lbl" id="build-lbl">${STR.tools.build}</span></button>
      <button class="tool" data-tool="erase" aria-label="${STR.tools.erase}"><span class="ico">${ICONS.erase}</span><span class="lbl">${STR.tools.erase}</span></button>
      <button id="b-rot" class="tool rot" aria-label="${STR.tools.rotate}"><span class="ico" id="rot-ico">↘</span><span class="lbl">${STR.tools.rotate}</span></button>
    </div>`;
  document.body.appendChild(root);
  const q = (id) => root.querySelector(id);
  const sheets = { palette: q("#palette"), recipes: q("#inspect"), city: q("#city"), menu: q("#menu") }; // «recipes» это панель здания (рецепт и улучшение)
  const tabOf = Object.fromEntries(palette.map((p) => [p.tool, p.tab]));
  let cityOpen = false;

  // Открыта ровно одна панель снизу (или ни одной); колонка масштаба прячется, пока что-то открыто.
  function openSheet(name) {
    for (const [k, el] of Object.entries(sheets)) el.hidden = k !== name;
    cityOpen = name === "city";
    q("#b-build").classList.toggle("open", name === "palette");
    q("#b-city").classList.toggle("open", name === "city");
    q("#b-menu").classList.toggle("open", name === "menu");
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
  q("#b-menu").onclick = () => {
    openSheet(sheets.menu.hidden ? "menu" : null);
    if (!sheets.menu.hidden) onMenuOpen();
  };
  q("#menu-close").onclick = () => closeSheets();
  q("#menu-new").onclick = () => onNewMap();
  q("#menu-export").onclick = () => onExport();
  q("#menu-update").onclick = () => onUpdate();
  q("#menu-import").onclick = () => q("#file-in").click();
  q("#file-in").onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // чтобы тот же файл можно было выбрать повторно
    if (f) onImport(f);
  };
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
    isMenuOpen: () => !sheets.menu.hidden,
    setMenuBadge: (on) => q("#b-menu").classList.toggle("badge", !!on),
    // Меню: data {maps:[{seed, ts, buildings, coins, pop}], current, saved, version, offline, persistent, storageOk, updateReady}.
    setMenu(d) {
      const M = STR.menu;
      const fmt = (ts) => {
        if (!ts) return "—";
        const t = new Date(ts);
        const hm = t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        return t.toDateString() === new Date().toDateString() ? hm : `${t.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} ${hm}`;
      };
      q("#menustatus").innerHTML =
        `<span class="dim">${M.saved}</span><b>${d.saved ? fmt(d.saved) : M.never}</b>` +
        `<span class="dim">${M.version}</span><b>${d.version}</b>` +
        `<span class="dim">${M.offline}</span><b>${d.offline ? M.offlineReady : M.offlineNo}</b>` +
        `<span class="dim">${M.storage}</span><b>${d.persistent ? M.persistent : M.notPersistent}</b>` +
        (d.storageOk ? "" : `<span class="warn">⚠ ${M.storageBroken}</span>`);
      q("#menu-update").hidden = !d.updateReady;
      q("#maplist").innerHTML = d.maps.length
        ? d.maps
            .map((m) => {
              const cur = m.seed === d.current;
              const btns = cur ? "" : `<div class="mb"><button class="mopen" data-seed="${m.seed}">${M.open}</button><button class="mdel del" data-seed="${m.seed}">${M.delete}</button></div>`;
              return `<div class="mapitem${cur ? " cur" : ""}"><div class="mi"><b>${STR.seed}${m.seed}${cur ? " · " + M.current : ""}</b><div class="small dim">${m.buildings} ${M.buildings} · 🪙 ${m.coins} · 👥 ${m.pop} · ${fmt(m.ts)}</div></div>${btns}</div>`;
            })
            .join("")
        : `<div class="small dim">${M.empty}</div>`;
      for (const b of q("#maplist").querySelectorAll(".mopen")) b.onclick = () => onOpenMap(Number(b.dataset.seed));
      for (const b of q("#maplist").querySelectorAll(".mdel")) b.onclick = () => onDeleteMap(Number(b.dataset.seed));
    },
    // Панель здания: рецепты станка (recipes: [{id, name, desc}] или null) и улучшение
    // (upgrade: {now, maxed} или {now, level, effect, cost, ok, why}; null для неулучшаемых).
    showBuilding({ recipes, current, upgrade }) {
      q("#insp-recipes").hidden = !recipes;
      if (recipes) {
        const grid = q("#recipe-grid");
        grid.innerHTML = recipes
          .map((r) => `<button class="pal rec${r.id === current ? " on" : ""}" data-id="${r.id}"><span class="nm">${r.name}</span><span class="cost">${r.desc}</span></button>`)
          .join("");
        for (const b of grid.querySelectorAll("button")) b.onclick = () => onRecipe(b.dataset.id);
      }
      const box = q("#insp-up");
      if (!upgrade) box.innerHTML = "";
      else {
        const U = STR.upgrade;
        let html = `<div class="uptitle"><b>${upgrade.now}</b></div>`;
        if (upgrade.maxed) html += `<div class="small dim">${U.maxed}</div>`;
        else {
          html += `<div class="upfx">Mk${upgrade.level}: ${upgrade.effect}</div><div class="small dim">${upgrade.cost}</div>`;
          html += `<button class="upbtn" ${upgrade.ok ? "" : "disabled"}>${U.button} Mk${upgrade.level}</button>`;
          if (upgrade.why) html += `<div class="upwhy">${upgrade.why}</div>`;
        }
        box.innerHTML = html;
        const btn = box.querySelector(".upbtn");
        if (btn) btn.onclick = () => onUpgrade();
      }
      openSheet("recipes");
    },
    hideRecipes() {
      if (!sheets.recipes.hidden) closeSheets();
    },
    isInspectOpen: () => !sheets.recipes.hidden,
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
