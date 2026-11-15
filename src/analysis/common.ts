// Shared building blocks for batting and pitching analysis.
import { LM } from './landmarks';
import type { Tracks } from './tracks';
import { argmax, derivative, isNum, mean, median, percentile } from './signal';
import type { MetricResult } from './types';

export const ENGINE_VERSION = '1.0.0';

export const DEFAULT_POSITION_CUTOFF_HZ = 12;
export const DEFAULT_SPEED_CUTOFF_HZ = 20;
/** Cutoffs are capped at this fraction of the sampling rate. */
export const MAX_CUTOFF_FRACTION = 0.4;

export function cutoffs(fs: number, pos?: number, speed?: number) {
  const cap = MAX_CUTOFF_FRACTION * fs;
  return {
    position: Math.min(pos ?? DEFAULT_POSITION_CUTOFF_HZ, cap),
    speed: Math.min(speed ?? DEFAULT_SPEED_CUTOFF_HZ, cap),
  };
}

export interface Side {
  hip: number;
  knee: number;
  ankle: number;
  heel: number;
  shoulder: number;
  elbow: number;
  wrist: number;
}

export const LEFT: Side = {
  hip: LM.L_HIP,
  knee: LM.L_KNEE,
  ankle: LM.L_ANKLE,
  heel: LM.L_HEEL,
  shoulder: LM.L_SHOULDER,
  elbow: LM.L_ELBOW,
  wrist: LM.L_WRIST,
};
export const RIGHT: Side = {
  hip: LM.R_HIP,
  knee: LM.R_KNEE,
  ankle: LM.R_ANKLE,
  heel: LM.R_HEEL,
  shoulder: LM.R_SHOULDER,
  elbow: LM.R_ELBOW,
  wrist: LM.R_WRIST,
};

/**
 * The stride (lead) leg is the one whose ankle travels farther horizontally.
 * Forward is the direction that ankle moves (+1 = image right).
 */
export function findLeadLeg(tr: Tracks): { lead: Side; rear: Side; forward: 1 | -1 } {
  const range = (idx: number) => {
    const x = tr.pos(idx).x;
    return percentile(x, 0.95) - percentile(x, 0.05);
  };
  const leftRange = range(LM.L_ANKLE);
  const rightRange = range(LM.R_ANKLE);
  const lead =
    (isNum(rightRange) ? rightRange : -1) > (isNum(leftRange) ? leftRange : -1) ? RIGHT : LEFT;
  const rear = lead === LEFT ? RIGHT : LEFT;
  const x = tr.pos(lead.ankle).x;
  const refN = Math.max(3, Math.round(tr.n * 0.1));
  const ref = median(x.slice(0, refN));
  let best = 0;
  for (const v of x) if (isNum(v) && Math.abs(v - ref) > Math.abs(best)) best = v - ref;
  return { lead, rear, forward: best >= 0 ? 1 : -1 };
}

/** Speed of a landmark track normalized by torso length (torso/s). */
export function normSpeed(tr: Tracks, idx: number, useFast = false): number[] {
  const track = useFast ? tr.fast(idx) : tr.pos(idx);
  const vx = derivative(track.x, tr.fs);
  const vy = derivative(track.y, tr.fs);
  return vx.map((v, i) => Math.hypot(v, vy[i]!) / tr.torso);
}

/** Midpoint-of-wrists speed (torso/s); falls back to a single wrist when one is missing. */
export function handSpeed(
  tr: Tracks,
  wrists: [number, number] = [LM.L_WRIST, LM.R_WRIST],
): number[] {
  const a = tr.fast(wrists[0]);
  const b = tr.fast(wrists[1]);
  const hx = a.x.map((v, i) => avg2(v, b.x[i]!));
  const hy = a.y.map((v, i) => avg2(v, b.y[i]!));
  const vx = derivative(hx, tr.fs);
  const vy = derivative(hy, tr.fs);
  return vx.map((v, i) => Math.hypot(v, vy[i]!) / tr.torso);
}

function avg2(a: number, b: number): number {
  if (isNum(a) && isNum(b)) return (a + b) / 2;
  return isNum(a) ? a : b;
}

/** Last index at or before `from` (searching backward) where `xs` drops to `thr` or below. */
export function onsetBefore(xs: number[], from: number, thr: number, stop = 0): number {
  for (let i = from; i >= stop; i--) if (!isNum(xs[i]) || xs[i]! <= thr) return i;
  return stop;
}

/** First index after `from` where `xs` drops to `thr` or below; -1 if none. */
export function firstBelowAfter(
  xs: number[],
  from: number,
  thr: number,
  to = xs.length - 1,
): number {
  for (let i = from + 1; i <= to; i++) if (isNum(xs[i]) && xs[i]! <= thr) return i;
  return -1;
}

/** Mean visibility of the given landmarks at the given grid indices. */
export function confidenceAt(tr: Tracks, landmarks: number[], indices: number[]): number {
  const vals: number[] = [];
  for (const k of landmarks) for (const i of indices) vals.push(tr.pos(k).v[i] ?? 0);
  const m = mean(vals);
  return isNum(m) ? Math.round(m * 100) / 100 : 0;
}

/** Median position over grid indices [a, b]. */
export function medianPos(tr: Tracks, idx: number, a: number, b: number) {
  const tk = tr.pos(idx);
  return { x: median(tk.x.slice(a, b + 1)), y: median(tk.y.slice(a, b + 1)) };
}

export function metric(
  value: number,
  unit: string,
  confidence: number,
  extra: Partial<MetricResult> = {},
): MetricResult | null {
  if (!isNum(value)) return null;
  const digits = unit === 'deg' || unit === 'ms' ? 1 : 3;
  const f = 10 ** digits;
  return { value: Math.round(value * f) / f, unit, confidence, ...extra };
}

export function ms(seconds: number): number {
  return seconds * 1000;
}

/**
 * Rotation-onset proxy for the experimental pelvis/shoulder sequence: when a
 * segment rotates away from facing the camera, its projected width shrinks.
 * Returns the onset index (rate first exceeds 30% of its peak before the peak).
 */
export function widthClosingOnset(
  tr: Tracks,
  a: number,
  b: number,
  from: number,
  to: number,
): { onset: number; peakRate: number } | null {
  const w = tr.pos(a).x.map((xa, i) => Math.abs(xa - tr.pos(b).x[i]!) / tr.torso);
  const rate = derivative(w, tr.fs).map((v) => -v);
  const peak = argmax(rate, from, to);
  if (peak < 0 || !(rate[peak]! > 0.3)) return null;
  const onset = onsetBefore(
    rate,
    peak,
    0.3 * rate[peak]!,
    Math.max(0, from - Math.round(0.2 * tr.fs)),
  );
  return { onset, peakRate: rate[peak]! };
}
