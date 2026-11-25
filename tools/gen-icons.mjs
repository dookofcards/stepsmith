// Icon generator (run: node tools/gen-icons.mjs) — writes raw PNGs with no
// image libraries. Design: three white steps climbing to the right with an orange
// dot on top, on an indigo tile — "Stepsmith". Rendered with
// 4x4 supersampling for smooth edges at every size.
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const SS = 4; // supersamples per axis

function png(size, colorAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const [cr, cg, cb, ca] = colorAt(u, v);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      raw.set(
        alpha > 0
          ? [r / a, g / a, b / a, alpha].map(Math.round)
          : [0, 0, 0, 0],
        row + 1 + x * 4,
      );
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const INDIGO = [79, 70, 229];
const WHITE = [255, 255, 255];
const ORANGE = [249, 115, 22];
const CLEAR = [0, 0, 0, 0];

// Three white steps climbing to the right, with an orange "you are here" dot
// on top: a guide, step by step.
const STEPS = [
  [0.2, 0.58, 0.4, 0.78],
  [0.4, 0.42, 0.6, 0.78],
  [0.6, 0.26, 0.8, 0.78],
];
const DOT = { x: 0.7, y: 0.15, r: 0.065 };

function inRoundedSquare(u, v) {
  const inset = 0.04;
  const radius = 0.2;
  const cx = Math.min(Math.max(u, inset + radius), 1 - inset - radius);
  const cy = Math.min(Math.max(v, inset + radius), 1 - inset - radius);
  return (
    u >= inset && u <= 1 - inset && v >= inset && v <= 1 - inset &&
    Math.hypot(u - cx, v - cy) <= radius
  );
}

function colorAt(u, v) {
  if (!inRoundedSquare(u, v)) return CLEAR;
  if (Math.hypot(u - DOT.x, v - DOT.y) <= DOT.r) return [...ORANGE, 255];
  for (const [x1, y1, x2, y2] of STEPS) {
    if (u >= x1 && u < x2 && v >= y1 && v <= y2) return [...WHITE, 255];
  }
  return [...INDIGO, 255];
}

await mkdir("src/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(`src/icons/icon${size}.png`, png(size, colorAt));
  console.log(`wrote src/icons/icon${size}.png`);
}
