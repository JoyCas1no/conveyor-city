// Палитра и цветовые помощники. Цвета числами 0xRRGGBB.
export function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// f < 1 темнее, f > 1 светлее.
export function shade(c, f) {
  return f < 1 ? lerpColor(c, 0x000000, 1 - f) : lerpColor(c, 0xffffff, f - 1);
}

export const PAL = {
  sky: 0x1b2a33,
  grass: 0x7cb35a,
  grassDry: 0x93b95e,
  forestFloor: 0x5f9a4c,
  sand: 0xe2cf94,
  waterShallow: 0x58b0dc,
  waterDeep: 0x2d63a3,
  hillTop: 0xa4a4a8,
  hillSideL: 0x7a7a82,
  hillSideR: 0x62626a,
  trunk: 0x6b4a2f,
  leafDark: 0x2f7045,
  leafLight: 0x4a9a55,
  ore: {
    1: { base: 0x8f9db0, light: 0xc3cedc, spot: 0xb5654a }, // железо: серо-голубое с ржавчиной
    2: { base: 0xe08a3c, light: 0xf3b26a, spot: 0x4aa38a }, // медь: оранжевая с зеленцой
    3: { base: 0x2b2b30, light: 0x5a5a64, spot: 0x15151a }, // уголь: чёрный с бликами
  },
};
