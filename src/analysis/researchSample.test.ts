import { describe, expect, it } from 'vitest';
import { analyze, ENGINE_VERSION } from './index';
import {
  percentileRank,
  REFERENCE_SOURCE,
  referenceBand,
  referenceRange,
  referenceSample,
  type ReferenceRange,
} from './researchSample';
import { generateBatting, generatePitching } from '../../tests/synthetic';

const fake: ReferenceRange = {
  n: 100,
  q: Array.from({ length: 21 }, (_, i) => i * 5), // value == percentile
  common: [25, 75],
  usual: [10, 90],
  outcome: { rho: 0, p: 1 },
  highOutcome: null,
  groups: {},
};

describe('reference lookups', () => {
  it('interpolates the percentile rank and clamps it to 1..99', () => {
    expect(percentileRank(fake, 50)).toBe(50);
    expect(percentileRank(fake, 62.5)).toBe(63);
    expect(percentileRank(fake, -10)).toBe(1);
    expect(percentileRank(fake, 1000)).toBe(99);
  });

  it('is monotonic', () => {
    let prev = 0;
    for (let v = -5; v <= 105; v += 0.5) {
      const p = percentileRank(fake, v);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('places values in bands by P10/P25/P75/P90', () => {
    expect(referenceBand(fake, 5)).toBe('rare_low');
    expect(referenceBand(fake, 20)).toBe('low');
    expect(referenceBand(fake, 25)).toBe('common');
    expect(referenceBand(fake, 75)).toBe('common');
    expect(referenceBand(fake, 80)).toBe('high');
    expect(referenceBand(fake, 95)).toBe('rare_high');
  });

  it('refuses samples built with other metric definitions', () => {
    expect(referenceSample('pitching', ENGINE_VERSION)).not.toBeNull();
    // Batting contact moved in 1.2.0; pitching did not change.
    expect(referenceSample('batting', '1.1.0')).toBeNull();
    expect(referenceSample('pitching', '1.1.0')).not.toBeNull();
    expect(referenceSample('pitching', '0.9.0')).toBeNull();
    expect(referenceRange('batting', 'stride_length', '99.0.0')).toBeNull();
  });

  it('carries attribution and license', () => {
    expect(REFERENCE_SOURCE.license).toBe('CC BY-NC-SA 4.0');
    expect(REFERENCE_SOURCE.url).toContain('openbiomechanics');
  });
});

describe('published table', () => {
  for (const kind of ['pitching', 'batting'] as const) {
    const sample = referenceSample(kind, ENGINE_VERSION)!;

    it(`${kind}: every entry is well formed`, () => {
      expect(sample.athletes).toBeGreaterThanOrEqual(90);
      for (const [key, r] of Object.entries(sample.metrics)) {
        expect(r.q, key).toHaveLength(21);
        for (let i = 1; i < r.q.length; i++)
          expect(r.q[i]!, key).toBeGreaterThanOrEqual(r.q[i - 1]!);
        expect(r.usual[0], key).toBeLessThanOrEqual(r.common[0]);
        expect(r.common[1], key).toBeLessThanOrEqual(r.usual[1]);
        if (r.highOutcome) expect(r.outcome.significant, key).toBe(true);
      }
    });

    it(`${kind}: only uses metric keys the engine produces`, () => {
      const r =
        kind === 'pitching'
          ? analyze('pitching', generatePitching({ fps: 240 }))
          : analyze('batting', generateBatting({ fps: 240 }));
      const produced = new Set(Object.keys(r.metrics));
      for (const key of Object.keys(sample.metrics)) expect(produced.has(key), key).toBe(true);
    });
  }

  it("pitching stride agrees with OBP's own stride (about 0.84 of height)", () => {
    // Torso (mid-shoulder to mid-hip) is about 0.29 of height in the sample,
    // so a 0.8-0.84 height stride is about 2.7-2.9 torso lengths.
    const r = referenceRange('pitching', 'stride_length', ENGINE_VERSION)!;
    expect(r.q[10]).toBeGreaterThan(2.3);
    expect(r.q[10]).toBeLessThan(3.0);
  });
});
