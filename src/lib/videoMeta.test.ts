import { describe, expect, it } from 'vitest';
import { readFilmedAt, type ByteReader } from './videoMeta';

const MP4_EPOCH_S = Date.UTC(1904, 0, 1) / 1000;

function box(type: string, body: number[]): number[] {
  const size = 8 + body.length;
  return [
    (size >>> 24) & 255,
    (size >>> 16) & 255,
    (size >>> 8) & 255,
    size & 255,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...body,
  ];
}
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const be64 = (v: number) => [...be32(Math.floor(v / 2 ** 32)), ...be32(v % 2 ** 32)];

function mvhd(iso: string | null, version = 0): number[] {
  const secs = iso ? Date.parse(iso) / 1000 - MP4_EPOCH_S : 0;
  const times = version === 1 ? [...be64(secs), ...be64(secs)] : [...be32(secs), ...be32(secs)];
  return box('mvhd', [version, 0, 0, 0, ...times, ...be32(600), ...new Array(80).fill(0)]);
}

function reader(bytes: number[]): ByteReader {
  const u = Uint8Array.from(bytes);
  return async (o, n) => u.slice(o, o + n);
}

const NOW = Date.parse('2026-11-18T12:00:00Z');

describe('filming time from the MP4 movie header', () => {
  it('reads mvhd creation time (version 0)', async () => {
    const f = [
      ...box(
        'ftyp',
        [...'isom'].map((c) => c.charCodeAt(0)),
      ),
      ...box('moov', mvhd('2026-11-16T08:30:00Z')),
    ];
    expect(await readFilmedAt(reader(f), f.length, NOW)).toBe('2026-11-16T08:30:00.000Z');
  });

  it('finds moov after the media data (common on Android) and reads version 1', async () => {
    const f = [
      ...box('ftyp', [0, 0, 0, 0]),
      ...box('mdat', new Array(500).fill(7)),
      ...box('moov', [...box('udta', [1, 2, 3]), ...mvhd('2025-05-01T00:00:00Z', 1)]),
    ];
    expect(await readFilmedAt(reader(f), f.length, NOW)).toBe('2025-05-01T00:00:00.000Z');
  });

  it('ignores zero, very old or future times', async () => {
    for (const iso of [null, '1999-01-01T00:00:00Z', '2027-01-01T00:00:00Z']) {
      const f = [...box('ftyp', [0, 0, 0, 0]), ...box('moov', mvhd(iso))];
      expect(await readFilmedAt(reader(f), f.length, NOW)).toBeNull();
    }
  });

  it('returns null for files that are not MP4/MOV', async () => {
    const f = [...'not a video at all'].map((c) => c.charCodeAt(0));
    expect(await readFilmedAt(reader(f), f.length, NOW)).toBeNull();
  });
});
