// Session review statistics (descriptive only, no causal claims). Pure.
import { focusScores } from './interpret.js';
import { CONTACT_LABELS } from './session.js';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * @param swings session swings (any order)
 * @param focus  training focus key
 */
export function reviewSession(swings, focus = 'motion') {
  const sorted = [...swings].sort((a, b) => a.number - b.number);
  const valid = sorted.filter((s) => s.valid);
  const series = sorted.map((s) => ({ id: s.id, number: s.number, valid: s.valid, score: s.valid ? focusScores(s)[focus] : null, motion: s.consistency?.score ?? null, contact: s.contact }));
  const scored = series.filter((p) => p.score !== null);

  // Trend: first vs last up-to-5 scored swings (needs at least 4 scored swings).
  let trend = null;
  if (scored.length >= 4) {
    const k = Math.min(5, Math.floor(scored.length / 2));
    trend = { first: mean(scored.slice(0, k).map((p) => p.score)), last: mean(scored.slice(-k).map((p) => p.score)), k };
  }

  const contactCounts = Object.fromEntries(CONTACT_LABELS.map((l) => [l, sorted.filter((s) => s.contact === l).length]));
  const labeled = CONTACT_LABELS.reduce((a, l) => a + contactCounts[l], 0);

  const withMotion = series.filter((p) => p.motion !== null);
  const best = withMotion.length ? withMotion.reduce((a, b) => (b.motion > a.motion ? b : a)) : null;

  // Component with the largest mean deviation from the baseline.
  const comps = ['head', 'stride', 'timing', 'wristPath'];
  const devMeans = comps.map((c) => [c, mean(valid.map((s) => s.deviations?.[c]).filter((v) => Number.isFinite(v)))]).filter(([, v]) => v !== null);
  const largestVariation = devMeans.length ? devMeans.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;

  // Good-contact rate for swings with higher vs lower focus score (median split).
  let contactByFocus = null;
  const lab = scored.filter((p) => p.contact);
  if (lab.length >= 6) {
    const sortedScores = lab.map((p) => p.score).sort((a, b) => a - b);
    const med = sortedScores[Math.floor(sortedScores.length / 2)];
    const hi = lab.filter((p) => p.score >= med);
    const lo = lab.filter((p) => p.score < med);
    if (hi.length && lo.length) {
      const rate = (g) => g.filter((p) => p.contact === 'good').length / g.length;
      contactByFocus = { high: { n: hi.length, goodRate: rate(hi) }, low: { n: lo.length, goodRate: rate(lo) }, median: med };
    }
  }

  return {
    total: sorted.length,
    valid: valid.length,
    rejected: sorted.length - valid.length,
    series,
    trend,
    contactCounts,
    labeled,
    best: best ? { id: best.id, number: best.number, score: best.motion } : null,
    largestVariation: largestVariation ? { component: largestVariation[0], meanDeviation: largestVariation[1] } : null,
    contactByFocus,
  };
}
