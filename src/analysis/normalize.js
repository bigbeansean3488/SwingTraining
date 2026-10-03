// Spatial + temporal normalization of a PoseSequence. Pure, no DOM.
// Formulas are documented in docs/metric-definitions.md §2.
import { LM, VIS_THRESHOLD } from '../pose/landmarks.js';
import { fillShortGaps, movingAverage, interpAt, linspace, median } from './signal.js';

/** Derived points tracked through normalization. */
export const POINTS = [
  'head', 'shoulderMid', 'pelvis', 'hands',
  'leadWrist', 'rearWrist', 'leadElbow', 'rearElbow',
  'leadShoulder', 'rearShoulder', 'leadHip', 'rearHip',
  'leadKnee', 'rearKnee', 'leadAnkle', 'rearAnkle',
];

export const NORMALIZE_DEFAULTS = Object.freeze({
  visThreshold: VIS_THRESHOLD,
  maxGapFrames: 3,      // interpolate gaps up to this many frames
  smoothWindow: 3,      // centered moving average (frames); 1 = off
  originFraction: 0.1,  // stance reference = first 10% of the window...
  originMinFrames: 3,   // ...but at least this many frames
  minStrideForDirection: 0.15, // T; below this the stride can't define direction
  headNoseMinCoverage: 0.8,    // use nose as head proxy if tracked this often, else ear midpoint
});

const side = (s, name) => LM[`${s}_${name}`];

function rawPoint(lm, i, W, H, thr) {
  const p = lm[i];
  return p[3] >= thr ? [p[0] * W, p[1] * H] : null;
}

/** Midpoint of two landmarks if at least one is tracked (MediaPipe still estimates the other). */
function midPoint(lm, a, b, W, H, thr) {
  if (lm[a][3] < thr && lm[b][3] < thr) return null;
  return [((lm[a][0] + lm[b][0]) / 2) * W, ((lm[a][1] + lm[b][1]) / 2) * H];
}

/** Visibility-weighted mean of both wrists: label-independent "hands" point. */
function handsPoint(lm, W, H, thr) {
  const l = lm[LM.LEFT_WRIST];
  const r = lm[LM.RIGHT_WRIST];
  if (l[3] < thr && r[3] < thr) return null;
  const wl = l[3];
  const wr = r[3];
  return [((l[0] * wl + r[0] * wr) / (wl + wr)) * W, ((l[1] * wl + r[1] * wr) / (wl + wr)) * H];
}

function pickWindow(seq, t0, t1) {
  const lo = t0 ?? -Infinity;
  const hi = t1 ?? Infinity;
  return seq.frames.filter((f) => f.t >= lo - 1e-9 && f.t <= hi + 1e-9);
}

/**
 * Build pixel tracks for every derived point. Lead/rear assignment is decided
 * once per sequence (from which ankle travels further), not per frame.
 */
function pixelTracks(frames, W, H, opts) {
  const thr = opts.visThreshold;
  const get = (fn) => frames.map((f) => (f.lm ? fn(f.lm) : null));
  const ankle = {
    LEFT: get((lm) => rawPoint(lm, LM.LEFT_ANKLE, W, H, thr)),
    RIGHT: get((lm) => rawPoint(lm, LM.RIGHT_ANKLE, W, H, thr)),
  };
  const travel = (track) => {
    const xs = track.filter(Boolean).map((p) => p[0]);
    if (xs.length < 2) return { range: 0, net: 0 };
    const start = median(xs.slice(0, Math.max(1, Math.ceil(xs.length * 0.1))));
    let best = 0;
    for (const x of xs) if (Math.abs(x - start) > Math.abs(best)) best = x - start;
    return { range: Math.abs(best), net: best };
  };
  const tl = travel(ankle.LEFT);
  const tr = travel(ankle.RIGHT);
  const lead = tl.range >= tr.range ? 'LEFT' : 'RIGHT';
  const rear = lead === 'LEFT' ? 'RIGHT' : 'LEFT';

  const noseTrack = get((lm) => rawPoint(lm, LM.NOSE, W, H, thr));
  const noseCov = noseTrack.filter(Boolean).length / Math.max(1, frames.length);
  const headProxy = noseCov >= opts.headNoseMinCoverage ? 'nose' : 'earMid';

  const tracks = {
    head: headProxy === 'nose' ? noseTrack : get((lm) => midPoint(lm, LM.LEFT_EAR, LM.RIGHT_EAR, W, H, thr)),
    shoulderMid: get((lm) => midPoint(lm, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, W, H, thr)),
    pelvis: get((lm) => midPoint(lm, LM.LEFT_HIP, LM.RIGHT_HIP, W, H, thr)),
    hands: get((lm) => handsPoint(lm, W, H, thr)),
  };
  for (const [role, s] of [['lead', lead], ['rear', rear]]) {
    for (const name of ['Wrist', 'Elbow', 'Shoulder', 'Hip', 'Knee', 'Ankle']) {
      tracks[`${role}${name}`] = get((lm) => rawPoint(lm, side(s, name.toUpperCase()), W, H, thr));
    }
  }
  return { tracks, lead, leadTravelPx: lead === 'LEFT' ? tl : tr, headProxy };
}

/**
 * Normalize the frames of `seq` within [t0, t1].
 *
 * x' = d · (X − Ox) / T,   y' = (Y − Oy) / T
 *   (X, Y)  pixel coordinates
 *   T       median torso length (|shoulderMid − pelvis|) over the window, px
 *   O       median pelvis position over the stance reference frames
 *   d       +1 / −1 so that +x points toward the pitcher (stride direction)
 *
 * @returns normalized swing (see docs/metric-definitions.md §2)
 */
export function normalizeSwing(seq, { t0, t1, ...overrides } = {}) {
  const opts = { ...NORMALIZE_DEFAULTS, ...overrides };
  const frames = pickWindow(seq, t0, t1);
  const { width: W, height: H } = seq;
  const times = frames.map((f) => f.t);
  const { tracks, lead, leadTravelPx, headProxy } = pixelTracks(frames, W, H, opts);

  const torso = tracks.shoulderMid.map((s, k) => (s && tracks.pelvis[k] ? Math.hypot(s[0] - tracks.pelvis[k][0], s[1] - tracks.pelvis[k][1]) : null));
  const T = median(torso);
  if (!T) return { ok: false, reason: 'torso not tracked', times, n: frames.length };

  const nRef = Math.min(frames.length, Math.max(opts.originMinFrames, Math.ceil(frames.length * opts.originFraction)));
  const refPelvis = tracks.pelvis.slice(0, nRef).filter(Boolean);
  if (!refPelvis.length) return { ok: false, reason: 'pelvis not tracked at start', times, n: frames.length };
  const origin = [median(refPelvis.map((p) => p[0])), median(refPelvis.map((p) => p[1]))];

  let direction = 1;
  let directionSource = 'default';
  if (leadTravelPx.range / T >= opts.minStrideForDirection) {
    direction = Math.sign(leadTravelPx.net) || 1;
    directionSource = 'stride';
  } else {
    const pel = tracks.pelvis.filter(Boolean);
    const net = pel.length ? pel[pel.length - 1][0] - origin[0] : 0;
    if (Math.abs(net) / T >= 0.05) { direction = Math.sign(net); directionSource = 'pelvis'; }
  }

  const points = {};
  const coverage = {};
  for (const name of POINTS) {
    const tr = tracks[name];
    coverage[name] = tr.filter(Boolean).length / Math.max(1, tr.length);
    let xs = tr.map((p) => (p ? (direction * (p[0] - origin[0])) / T : null));
    let ys = tr.map((p) => (p ? (p[1] - origin[1]) / T : null));
    xs = fillShortGaps(xs, opts.maxGapFrames);
    ys = fillShortGaps(ys, opts.maxGapFrames);
    if (opts.smoothWindow > 1) { xs = movingAverage(xs, opts.smoothWindow); ys = movingAverage(ys, opts.smoothWindow); }
    points[name] = { x: xs, y: ys };
  }

  return {
    ok: true,
    times,
    T,
    origin,
    direction,
    directionSource,
    lead,
    headProxy,
    points,
    coverage,
  };
}

/** Express a normalized point relative to the per-frame pelvis (body-centered, moving origin). */
export function relativeToPelvis(norm, name) {
  const p = norm.points[name];
  const pel = norm.points.pelvis;
  return {
    x: p.x.map((v, k) => (v === null || pel.x[k] === null ? null : v - pel.x[k])),
    y: p.y.map((v, k) => (v === null || pel.y[k] === null ? null : v - pel.y[k])),
  };
}

/**
 * Temporal normalization: resample the window [ta, tb] onto n uniform steps
 * u ∈ [0, 1]. Optional `anchors` ([{t, u}], increasing) define a
 * piecewise-linear time warp so detected events land on fixed u values.
 *
 * @returns {{ n, u, points: Record<string, ([number, number] | null)[]> , missing: Record<string, number> }}
 */
export function resampleSwing(norm, { ta = norm.times[0], tb = norm.times[norm.times.length - 1], n = 101, names = POINTS, anchors } = {}) {
  const u = linspace(0, 1, n);
  const warp = anchors?.length ? [{ t: ta, u: 0 }, ...anchors, { t: tb, u: 1 }] : [{ t: ta, u: 0 }, { t: tb, u: 1 }];
  const tOf = (uq) => {
    let j = 0;
    while (j < warp.length - 2 && uq > warp[j + 1].u) j++;
    const a = warp[j];
    const b = warp[j + 1];
    return a.t + ((b.t - a.t) * (uq - a.u)) / (b.u - a.u);
  };
  const tq = u.map(tOf);
  const points = {};
  const missing = {};
  for (const name of names) {
    const { x, y } = norm.points[name];
    points[name] = tq.map((t) => {
      const px = interpAt(norm.times, x, t);
      const py = interpAt(norm.times, y, t);
      return px === null || py === null ? null : [px, py];
    });
    missing[name] = points[name].filter((p) => p === null).length;
  }
  return { n, u, points, missing };
}

/**
 * Mean point-wise Euclidean distance (T units) between two resampled
 * trajectories of the same point, over samples present in both.
 * Returns null if fewer than half the samples overlap.
 */
export function trajectoryDistance(a, b) {
  let s = 0;
  let c = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!a[i] || !b[i]) continue;
    s += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
    c++;
  }
  return c >= Math.min(a.length, b.length) / 2 ? s / c : null;
}
