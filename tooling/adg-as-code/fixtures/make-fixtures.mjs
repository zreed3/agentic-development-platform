#!/usr/bin/env node
// Generate deterministic tiny PNG fixtures for the asset-lint test, dependency-free
// (Node built-in zlib only). Run: node tooling/adg-as-code/fixtures/make-fixtures.mjs
//
//   clean.png   - black square centred on white, no content within 2px of any edge (PASS)
//   clipped.png - black bar touching the left edge (edge-clip FAIL)
//   blank.png   - all white (blank guard FAIL: mean luminance above the max)

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

// CRC32 (PNG chunks need it; Node zlib does not expose it).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
// paint(x,y) -> [r,g,b,a]
function png(width, height, paint) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10,11,12 = compression, filter, interlace = 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const W = 64, H = 64;
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

// clean: black square from (16,16) to (47,47); >=2px clear margin from every edge.
fs.writeFileSync(path.join(dir, "clean.png"), png(W, H, (x, y) => (x >= 16 && x <= 47 && y >= 16 && y <= 47 ? BLACK : WHITE)));
// clipped: black bar in the leftmost 6 columns (touches the left edge).
fs.writeFileSync(path.join(dir, "clipped.png"), png(W, H, (x) => (x < 6 ? BLACK : WHITE)));
// blank: all white.
fs.writeFileSync(path.join(dir, "blank.png"), png(W, H, () => WHITE));

console.log("wrote clean.png, clipped.png, blank.png");
