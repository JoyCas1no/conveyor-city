// Изометрия: клетка (x, y) в мире. Ось x уходит вправо-вниз, ось y влево-вниз.
// Верхняя вершина ромба клетки: ((x - y) * HW, (x + y) * HH). Клетка занимает [x, x+1) × [y, y+1).
export const HW = 32; // полуширина ромба клетки, px
export const HH = 16; // полувысота ромба клетки, px

export function tileToScreen(x, y) {
  return { x: (x - y) * HW, y: (x + y) * HH };
}

// Дробные координаты клетки по точке мира (px). Без учёта высоты скал.
export function screenToTile(sx, sy) {
  const a = sx / HW;
  const b = sy / HH;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function pickTile(sx, sy) {
  const t = screenToTile(sx, sy);
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
}

// Выбор клетки с учётом высоты скал (высоты кратны 4, от 12 до 36 px): верх скалы сдвинут вверх по экрану,
// поэтому ищем клетку, чей поднятый верх содержит точку; иначе клетка на земле.
export function pickTileRaised(sx, sy, heightAt) {
  for (let h = 36; h >= 12; h -= 4) {
    const t = pickTile(sx, sy + h);
    if (heightAt(t.x, t.y) === h) return t;
  }
  return pickTile(sx, sy);
}
