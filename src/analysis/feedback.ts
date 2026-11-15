// Rule-based feedback: compares a result with the athlete's OWN history.
// Describes direction (higher / lower / similar), position within the own
// range and difference from own "good" references only; never a
// good/bad judgement, never injury or medical statements.
import { isNum, mean, std } from './signal';
import type { Metrics } from './types';

export const MIN_HISTORY = 3;
/** Smallest change worth mentioning, per unit (below this: "similar"). */
export const MIN_DELTA: Record<string, number> = {
  torso: 0.05,
  deg: 3,
  ms: 20,
  'torso/s': 1,
};

export type Trend = 'higher' | 'lower' | 'similar';
export type Stability = 'more_stable' | 'less_stable' | 'unchanged';

export interface MetricFeedback {
  key: string;
  trend: Trend;
  value: number;
  baselineMean: number;
  baselineSd: number;
  n: number;
}

export interface FeedbackReport {
  enoughHistory: boolean;
  historyCount: number;
  metrics: MetricFeedback[];
  /** Per metric: whether the last 5 (incl. current) vary less than before. Needs >= 8 results. */
  stability: Record<string, Stability>;
}

/**
 * @param current metrics of the analysis being viewed
 * @param history metrics of earlier comparable analyses, oldest first
 */
export function compareWithHistory(current: Metrics, history: Metrics[]): FeedbackReport {
  const out: FeedbackReport = {
    enoughHistory: history.length >= MIN_HISTORY,
    historyCount: history.length,
    metrics: [],
    stability: {},
  };
  if (!out.enoughHistory) return out;
  for (const [key, m] of Object.entries(current)) {
    const past = history.map((h) => h[key]?.value).filter(isNum);
    if (past.length < MIN_HISTORY) continue;
    const mu = mean(past);
    const sd = std(past);
    const thr = Math.max(isNum(sd) ? sd : 0, MIN_DELTA[m.unit] ?? 0);
    const diff = m.value - mu;
    out.metrics.push({
      key,
      trend: Math.abs(diff) <= thr ? 'similar' : diff > 0 ? 'higher' : 'lower',
      value: m.value,
      baselineMean: round(mu),
      baselineSd: round(isNum(sd) ? sd : 0),
      n: past.length,
    });
    const series = [...past, m.value];
    if (series.length >= 8) {
      const recent = std(series.slice(-5));
      const before = std(series.slice(0, -5));
      if (isNum(recent) && isNum(before) && before > 0) {
        const ratio = recent / before;
        out.stability[key] =
          ratio < 0.7 ? 'more_stable' : ratio > 1.4 ? 'less_stable' : 'unchanged';
      }
    }
  }
  return out;
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Position within the athlete's own range
// ---------------------------------------------------------------------------

export type RangePosition = 'below' | 'low' | 'middle' | 'high' | 'above';

export interface RangeReport {
  min: number;
  max: number;
  mean: number;
  n: number;
  position: RangePosition;
}

/**
 * Where `value` falls among the athlete's own earlier values: outside the range
 * (below / above) or in the lower, middle or upper third of it.
 * Needs at least MIN_HISTORY earlier values.
 */
export function positionInRange(value: number, past: number[]): RangeReport | null {
  const xs = past.filter(isNum);
  if (xs.length < MIN_HISTORY || !isNum(value)) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min;
  let position: RangePosition;
  if (value < min) position = 'below';
  else if (value > max) position = 'above';
  else if (span === 0) position = 'middle';
  else {
    const f = (value - min) / span;
    position = f < 1 / 3 ? 'low' : f > 2 / 3 ? 'high' : 'middle';
  }
  return { min: round(min), max: round(max), mean: round(mean(xs)), n: xs.length, position };
}

// ---------------------------------------------------------------------------
// Comparison with the athlete's own analyses marked as "good"
// ---------------------------------------------------------------------------

export interface ReferenceDiff {
  key: string;
  trend: Trend;
  value: number;
  refMean: number;
  /** Number of references that have this metric. */
  n: number;
  /** |difference| divided by the "similar" threshold; used only for ordering. */
  size: number;
}

export interface ReferenceReport {
  count: number;
  metrics: ReferenceDiff[];
}

/**
 * Compare a result with the athlete's own analyses that they (or their coach)
 * marked as good. The threshold for "similar" is the larger of the spread among
 * the references and the per-unit minimum change. Works from one reference.
 */
export function compareWithReference(current: Metrics, refs: Metrics[]): ReferenceReport {
  const out: ReferenceReport = { count: refs.length, metrics: [] };
  for (const [key, m] of Object.entries(current)) {
    const vals = refs.map((r) => r[key]?.value).filter(isNum);
    if (!vals.length) continue;
    const mu = mean(vals);
    const sd = vals.length > 1 ? std(vals) : NaN;
    const thr = Math.max(isNum(sd) ? sd : 0, MIN_DELTA[m.unit] ?? 0) || 1e-9;
    const diff = m.value - mu;
    out.metrics.push({
      key,
      trend: Math.abs(diff) <= thr ? 'similar' : diff > 0 ? 'higher' : 'lower',
      value: m.value,
      refMean: round(mu),
      n: vals.length,
      size: Math.abs(diff) / thr,
    });
  }
  return out;
}
