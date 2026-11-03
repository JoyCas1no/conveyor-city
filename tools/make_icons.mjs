// Разовый генератор значков приложения (PNG) без внешних картинок: шестерёнка на конвейере. Запуск: node tools/make_icons.mjs
// Пишет icon-192.png, icon-512.png, icon-512-maskable.png (с запасом по краям) и apple-touch-icon.png (180, непрозрачный).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- маленький растеризатор: рисуем в сетке в 4 раза крупнее и усредняем ----
function canvas(size) {
  const n = size * 4;
  const px = new Uint8ClampedArray(n * n * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  };
  return {
    n,
    px,
    fill(c) {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) set(x, y, c);
    },
    rect(x0, y0, x1, y1, c) {
      for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) set(x, y, c);
    },
    circle(cx, cy, r, c) {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c);
    },
    poly(pts, c) {
      const ys = pts.map((p) => p[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[(i + 1) % pts.length];
          if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.floor(xs[k]); x < xs[k + 1]; x++) set(x, y, c);
      }
    },
  };
}

// Рисунок значка в квадрате side с отступом pad (доля), фон уже залит.
function drawLogo(cv, pad) {
  const n = cv.n;
  const s = n * (1 - 2 * pad);
  const ox = n * pad;
  const oy = n * pad;
  const X = (u) => ox + u * s; // u, v в долях [0, 1]
  const Y = (v) => oy + v * s;
  // конвейер внизу: лента и жёлтые шевроны
  cv.rect(X(0.04), Y(0.74), X(0.96), Y(0.9), [58, 66, 76]);
  cv.rect(X(0.04), Y(0.74), X(0.96), Y(0.77), [124, 135, 147]);
  cv.rect(X(0.04), Y(0.87), X(0.96), Y(0.9), [124, 135, 147]);
  for (let i = 0; i < 4; i++) {
    const cx = 0.16 + i * 0.22;
    cv.poly([[X(cx + 0.05), Y(0.82)], [X(cx - 0.03), Y(0.77)], [X(cx - 0.03), Y(0.87)]], [232, 194, 74]);
  }
  // шестерёнка: золотое кольцо с зубцами
  const gx = X(0.5);
  const gy = Y(0.4);
  const R = s * 0.3;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy;
    const py = dx;
    const w = s * 0.07;
    cv.poly(
      [
        [gx + dx * R * 0.8 + px * w, gy + dy * R * 0.8 + py * w],
        [gx + dx * R * 1.25 + px * w * 0.8, gy + dy * R * 1.25 + py * w * 0.8],
        [gx + dx * R * 1.25 - px * w * 0.8, gy + dy * R * 1.25 - py * w * 0.8],
        [gx + dx * R * 0.8 - px * w, gy + dy * R * 0.8 - py * w],
      ],
      [255, 210, 63]
    );
  }
  cv.circle(gx, gy, R, [255, 210, 63]);
  cv.circle(gx, gy, R * 0.82, [233, 178, 40]);
  cv.circle(gx, gy, R * 0.42, [27, 42, 51]);
  cv.circle(gx, gy, R * 0.18, [255, 210, 63]);
  // камешек руды на ленте
  cv.circle(X(0.72), Y(0.7), s * 0.045, [143, 157, 176]);
  cv.circle(X(0.705), Y(0.685), s * 0.02, [195, 206, 220]);
}

// ---- PNG ----
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, rgba) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (1 + size * 4) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 бит
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Усреднение 4x4 -> 1 пиксель.
function downscale(cv, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const k = ((y * 4 + j) * cv.n + (x * 4 + i)) * 4;
          acc[0] += cv.px[k];
          acc[1] += cv.px[k + 1];
          acc[2] += cv.px[k + 2];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = acc[0] / 16;
      out[o + 1] = acc[1] / 16;
      out[o + 2] = acc[2] / 16;
      out[o + 3] = 255;
    }
  }
  return out;
}

function make(size, pad, file) {
  const cv = canvas(size);
  cv.fill([27, 42, 51]);
  drawLogo(cv, pad);
  fs.writeFileSync(path.join(root, file), png(size, downscale(cv, size)));
  console.log("записан", file, size + "x" + size);
}

make(192, 0.06, "icon-192.png");
make(512, 0.06, "icon-512.png");
make(512, 0.2, "icon-512-maskable.png"); // безопасная зона 80%: Android обрежет края по маске
make(180, 0.06, "apple-touch-icon.png");
