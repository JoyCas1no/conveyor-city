// Ввод: мышь, касания, колёсико, клавиатура. Только Pointer Events, один код для ПК, телефона и планшета.
// Режим «рука»: один палец или левая кнопка двигают карту. С выбранной постройкой один палец или левая кнопка
// строят (штрих), а карту двигают двумя пальцами, правой или средней кнопкой, клавишами WASD.
import { panBy, zoomAt } from "./camera.js";

const TAP_SLOP = 8; // px: сдвиг меньше этого считается касанием, а не перетаскиванием

export function attachInput(el, cam, { size, onChange, onTap, onRightTap, onHover, build }) {
  const pts = new Map();
  let gesture = null; // "pan" | "build" | "pinch"
  let travelled = 0;
  let downButton = 0;
  const keys = new Set();

  const pos = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = () => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  el.addEventListener("pointerdown", (e) => {
    const p = pos(e);
    pts.set(e.pointerId, p);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // захват не обязателен: без него касание всё равно работает, пока палец над полем
    }
    if (pts.size >= 2) {
      if (gesture === "build") build.cancel(); // второй палец: это щипок, а не стройка
      gesture = "pinch";
      return;
    }
    travelled = 0;
    downButton = e.pointerType === "mouse" ? e.button : 0;
    if (build.active() && downButton === 0) {
      gesture = "build";
      build.down(p.x, p.y);
    } else gesture = "pan";
  });

  el.addEventListener("pointermove", (e) => {
    const p = pos(e);
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === "mouse") onHover?.(p.x, p.y);
      return;
    }
    const prev = pts.get(e.pointerId);
    if (pts.size === 1) {
      pts.set(e.pointerId, p);
      if (gesture === "build") {
        build.move(p.x, p.y);
        return;
      }
      travelled += Math.hypot(p.x - prev.x, p.y - prev.y);
      if (travelled > TAP_SLOP) {
        panBy(cam, p.x - prev.x, p.y - prev.y);
        onChange();
      }
    } else if (pts.size === 2) {
      const d0 = dist();
      const m0 = mid();
      pts.set(e.pointerId, p);
      const d1 = dist();
      const m1 = mid();
      const { w, h } = size();
      if (d0 > 0) zoomAt(cam, d1 / d0, m1.x, m1.y, w, h);
      panBy(cam, m1.x - m0.x, m1.y - m0.y);
      onChange();
    }
  });

  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pos(e);
    const wasOnly = pts.size === 1;
    pts.delete(e.pointerId);
    if (gesture === "build") {
      if (e.type === "pointercancel") build.cancel();
      else build.up(p.x, p.y);
      gesture = null;
      return;
    }
    if (wasOnly) {
      if (gesture === "pan" && downButton === 0 && travelled <= TAP_SLOP && e.type === "pointerup") onTap?.(p.x, p.y);
      else if (gesture === "pan" && downButton === 2 && travelled <= TAP_SLOP && e.type === "pointerup") onRightTap?.(p.x, p.y);
      gesture = null;
    } else if (pts.size === 1) {
      gesture = "pan"; // остался один палец после щипка: он двигает карту, но не строит
      travelled = TAP_SLOP + 1;
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = pos(e);
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const { w, h } = size();
      zoomAt(cam, Math.exp(-px * 0.0015), p.x, p.y, w, h);
      onChange();
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  // Вызывать каждый кадр: движение клавишами WASD/стрелки, масштаб +/-.
  return function applyKeys(dtMs) {
    if (!keys.size) return;
    const step = 0.9 * dtMs;
    let dx = 0;
    let dy = 0;
    if (keys.has("a") || keys.has("arrowleft") || keys.has("ф")) dx += step;
    if (keys.has("d") || keys.has("arrowright") || keys.has("в")) dx -= step;
    if (keys.has("w") || keys.has("arrowup") || keys.has("ц")) dy += step;
    if (keys.has("s") || keys.has("arrowdown") || keys.has("ы")) dy -= step;
    const { w, h } = size();
    if (keys.has("=") || keys.has("+")) zoomAt(cam, 1 + dtMs * 0.002, w / 2, h / 2, w, h);
    if (keys.has("-") || keys.has("_")) zoomAt(cam, 1 - dtMs * 0.002, w / 2, h / 2, w, h);
    if (dx || dy) panBy(cam, dx, dy);
    onChange();
  };
}
