// Synthetic practice sessions for tests and the demo mode. Pure.
import { generateSwing } from './swing.js';

/** Small natural swing-to-swing variation around a player's baseline. */
export function naturalVariation(i, amount = 1) {
  // Deterministic pseudo-jitter (no RNG needed): different per swing index.
  const j = (k) => Math.sin(12.9898 * (i + 1) * k) * amount;
  return {
    strideLength: 1.0 + 0.02 * j(1),
    headMoveX: 0.03 + 0.01 * j(2),
    headMoveY: 0.02 + 0.005 * j(3),
    handRadius: 0.65 + 0.01 * j(4),
    swingStart: 0.95 + 0.008 * j(5),
    swingEnd: 1.25 + 0.008 * j(5),
    seed: 100 + i,
  };
}

/**
 * The milestone-6 reference session:
 * 1–3 near-baseline, 4 longer stride, 5 more head movement.
 */
export function referenceSession() {
  return [
    { label: 'baseline', params: naturalVariation(0) },
    { label: 'near baseline', params: naturalVariation(1) },
    { label: 'near baseline', params: naturalVariation(2) },
    { label: 'longer stride', params: { ...naturalVariation(3), strideLength: 1.4 } },
    { label: 'more head movement', params: { ...naturalVariation(4), headMoveX: 0.35, headMoveY: 0.12 } },
  ].map((s, i) => ({ id: `syn-${i + 1}`, ...s, seq: generateSwing(s.params) }));
}

/** Session with a given amount of natural variability (for consistency-score tests). */
export function variableSession(count, amount, seedBase = 0) {
  return Array.from({ length: count }, (_, i) => {
    const params = naturalVariation(i + seedBase, amount);
    return { id: `var-${amount}-${i + 1}`, params, seq: generateSwing(params) };
  });
}
