// Rule-based feedback: compares a result with the athlete's OWN history.
// Describes direction (higher / lower / similar) and stability only; never a
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
