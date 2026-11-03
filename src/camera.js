// Камера: (x, y) центр экрана в мире (px), zoom масштаб. Чистая логика, без DOM.
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 3;

export function createCamera(x = 0, y = 0, zoom = 1) {
  return { x, y, zoom };
}

export function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

// Сдвиг карты пальцем/мышью на dx, dy экранных пикселей.
export function panBy(cam, dx, dy) {
  cam.x -= dx / cam.zoom;
  cam.y -= dy / cam.zoom;
}

export function screenToWorld(cam, sx, sy, vw, vh) {
  return { x: cam.x + (sx - vw / 2) / cam.zoom, y: cam.y + (sy - vh / 2) / cam.zoom };
}

export function worldToScreen(cam, wx, wy, vw, vh) {
  return { x: (wx - cam.x) * cam.zoom + vw / 2, y: (wy - cam.y) * cam.zoom + vh / 2 };
}

// Масштаб вокруг точки экрана: точка мира под курсором остаётся на месте.
export function zoomAt(cam, factor, sx, sy, vw, vh) {
  const before = screenToWorld(cam, sx, sy, vw, vh);
  cam.zoom = clampZoom(cam.zoom * factor);
  cam.x = before.x - (sx - vw / 2) / cam.zoom;
  cam.y = before.y - (sy - vh / 2) / cam.zoom;
}
