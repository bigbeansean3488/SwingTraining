// Motion consistency score (0–100). Deterministic, transparent, no learning.
// Measures how close the current swing is to the player's recent valid
// swings in ABSOLUTE terms (body units / seconds). It does NOT measure swing
// quality. Definitions: docs/metric-definitions.md §6.
import { METRIC_VALIDATION } from './validation.js';

export const CONSISTENCY_VERSION = 1;

export const CONSISTENCY_PARAMS = Object.freeze({
  // Equal weights: no evidence yet that any component matters more.
  weights: { head: 0.2, stride: 0.2, timing: 0.2, wristPath: 0.2, pose: 0.2 },
  // "Half-score" differences: a component scores 50 when the current swing
  // differs from the baseline by this much. PROVISIONAL — to be calibrated on
  // field data (e.g. to the typical within-player difference of normal swings).
  halfScore: { head: 0.10, stride: 0.15, timing: 0.05, wristPath: 0.10, pose: 0.10 },
});

/**
 * Extract the raw (absolute) differences the score is computed from.
 * These are what gets stored, so the score can be recomputed or revised.
 */
export function consistencyInputs(cmp) {
  if (!cmp?.ok) return null;
  const c = cmp.components;
  const absDiff = (s) => (s ? Math.abs(s.current - s.mean) : null);
  const timingDiffs = [absDiff(c.timing.startToPeak), absDiff(c.timing.plantToPeak)].filter((v) => v !== null);
  return {
    baselineCount: cmp.baselineCount,
    head: absDiff(c.head),                 // T
    stride: absDiff(c.stride),             // T
    timing: timingDiffs.length ? Math.max(...timingDiffs) : null, // s
    wristPath: c.wristPath ? c.wristPath.distance : null,       // T
    pose: c.pose ? c.pose.distance : null,                       // T
  };
}

/** Component score from an absolute difference. */
export function componentScore(diff, halfScore) {
  const d = diff / halfScore;
  return 100 / (1 + d * d);
}

/**
 * Composite score from stored inputs. Missing components are dropped and the
 * remaining weights renormalized (reported in the result).
 */
export function scoreFromInputs(inputs, params = CONSISTENCY_PARAMS) {
  if (!inputs) return { score: null, reason: 'no baseline yet', components: [], version: CONSISTENCY_VERSION, validation: METRIC_VALIDATION.motionConsistency };
  const components = [];
  for (const [name, w] of Object.entries(params.weights)) {
    const diff = inputs[name];
    if (diff === null || diff === undefined) { components.push({ name, diff: null, score: null, weight: w, used: false }); continue; }
    components.push({ name, diff, halfScore: params.halfScore[name], score: componentScore(diff, params.halfScore[name]), weight: w, used: true });
  }
  const used = components.filter((c) => c.used);
  if (!used.length) return { score: null, reason: 'no comparable components', components, version: CONSISTENCY_VERSION, validation: METRIC_VALIDATION.motionConsistency };
  const wsum = used.reduce((a, c) => a + c.weight, 0);
  for (const c of used) c.effectiveWeight = c.weight / wsum;
  const score = used.reduce((a, c) => a + c.effectiveWeight * c.score, 0);
  return {
    score: Math.round(score),
    scoreExact: score,
    baselineCount: inputs.baselineCount,
    components,
    version: CONSISTENCY_VERSION,
    validation: METRIC_VALIDATION.motionConsistency,
  };
}

export function motionConsistency(cmp, params = CONSISTENCY_PARAMS) {
  return scoreFromInputs(consistencyInputs(cmp), params);
}

/** Session-level summary: mean and spread of per-swing scores (swings with a baseline). */
export function sessionConsistency(scores) {
  const v = scores.filter((s) => s !== null && s !== undefined);
  if (!v.length) return { mean: null, count: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { mean, min: Math.min(...v), max: Math.max(...v), count: v.length };
}
