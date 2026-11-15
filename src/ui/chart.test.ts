import { describe, expect, it } from 'vitest';
import { niceTicks } from './chartScale';

describe('niceTicks', () => {
  it('never goes below zero for non-negative data', () => {
    expect(niceTicks(0, 0)[0]).toBe(0);
    expect(Math.min(...niceTicks(0.05, 0.4))).toBeGreaterThanOrEqual(0);
  });
  it('covers the data range', () => {
    const t = niceTicks(-12, 7);
    expect(t[0]!).toBeLessThanOrEqual(-12);
    expect(t[t.length - 1]!).toBeGreaterThanOrEqual(7);
  });
});
