import { describe, expect, it } from 'vitest';
import { compareWithReference, positionInRange } from './feedback';
import type { Metrics } from './types';

const mk = (stride: number, knee: number): Metrics => ({
  stride_length: { value: stride, unit: 'torso', confidence: 1 },
  lead_knee_contact: { value: knee, unit: 'deg', confidence: 1 },
});

describe('positionInRange', () => {
  it('needs at least three earlier values', () => {
    expect(positionInRange(1, [1, 2])).toBeNull();
  });
  it('places the value in thirds of the own range or outside it', () => {
    const past = [1, 2, 3, 4];
    expect(positionInRange(1.5, past)!.position).toBe('low');
    expect(positionInRange(2.5, past)!.position).toBe('middle');
    expect(positionInRange(3.5, past)!.position).toBe('high');
    expect(positionInRange(0.5, past)!.position).toBe('below');
    expect(positionInRange(5, past)!.position).toBe('above');
    expect(positionInRange(4, past)!).toMatchObject({ min: 1, max: 4, mean: 2.5, n: 4 });
  });
  it('handles a range of zero width', () => {
    expect(positionInRange(2, [2, 2, 2])!.position).toBe('middle');
  });
});

describe('compareWithReference', () => {
  it('works from a single reference using the per-unit minimum change', () => {
    const r = compareWithReference(mk(1.0, 150), [mk(0.9, 149)]);
    expect(r.count).toBe(1);
    const s = r.metrics.find((m) => m.key === 'stride_length')!;
    expect(s.trend).toBe('higher'); // 0.1 > 0.05 torso
    expect(s.refMean).toBeCloseTo(0.9);
    expect(r.metrics.find((m) => m.key === 'lead_knee_contact')!.trend).toBe('similar'); // 1° < 3°
  });
  it('uses the spread among references as the threshold', () => {
    const refs = [mk(0.8, 150), mk(1.0, 150), mk(1.2, 150)];
    // mean 1.0, sd 0.2: 1.15 is within the usual spread
    expect(compareWithReference(mk(1.15, 150), refs).metrics[0]!.trend).toBe('similar');
    expect(compareWithReference(mk(0.7, 150), refs).metrics[0]!.trend).toBe('lower');
  });
  it('orders differences by size relative to the threshold', () => {
    const r = compareWithReference(mk(0.95, 165), [mk(0.9, 150)]);
    const sorted = [...r.metrics].sort((a, b) => b.size - a.size);
    expect(sorted[0]!.key).toBe('lead_knee_contact'); // 15° / 3° = 5 vs 0.05/0.05 = 1
  });
  it('skips metrics the references do not have', () => {
    const r = compareWithReference(mk(1, 150), [{}]);
    expect(r.metrics).toEqual([]);
  });
});
