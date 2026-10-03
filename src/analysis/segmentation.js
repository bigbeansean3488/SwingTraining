// Swing segmentation: find the individual swings in one long practice
// recording ("start recording, hit N balls, analyze"). Pure, no DOM.
//
// Input is a (possibly coarsely sampled) PoseSequence covering the whole
// recording. Output is one analysis window per candidate swing; each window
// is then re-extracted at full frame rate and analyzed by analyzeSwing().
// Definitions: docs/metric-definitions.md §8.
import { normalizeSwing, relativeToPelvis } from './normalize.js';
import { speed2d, median } from './signal.js';

export const SEGMENT_DEFAULTS = Object.freeze({
  minPeakSpeed: 5.0,   // T/s, hands relative to pelvis: below this it is not a swing (provisional)
  bridgeGap: 0.3,      // s: above-threshold runs separated by less than this are one motion
  minGap: 2.5,         // s: peaks closer than this are one swing (the larger peak wins)
  preRoll: 2.5,        // s before the peak included in the analysis window
  postRoll: 1.5,       // s after the peak included in the analysis window
  minCoverage: 0.5,    // fraction of frames with tracked hands in [peak − 1 s, peak + 0.5 s]
  scaleWindow: 1.0,    // s: half-width of the rolling torso-length median (body scale may drift)
  smoothWindow: 1,     // frames; no smoothing: coarse sampling already blunts the peak
});

/** Rolling median of `values` over [t − w, t + w] for each sample time. */
function rollingMedian(times, values, w) {
  const out = new Array(times.length).fill(null);
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < times.length; k++) {
    while (times[lo] < times[k] - w) lo++;
    while (hi < times.length && times[hi] <= times[k] + w) hi++;
    out[k] = median(values.slice(lo, hi));
  }
  return out;
}

/**
 * Hand speed relative to the pelvis, in local torso lengths per second.
 * Pelvis-relative so that walking / stepping around between swings does not
 * look like a swing; local scale so that moving toward or away from the
 * camera does not change the threshold.
 */
export function handSpeedSignal(seq, o = SEGMENT_DEFAULTS) {
  const norm = normalizeSwing(seq, { smoothWindow: o.smoothWindow });
  if (!norm.ok) return { ok: false, reason: norm.reason, times: norm.times ?? [], speed: [] };
  const { times } = norm;
  const rel = relativeToPelvis(norm, 'hands');
  const sh = norm.points.shoulderMid;
  const pel = norm.points.pelvis;
  const torso = times.map((_, k) => (sh.x[k] === null || pel.x[k] === null ? null : Math.hypot(sh.x[k] - pel.x[k], sh.y[k] - pel.y[k])));
  const scale = rollingMedian(times, torso, o.scaleWindow);
  const raw = speed2d(times, rel.x, rel.y);
  const speed = raw.map((v, k) => (v === null || !scale[k] ? null : v / scale[k]));
  return { ok: true, times, speed, tracked: norm.tracked.hands };
}

/**
 * Find candidate swings.
 * @returns {{ ok, reason?, swings: {peak, peakSpeed, window: [number, number], coverage}[], rejected: object[], signals, params }}
 */
export function findSwings(seq, overrides = {}) {
  const o = { ...SEGMENT_DEFAULTS, ...overrides };
  const sig = handSpeedSignal(seq, o);
  if (!sig.ok) return { ok: false, reason: `body not tracked: ${sig.reason}`, swings: [], rejected: [], signals: sig, params: o };
  const { times, speed } = sig;

  // 1. Runs of fast hand motion (short dips bridged), one peak per run.
  const runs = [];
  let cur = null;
  for (let k = 0; k < times.length; k++) {
    if (speed[k] === null || speed[k] < o.minPeakSpeed) continue;
    if (cur && times[k] - times[cur.last] <= o.bridgeGap) {
      cur.last = k;
      if (speed[k] > speed[cur.peak]) cur.peak = k;
    } else {
      cur = { first: k, last: k, peak: k };
      runs.push(cur);
    }
  }

  // 2. Merge peaks closer than minGap (follow-through / bat recoil after a swing).
  const peaks = [];
  for (const r of runs) {
    const p = { k: r.peak, t: times[r.peak], v: speed[r.peak] };
    const prev = peaks[peaks.length - 1];
    if (prev && p.t - prev.t < o.minGap) {
      if (p.v > prev.v) peaks[peaks.length - 1] = p;
    } else {
      peaks.push(p);
    }
  }

  // 3. Tracking coverage around each peak; windows clipped halfway to neighbors
  //    so a window never contains the fastest part of another swing.
  const swings = [];
  const rejected = [];
  const t0 = times[0];
  const t1 = times[times.length - 1];
  for (const [i, p] of peaks.entries()) {
    const near = times.map((t, k) => (t >= p.t - 1 && t <= p.t + 0.5 ? k : -1)).filter((k) => k >= 0);
    const coverage = near.filter((k) => sig.tracked[k]).length / Math.max(1, near.length);
    const lo = Math.max(t0, p.t - o.preRoll, i > 0 ? (peaks[i - 1].t + p.t) / 2 : -Infinity);
    const hi = Math.min(t1, p.t + o.postRoll, i < peaks.length - 1 ? (p.t + peaks[i + 1].t) / 2 : Infinity);
    const cand = { peak: round3(p.t), peakSpeed: round3(p.v), window: [round3(lo), round3(hi)], coverage: round3(coverage) };
    if (coverage < o.minCoverage) rejected.push({ ...cand, reason: 'hands not tracked around the peak' });
    else swings.push(cand);
  }
  return { ok: true, swings, rejected, signals: sig, params: o };
}

/** Frames of `seq` within [t0, t1] as a new PoseSequence. */
export function sliceSequence(seq, t0, t1) {
  return { ...seq, start: t0, end: t1, frames: seq.frames.filter((f) => f.t >= t0 - 1e-9 && f.t <= t1 + 1e-9) };
}

function round3(v) { return Math.round(v * 1000) / 1000; }
