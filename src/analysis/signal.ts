// 1-D signal processing helpers. Pure; arrays may contain NaN for missing samples.

export function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function median(xs: readonly number[]): number {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export function mean(xs: readonly number[]): number {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

/** Sample standard deviation (n-1); NaN for fewer than 2 values. */
export function std(xs: readonly number[]): number {
  const v = xs.filter(isNum);
  if (v.length < 2) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function percentile(xs: readonly number[], p: number): number {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const idx = Math.min(v.length - 1, Math.max(0, (v.length - 1) * p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo]! + (v[hi]! - v[lo]!) * (idx - lo);
}

/** Index of the maximum finite value in [from, to] (inclusive); -1 if none. */
export function argmax(xs: readonly number[], from = 0, to = xs.length - 1): number {
  let best = -1;
  let bv = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(xs.length - 1, to); i++) {
    const v = xs[i]!;
    if (isNum(v) && v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

/**
 * Time of the peak at index `i`, refined between samples by fitting a
 * parabola through it and its two neighbors. Falls back to t[i].
 */
export function subSamplePeakTime(t: readonly number[], xs: readonly number[], i: number): number {
  const a = xs[i - 1];
  const b = xs[i];
  const c = xs[i + 1];
  const ti = t[i]!;
  if (!isNum(a) || !isNum(b) || !isNum(c) || i + 1 >= t.length) return ti;
  const d = a + c - 2 * b;
  if (!(d < 0)) return ti;
  const offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d));
  return ti + offset * (t[i + 1]! - ti);
}

export function argmin(xs: readonly number[], from = 0, to = xs.length - 1): number {
  return argmax(
    xs.map((v) => -v),
    from,
    to,
  );
}

/**
 * Linearly interpolate interior gaps of at most `maxGap` samples. Longer gaps
 * and leading/trailing gaps stay NaN (never invent long missing sections).
 */
export function fillGaps(values: readonly number[], maxGap: number): number[] {
  const out = values.slice();
  let k = 0;
  while (k < out.length) {
    if (isNum(out[k])) {
      k++;
      continue;
    }
    const a = k - 1;
    let b = k;
    while (b < out.length && !isNum(out[b])) b++;
    if (a >= 0 && b < out.length && b - k <= maxGap) {
      for (let j = k; j < b; j++) out[j] = out[a]! + ((out[b]! - out[a]!) * (j - a)) / (b - a);
    }
    k = b;
  }
  return out;
}

/** Fill leading/trailing NaN with the nearest finite value (used only before filtering). */
export function holdEdges(values: readonly number[]): number[] {
  const out = values.slice();
  const first = out.findIndex(isNum);
  if (first < 0) return out;
  let last = out.length - 1;
  while (!isNum(out[last])) last--;
  for (let i = 0; i < first; i++) out[i] = out[first]!;
  for (let i = last + 1; i < out.length; i++) out[i] = out[last]!;
  return out;
}

export interface Biquad {
  b: [number, number, number];
  a: [number, number];
}

/**
 * Second-order Butterworth low-pass coefficients (bilinear transform with
 * frequency pre-warping).
 */
export function butterworth2(cutoffHz: number, fs: number): Biquad {
  const k = Math.tan((Math.PI * cutoffHz) / fs);
  const k2 = k * k;
  const norm = 1 / (1 + Math.SQRT2 * k + k2);
  const b0 = k2 * norm;
  return {
    b: [b0, 2 * b0, b0],
    a: [2 * (k2 - 1) * norm, (1 - Math.SQRT2 * k + k2) * norm],
  };
}

function biquadPass(x: readonly number[], { b, a }: Biquad): number[] {
  const y = new Array<number>(x.length);
  // Initialize the state at steady state for x[0] to avoid a start transient.
  let x1 = x[0]!;
  let x2 = x[0]!;
  let y1 = x[0]!;
  let y2 = x[0]!;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = b[0] * xi + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

/**
 * Zero-lag low-pass filter: 2nd-order Butterworth applied forward and backward
 * (effective 4th order, no phase shift). The cutoff is corrected for the double
 * pass (Winter 2009: fc / 0.802) so that -3 dB lands at `cutoffHz`.
 * Edges are padded by odd reflection. NaN samples are not allowed here; fill
 * them first. Returns a copy unchanged if the cutoff is at/above Nyquist.
 */
export function lowpassZeroLag(x: readonly number[], cutoffHz: number, fs: number): number[] {
  const n = x.length;
  if (n < 4) return x.slice();
  const fc = cutoffHz / 0.802;
  if (fc >= fs * 0.45) return x.slice();
  const coeffs = butterworth2(fc, fs);
  const pad = Math.min(n - 1, Math.max(6, Math.round((3 * fs) / cutoffHz)));
  const padded: number[] = [];
  for (let i = pad; i >= 1; i--) padded.push(2 * x[0]! - x[i]!);
  for (const v of x) padded.push(v);
  for (let i = n - 2; i >= n - 1 - pad; i--) padded.push(2 * x[n - 1]! - x[i]!);
  const fwd = biquadPass(padded, coeffs);
  const back = biquadPass(fwd.reverse(), coeffs).reverse();
  return back.slice(pad, pad + n);
}

/** Central-difference derivative of uniformly sampled data (units per second). */
export function derivative(x: readonly number[], fs: number): number[] {
  const n = x.length;
  return x.map((_, i) => {
    if (n < 2) return 0;
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    return ((x[b]! - x[a]!) * fs) / (b - a);
  });
}

/** Linear interpolation of (times, values) at query time tq; NaN outside or across gaps. */
export function interpAt(times: readonly number[], values: readonly number[], tq: number): number {
  const n = times.length;
  if (!n || tq < times[0]! - 1e-9 || tq > times[n - 1]! + 1e-9) return NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= tq) lo = mid;
    else hi = mid;
  }
  if (Math.abs(times[lo]! - tq) < 1e-9) return values[lo]!;
  if (Math.abs(times[hi]! - tq) < 1e-9) return values[hi]!;
  return (
    values[lo]! + ((values[hi]! - values[lo]!) * (tq - times[lo]!)) / (times[hi]! - times[lo]!)
  );
}

/** Median of consecutive positive time differences, as a frame rate. */
export function estimateFps(times: readonly number[]): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const dt = times[i]! - times[i - 1]!;
    if (dt > 1e-6) d.push(dt);
  }
  const m = median(d);
  return isNum(m) && m > 0 ? 1 / m : NaN;
}
