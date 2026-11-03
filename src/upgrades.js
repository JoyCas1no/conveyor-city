// Уровни зданий Mk1-Mk3: чистые данные (цены, множители). Всё считается по номеру уровня 1..3.
export const MAX_LEVEL = 3;

// Множитель скорости бура, лесопилки, насоса, плавильни, станка (по уровню; индекс 0 не используется).
export const SPEED = [1, 1, 1.5, 2];
// Электростанция: множитель выработки. Один уголь горит столько же при полной нагрузке, энергии за него больше.
export const PLANT_MULT = [1, 1, 1.5, 2];
// Дом: жителей, налог в минуту, во сколько раз быстрее уходят вода и доски.
export const HOUSE_CAP_BY = [4, 4, 6, 8];
export const TAX_BY = [10, 10, 15, 20];
export const NEED_MULT = [1, 1, 1.5, 2];
// Магазин и парк: бонус налога и радиус влияния на дома.
export const SHOP_BONUS_BY = [0.5, 0.5, 0.75, 1.0];
export const PARK_BONUS_BY = [0.25, 0.25, 0.4, 0.5];
export const RADIUS_BY = [6, 6, 7, 8];

// Цены перехода НА уровень (2 и 3): монеты и предметы со склада.
const MINING = { 2: { coins: 50, iron_ingot: 10 }, 3: { coins: 150, iron_plate: 10, gear: 5 } };
const MACHINE = { 2: { coins: 80, iron_plate: 10 }, 3: { coins: 200, gear: 10, copper_wire: 10 } };
const CITY = { 2: { coins: 100, plank: 10 }, 3: { coins: 250, plank: 20, copper_wire: 5 } };
export const UPGRADES = {
  miner: MINING,
  sawmill: MINING,
  pump: MINING,
  smelter: MACHINE,
  constructor: MACHINE,
  powerplant: { 2: { coins: 150, iron_ingot: 20 }, 3: { coins: 300, iron_plate: 15, gear: 10 } },
  house: { 2: { coins: 60, plank: 15 }, 3: { coins: 150, plank: 25, gear: 5 } },
  shop: CITY,
  park: CITY,
};

// Какой контракт (по номеру) открывает уровень: Mk2 после №3 («Новосёлы»), Mk3 после №5 («Квартал»).
export const LEVEL_UNLOCK = { 2: 2, 3: 4 };

export const isUpgradable = (type) => Object.hasOwn(UPGRADES, type);

// Вся сумма, потраченная на здание до уровня lvl включительно (база задаётся снаружи): для возврата при сносе.
export function upgradeTotal(type, lvl) {
  const out = {};
  if (!isUpgradable(type)) return out;
  for (let l = 2; l <= lvl; l++) for (const [k, n] of Object.entries(UPGRADES[type][l])) out[k] = (out[k] || 0) + n;
  return out;
}
