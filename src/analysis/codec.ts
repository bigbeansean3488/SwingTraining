// Compact binary encoding of keypoint sequences for storage and sync.
// Only KEPT_LANDMARKS are stored; others decode as {x:0,y:0,v:0}.
// Layout (little endian):
//   'KP' u8 version | u16 width | u16 height | u32 frameCount | u8 nLm | nLm x u8 index
//   per frame: u32 t(µs) | u8 present | present ? nLm x (u16 x, u16 y, u8 v) : nothing
// x/y are quantized over [-0.25, 1.25] and stored as deltas (mod 2^16) from the
// previous present frame, which makes the stream compress well with gzip.
import { KEPT_LANDMARKS, LANDMARK_COUNT } from './landmarks';
import type { Landmark, PoseSequence } from './types';

const VERSION = 1;
const LO = -0.25;
const SPAN = 1.5;

const q = (v: number) => Math.max(0, Math.min(65535, Math.round(((v - LO) / SPAN) * 65535)));
const dq = (u: number) => LO + (u / 65535) * SPAN;

export function encodeKeypoints(seq: PoseSequence, kept: number[] = KEPT_LANDMARKS): Uint8Array {
  const n = kept.length;
  const per = 5 + n * 5;
  const buf = new ArrayBuffer(12 + n + seq.frames.length * per);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o++, 0x4b); // 'K'
  dv.setUint8(o++, 0x50); // 'P'
  dv.setUint8(o++, VERSION);
  dv.setUint16(o, seq.width, true);
  o += 2;
  dv.setUint16(o, seq.height, true);
  o += 2;
  dv.setUint32(o, seq.frames.length, true);
  o += 4;
  dv.setUint8(o++, n);
  for (const k of kept) dv.setUint8(o++, k);
  let prev: number[] | null = null;
  for (const f of seq.frames) {
    dv.setUint32(o, Math.round(f.t * 1e6), true);
    o += 4;
    dv.setUint8(o++, f.lm ? 1 : 0);
    if (!f.lm) continue;
    const cur: number[] = [];
    kept.forEach((k, j) => {
      const p = f.lm![k] ?? { x: 0, y: 0, v: 0 };
      const x = q(p.x);
      const y = q(p.y);
      cur.push(x, y);
      dv.setUint16(o, prev ? (x - prev[2 * j]! + 65536) & 0xffff : x, true);
      o += 2;
      dv.setUint16(o, prev ? (y - prev[2 * j + 1]! + 65536) & 0xffff : y, true);
      o += 2;
      dv.setUint8(o++, Math.max(0, Math.min(255, Math.round(p.v * 255))));
    });
    prev = cur;
  }
  return new Uint8Array(buf, 0, o);
}

export function decodeKeypoints(bytes: Uint8Array): PoseSequence {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(0) !== 0x4b || dv.getUint8(1) !== 0x50) throw new Error('not a keypoint stream');
  let o = 2;
  const version = dv.getUint8(o++);
  if (version !== VERSION) throw new Error(`unsupported keypoint version ${version}`);
  const width = dv.getUint16(o, true);
  o += 2;
  const height = dv.getUint16(o, true);
  o += 2;
  const count = dv.getUint32(o, true);
  o += 4;
  const n = dv.getUint8(o++);
  const kept: number[] = [];
  for (let j = 0; j < n; j++) kept.push(dv.getUint8(o++));
  const frames: PoseSequence['frames'] = [];
  let prev: number[] | null = null;
  for (let i = 0; i < count; i++) {
    const t = dv.getUint32(o, true) / 1e6;
    o += 4;
    const present = dv.getUint8(o++);
    if (!present) {
      frames.push({ t, lm: null });
      continue;
    }
    const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, v: 0 }));
    const cur: number[] = [];
    for (let j = 0; j < n; j++) {
      let x = dv.getUint16(o, true);
      o += 2;
      let y = dv.getUint16(o, true);
      o += 2;
      const v = dv.getUint8(o++) / 255;
      if (prev) {
        x = (x + prev[2 * j]!) & 0xffff;
        y = (y + prev[2 * j + 1]!) & 0xffff;
      }
      cur.push(x, y);
      lm[kept[j]!] = { x: dq(x), y: dq(y), v };
    }
    prev = cur;
    frames.push({ t, lm });
  }
  return { width, height, frames };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]!;
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : B64[c & 63]!;
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]!) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]!) : 0);
    if (o < len) out[o++] = (n >> 16) & 255;
    if (o < len) out[o++] = (n >> 8) & 255;
    if (o < len) out[o++] = n & 255;
  }
  return out;
}
