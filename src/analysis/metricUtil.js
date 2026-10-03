// Shared helpers for individual metrics. Pure.
import { interpAt, median } from './signal.js';

/** Frame indices with t in [t0, t1]. */
export function indicesBetween(times, t0, t1) {
  const out = [];
  for (let k = 0; k < times.length; k++) if (times[k] >= t0 - 1e-9 && times[k] <= t1 + 1e-9) out.push(k);
  return out;
}

/** Fraction of frames in idx where the raw (unfilled) point was tracked. */
export function trackedFraction(norm, name, idx) {
  if (!idx.length) return 0;
  return idx.filter((k) => norm.tracked[name][k]).length / idx.length;
}

/** Median position of a normalized point over frame indices; null if none. */
export function medianPoint(norm, name, idx) {
  const xs = idx.map((k) => norm.points[name].x[k]).filter((v) => v !== null);
  const ys = idx.map((k) => norm.points[name].y[k]).filter((v) => v !== null);
  if (!xs.length || !ys.length) return null;
  return [median(xs), median(ys)];
}

/** Interpolated point position at time t; null if unavailable. */
export function pointAt(norm, name, t) {
  const x = interpAt(norm.times, norm.points[name].x, t);
  const y = interpAt(norm.times, norm.points[name].y, t);
  return x === null || y === null ? null : [x, y];
}

/** Confidence from tracking coverage and QC level (documented in metric-definitions §4). */
export function confidenceFrom(coverage, qcLevel = 'good') {
  const qcFactor = qcLevel === 'good' ? 1 : qcLevel === 'fair' ? 0.7 : 0;
  return Math.round(Math.max(0, Math.min(1, coverage)) * qcFactor * 1000) / 1000;
}

export const round = (v, d = 4) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
