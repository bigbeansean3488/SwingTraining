// Rasterizes the app icon (a baseball on a navy field) into PNGs without any
// image dependency. Run: node scripts/gen-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const NAVY = [11, 37, 69];
const WHITE = [250, 250, 247];
const RED = [200, 32, 46];

/** Color at normalized point (u, v) in [0,1]; `ballR` shrinks the ball for maskable safe zone. */
function shade(u, v, ballR) {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const d = Math.hypot(dx, dy);
  if (d > ballR) return NAVY;
  // Two stitch seams: arcs of circles centered outside the ball.
  const sc = ballR * 1.32;
  const sr = ballR * 1.02;
  const w = ballR * 0.07;
  const seamL = Math.abs(Math.hypot(u - (0.5 - sc), v - 0.5) - sr);
  const seamR = Math.abs(Math.hypot(u - (0.5 + sc), v - 0.5) - sr);
  if ((seamL < w || seamR < w) && d < ballR * 0.97) return RED;
  return WHITE;
}

function png(size, ballR) {
  const ss = 4;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, ballR);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      const o = 1 + x * 4;
      row[o] = Math.round(acc[0] / (ss * ss));
      row[o + 1] = Math.round(acc[1] / (ss * ss));
      row[o + 2] = Math.round(acc[2] / (ss * ss));
      row[o + 3] = 255;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, 0.4));
writeFileSync('public/icons/icon-512.png', png(512, 0.4));
writeFileSync('public/icons/icon-maskable-512.png', png(512, 0.3));
writeFileSync('public/icons/apple-touch-icon.png', png(180, 0.38));
writeFileSync('public/favicon.png', png(64, 0.44));
console.log('icons written');
