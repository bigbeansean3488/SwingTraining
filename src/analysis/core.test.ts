import { describe, expect, it } from 'vitest';
import { decodeKeypoints, encodeKeypoints, fromBase64, toBase64 } from './codec';
import { compareWithHistory } from './feedback';
import { angleAt, leanFromVertical } from './geometry';
import { KEPT_LANDMARKS } from './landmarks';
import { derivative, estimateFps, fillGaps, lowpassZeroLag, median, percentile } from './signal';
import { analyzeBatting } from './batting';
import { loadFixture } from '../../tests/fixtures';
import type { Metrics } from './types';

describe('signal', () => {
  it('fills only short interior gaps', () => {
    expect(fillGaps([1, NaN, 3], 1)).toEqual([1, 2, 3]);
    const long = fillGaps([1, NaN, NaN, NaN, 5], 2);
    expect(long.slice(1, 4).every(Number.isNaN)).toBe(true);
    expect(Number.isNaN(fillGaps([NaN, 1, 2], 3)[0])).toBe(true);
  });

  it('zero-lag low-pass keeps a slow sine and removes fast noise without shifting it', () => {
    const fs = 240;
    const t = Array.from({ length: 480 }, (_, i) => i / fs);
    const slow = t.map((x) => Math.sin(2 * Math.PI * 2 * x));
    const noisy = slow.map((v, i) => v + 0.3 * Math.sin(2 * Math.PI * 60 * t[i]!));
    const y = lowpassZeroLag(noisy, 12, fs);
    const err = y.slice(40, -40).map((v, i) => Math.abs(v - slow[i + 40]!));
    expect(Math.max(...err)).toBeLessThan(0.03);
    // Peak location unchanged (no phase lag).
    const iPeak = (a: number[]) => a.slice(0, 120).indexOf(Math.max(...a.slice(0, 120)));
    expect(Math.abs(iPeak(y) - iPeak(slow))).toBeLessThanOrEqual(1);
  });

  it('attenuates a signal at the cutoff frequency to about -3 dB (double-pass corrected)', () => {
    const fs = 240;
    const t = Array.from({ length: 2400 }, (_, i) => i / fs);
    const x = t.map((v) => Math.sin(2 * Math.PI * 12 * v));
    const y = lowpassZeroLag(x, 12, fs);
    const amp = Math.max(...y.slice(600, 1800).map(Math.abs));
    expect(amp).toBeGreaterThan(0.65);
    expect(amp).toBeLessThan(0.76);
  });

  it('derivative, percentile, median, fps', () => {
    expect(derivative([0, 1, 2, 3], 10)).toEqual([10, 10, 10, 10]);
    expect(median([3, 1, 2])).toBe(2);
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(estimateFps([0, 1 / 240, 2 / 240, 3 / 240])).toBeCloseTo(240, 6);
  });
});

describe('geometry', () => {
  it('computes interior and lean angles', () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })).toBeCloseTo(180);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    // Tip up and to the right: leaning forward when forward = +1, backward when -1.
    expect(leanFromVertical({ x: 0, y: 10 }, { x: 10, y: 0 }, 1)).toBeCloseTo(45);
    expect(leanFromVertical({ x: 0, y: 10 }, { x: 10, y: 0 }, -1)).toBeCloseTo(-45);
  });
});

describe('keypoint codec', () => {
  it('round-trips with sub-pixel precision and preserves metrics', () => {
    const { seq } = loadFixture('batting-120fps-noisy');
    seq.frames[5] = { t: seq.frames[5]!.t, lm: null };
    const bytes = encodeKeypoints(seq);
    const back = decodeKeypoints(fromBase64(toBase64(bytes)));
    expect(back.frames.length).toBe(seq.frames.length);
    expect(back.frames[5]!.lm).toBeNull();
    for (const k of KEPT_LANDMARKS) {
      const a = seq.frames[10]!.lm![k]!;
      const b = back.frames[10]!.lm![k]!;
      expect(Math.abs(a.x - b.x) * seq.width).toBeLessThan(0.1);
      expect(Math.abs(a.v - b.v)).toBeLessThan(0.005);
    }
    const m1 = analyzeBatting(seq).metrics;
    const m2 = analyzeBatting(back).metrics;
    expect(m2.stride_length!.value).toBeCloseTo(m1.stride_length!.value, 2);
    expect(m2.lead_knee_contact!.value).toBeCloseTo(m1.lead_knee_contact!.value, 0);
  });

  it('base64 round-trips arbitrary lengths', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100]) {
      const a = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      expect(Array.from(fromBase64(toBase64(a)))).toEqual(Array.from(a));
    }
    expect(toBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
  });
});

describe('feedback vs own history', () => {
  const mk = (v: number): Metrics => ({
    stride_length: { value: v, unit: 'torso', confidence: 0.9 },
  });

  it('needs at least 3 earlier results', () => {
    const r = compareWithHistory(mk(1), [mk(1), mk(1)]);
    expect(r.enoughHistory).toBe(false);
    expect(r.metrics).toEqual([]);
  });

  it('reports higher / lower / similar relative to the personal mean', () => {
    const hist = [mk(0.6), mk(0.62), mk(0.58), mk(0.6)];
    expect(compareWithHistory(mk(0.8), hist).metrics[0]!.trend).toBe('higher');
    expect(compareWithHistory(mk(0.4), hist).metrics[0]!.trend).toBe('lower');
    expect(compareWithHistory(mk(0.63), hist).metrics[0]!.trend).toBe('similar');
  });

  it('detects increased stability over the last five', () => {
    const hist = [0.4, 0.8, 0.5, 0.9, 0.45, 0.6, 0.61, 0.6, 0.59].map(mk);
    const r = compareWithHistory(mk(0.6), hist);
    expect(r.stability.stride_length).toBe('more_stable');
  });
});
