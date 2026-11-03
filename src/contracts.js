// Контракты города: чистые данные и правила. Открыто всегда до 3 невыполненных контрактов по порядку.
// Первые шесть заданы вручную, дальше награда и объёмы растут по формуле. Названия здесь же (данные, не интерфейс).
export const OPEN_SLOTS = 3;

const FIRST = [
  { title: "Первый заказ", need: { plank: 20 }, coins: 100 },
  { title: "Утолить жажду", need: { water: 15 }, coins: 120 },
  { title: "Новосёлы", need: { residents: 4 }, coins: 150 },
  { title: "Шестерёнки для лавки", need: { gear: 10 }, coins: 200 },
  { title: "Квартал", need: { residents: 12 }, coins: 300 },
  { title: "Провода в город", need: { copper_wire: 15, gear: 10 }, coins: 400 },
];

// Дальше по кругу: доски, вода, шестерёнки, пластины, провод, население.
const CYCLE = [
  { title: "Доски для стройки", item: "plank" },
  { title: "Вода для района", item: "water" },
  { title: "Шестерёнки для мастерских", item: "gear" },
  { title: "Пластины для крыш", item: "iron_plate" },
  { title: "Провод для фонарей", item: "copper_wire" },
  { title: "Новый район", residents: true },
];

// Какой контракт (по номеру) открывает какую постройку.
export const UNLOCK_AT = { 0: "shop", 1: "park" };
export const GATED = { shop: 0, park: 1 };

export function contractAt(i) {
  if (i < FIRST.length) return { id: i, ...FIRST[i], need: { ...FIRST[i].need } };
  const n = i - FIRST.length + 1; // 1, 2, 3...
  const k = CYCLE[(n - 1) % CYCLE.length];
  const need = k.residents ? { residents: 12 + 4 * n } : { [k.item]: 20 + 5 * n };
  return { id: i, title: k.title, need, coins: 400 + 50 * n };
}

// Номера первых OPEN_SLOTS невыполненных контрактов (done: Set номеров).
export function openIds(done) {
  const out = [];
  for (let i = 0; out.length < OPEN_SLOTS; i++) if (!done.has(i)) out.push(i);
  return out;
}
