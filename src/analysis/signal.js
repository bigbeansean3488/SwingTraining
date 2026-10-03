// 1-D signal helpers. Pure. Arrays may contain null for missing samples.

/**
 * Linearly interpolate interior gaps of at most `maxGap` consecutive nulls.
 * Longer gaps and leading/trailing nulls stay null (never invent large
 * missing sections).
 */
export function fillShortGaps(values, maxGap) {
  const out = values.slice();
  let k = 0;
  while (k < out.length) {
    if (out[k] !== null) { k++; continue; }
    const a = k - 1;
    let b = k;
    while (b < out.length && out[b] === null) b++;
    const len = b - k;
    if (a >= 0 && b < out.length && len <= maxGap) {
      for (let j = k; j < b; j++) out[j] = out[a] + ((out[b] - out[a]) * (j - a)) / (b - a);
    }
    k = b;
  }
  return out;
}

/**
 * Centered moving average over an odd window. Samples whose window contains a
 * null are averaged over the available values; null stays null.
 */
export function movingAverage(values, window = 3) {
  const h = Math.floor(window / 2);
  return values.map((v, i) => {
    if (v === null) return null;
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(values.length - 1, i + h); j++) {
      if (values[j] !== null) { s += values[j]; c++; }
    }
    return s / c;
  });
}

/**
 * Linear interpolation of (times, values) at query time tq.
 * Returns null if tq is outside the data or either neighbor is null.
 */
export function interpAt(times, values, tq) {
  const n = times.length;
  if (!n || tq < times[0] - 1e-9 || tq > times[n - 1] + 1e-9) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= tq) lo = mid; else hi = mid;
  }
  if (Math.abs(times[lo] - tq) < 1e-9) return values[lo];
  if (Math.abs(times[hi] - tq) < 1e-9) return values[hi];
  const a = values[lo];
  const b = values[hi];
  if (a === null || b === null) return null;
  return a + ((b - a) * (tq - times[lo])) / (times[hi] - times[lo]);
}

/** n uniformly spaced samples on [t0, t1] (inclusive). */
export function linspace(t0, t1, n) {
  if (n === 1) return [t0];
  return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
}

export function median(xs) {
  const v = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(xs) {
  const v = xs.filter((x) => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Sample standard deviation (n-1). Null if fewer than 2 values. */
export function std(xs) {
  const v = xs.filter((x) => x !== null && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** Central-difference speed of a 2-D track (units per second); null where undefined. */
export function speed2d(times, xs, ys) {
  const n = times.length;
  return times.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    if (a === b || xs[a] === null || xs[b] === null || ys[a] === null || ys[b] === null) return null;
    return Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) / (times[b] - times[a]);
  });
}
