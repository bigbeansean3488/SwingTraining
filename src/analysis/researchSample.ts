// Reference distributions from the OpenBiomechanics Project (OBP), computed
// offline by scripts/obp/ with this engine (see docs/REFERENCE_DATA.md).
// Pure lookups: where a value sits in the research sample. Not a score.
import data from './research/obp-ranges.json';
import type { MotionKind } from './types';

export interface GroupRange {
  n: number;
  p25: number;
  p50: number;
  p75: number;
}

export interface ReferenceRange {
  /** Athletes in the sample (each athlete averaged over their trials). */
  n: number;
  /** Quantiles at 0%, 5%, ..., 100%. */
  q: number[];
  /** Middle 50% (P25-P75). */
  common: [number, number];
  /** Middle 80% (P10-P90); outside it is "rare" in the sample. */
  usual: [number, number];
  outcome: { rho: number; p: number; significant?: boolean };
  /** Middle 50% of the top third by pitch speed / exit velocity; null unless associated. */
  highOutcome: GroupRange | null;
  groups: Partial<Record<string, GroupRange>>;
}

export interface ReferenceSample {
  engineVersion: string;
  analyzedFps: number;
  athletes: number;
  trials: number;
  levels: Record<string, number>;
  metrics: Record<string, ReferenceRange>;
}

export interface ReferenceSource {
  name: string;
  author: string;
  url: string;
  license: string;
  licenseUrl: string;
  changes: string;
}

const table = data as unknown as {
  source: ReferenceSource;
  generated: string;
  pitching: ReferenceSample;
  batting: ReferenceSample;
};

export const REFERENCE_SOURCE: ReferenceSource = table.source;

const major = (v: string) => v.split('.')[0];

/** The research sample for a motion kind, or null if built by another engine major. */
export function referenceSample(kind: MotionKind, engineVersion: string): ReferenceSample | null {
  const s = table[kind];
  return s && major(s.engineVersion) === major(engineVersion) ? s : null;
}

export function referenceRange(
  kind: MotionKind,
  key: string,
  engineVersion: string,
): ReferenceRange | null {
  return referenceSample(kind, engineVersion)?.metrics[key] ?? null;
}

/**
 * Percentile rank (PR, 1..99) of `value` in the sample: the share of athletes
 * with a smaller value, interpolated between the stored 5% quantiles.
 */
export function percentileRank(r: ReferenceRange, value: number): number {
  const q = r.q;
  const last = q.length - 1;
  let p: number;
  if (value <= q[0]!) p = 0;
  else if (value >= q[last]!) p = 100;
  else {
    let i = 0;
    while (i < last - 1 && value > q[i + 1]!) i++;
    const lo = q[i]!;
    const hi = q[i + 1]!;
    const f = hi > lo ? (value - lo) / (hi - lo) : 0.5;
    p = ((i + f) / last) * 100;
  }
  return Math.min(99, Math.max(1, Math.round(p)));
}

/** rare_low < P10 <= low < P25 <= common <= P75 < high <= P90 < rare_high */
export type ReferenceBand = 'rare_low' | 'low' | 'common' | 'high' | 'rare_high';

export function referenceBand(r: ReferenceRange, value: number): ReferenceBand {
  if (value < r.usual[0]) return 'rare_low';
  if (value < r.common[0]) return 'low';
  if (value <= r.common[1]) return 'common';
  if (value <= r.usual[1]) return 'high';
  return 'rare_high';
}
