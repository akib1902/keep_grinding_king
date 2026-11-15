#!/usr/bin/env node
/* scraperStack · generates the PNG toolbar icons without any dependencies. */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'icons');
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------------- drawing */

function sdRoundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - radius;
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

const BARS = [
  { cx: 0.5, cy: 0.355, halfW: 0.205, halfH: 0.047, radius: 0.024, color: [255, 255, 255], alpha: 1 },
  { cx: 0.455, cy: 0.485, halfW: 0.16, halfH: 0.043, radius: 0.022, color: [255, 255, 255], alpha: 0.9 },
  { cx: 0.41, cy: 0.615, halfW: 0.115, halfH: 0.038, radius: 0.019, color: [34, 211, 238], alpha: 1 }
];

function render(size) {
  const bigSize = size * SUPERSAMPLE;
  const big = new Float32Array(bigSize * bigSize * 4);

  for (let y = 0; y < bigSize; y += 1) {
    for (let x = 0; x < bigSize; x += 1) {
      const u = (x + 0.5) / bigSize;
      const v = (y + 0.5) / bigSize;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (sdRoundRect(u, v, 0.5, 0.5, 0.47, 0.47, 0.225) < 0) {
        /* Indigo → violet gradient with a soft top-left highlight. */
        const t = clamp01(u * 0.42 + v * 0.62);
        r = mix(0x92, 0x4f, t);
        g = mix(0x63, 0x24, t);
        b = mix(0xf8, 0xb4, t);
        const glow = Math.pow(Math.max(0, 1 - Math.hypot(u - 0.26, v - 0.16) / 0.9), 2) * 0.18;
        r = mix(r, 255, glow);
        g = mix(g, 255, glow);
        b = mix(b, 255, glow);
        a = 255;

        /* Stacked "layers" glyph. */
        for (const bar of BARS) {
          if (sdRoundRect(u, v, bar.cx, bar.cy, bar.halfW, bar.halfH, bar.radius) < 0) {
            r = mix(r, bar.color[0], bar.alpha);
            g = mix(g, bar.color[1], bar.alpha);
            b = mix(b, bar.color[2], bar.alpha);
          }
        }
      }

      const index = (y * bigSize + x) * 4;
      big[index] = r;
      big[index + 1] = g;
      big[index + 2] = b;
      big[index + 3] = a;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy += 1) {
        for (let dx = 0; dx < SUPERSAMPLE; dx += 1) {
          const index = (((y * SUPERSAMPLE + dy) * bigSize) + (x * SUPERSAMPLE + dx)) * 4;
          r += big[index];
          g += big[index + 1];
          b += big[index + 2];
          a += big[index + 3];
        }
      }
      const offset = (y * size + x) * 4;
      out[offset] = Math.round(r / samples);
      out[offset + 1] = Math.round(g / samples);
      out[offset + 2] = Math.round(b / samples);
      out[offset + 3] = Math.round(a / samples);
    }
  }
  return out;
}

for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file.replace(ROOT + '/', '')} (${size}×${size})`);
}
