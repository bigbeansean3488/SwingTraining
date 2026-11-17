// Comparison of one analysis with a reference motion (an imitation target such
// as a coach's demonstration; docs/DECISIONS.md D22, docs/METRICS.md §5).
//
// - Time: the two motions are aligned piecewise-linearly between the events
//   both have (e.g. lift top, plant, release), so each phase is stretched to
//   the other's length. Outside the shared events time runs at real speed.
// - Space: each pose is expressed in torso lengths relative to the pelvis
//   (mid-hip) with the motion direction pointing to +x, so body size, camera
//   distance and throwing/hitting side do not matter.
// - Metrics: per-metric difference "you vs reference" with a direction only;
//   no good/bad score.
import { MIN_DELTA } from './feedback';
import { LM, LANDMARK_COUNT } from './landmarks';
import { isNum, median } from './signal';
import type { EventTimes, Landmark, Metrics, MotionKind, PoseSequence } from './types';
import { sameDefinitions } from './versions';

/** Events used for alignment, in motion order. */
export const ALIGN_EVENTS: Record<MotionKind, string[]> = {
  batting: ['load', 'plant', 'contact', 'finish'],
  pitching: ['liftTop', 'plant', 'release', 'finish'],
};

const MIN_VIS = 0.3;

// ---------------------------------------------------------------------------
// Time alignment

export interface TimedMotion {
  /** Event times in media seconds. */
  events: EventTimes;
  /** Real seconds per media second (slow-motion correction); 1 if unknown. */
  timeScale: number;
}

export interface TimeWarp {
  /** Shared events in order; times are media seconds of each clip. */
  anchors: { event: string; user: number; ref: number }[];
  userScale: number;
  refScale: number;
}

const scaleOf = (s: number) => (isNum(s) && s > 0 ? s : 1);

/**
 * Anchors are the events both clips have, kept only while they increase in
 * both clips (an out-of-order event, e.g. after a bad manual correction, is
 * skipped rather than folding time back).
 */
export function buildTimeWarp(kind: MotionKind, user: TimedMotion, ref: TimedMotion): TimeWarp {
  const anchors: TimeWarp['anchors'] = [];
  for (const event of ALIGN_EVENTS[kind]) {
    const u = user.events[event];
    const r = ref.events[event];
    if (!isNum(u) || !isNum(r)) continue;
    const last = anchors[anchors.length - 1];
    if (last && (u <= last.user || r <= last.ref)) continue;
    anchors.push({ event, user: u, ref: r });
  }
  return { anchors, userScale: scaleOf(user.timeScale), refScale: scaleOf(ref.timeScale) };
}

/** Reference media time that corresponds to user media time `t`. */
export function warpTime(w: TimeWarp, t: number): number {
  const a = w.anchors;
  const realRatio = w.userScale / w.refScale;
  if (!a.length) return t * realRatio;
  if (t <= a[0]!.user) return a[0]!.ref + (t - a[0]!.user) * realRatio;
  const last = a[a.length - 1]!;
  if (t >= last.user) return last.ref + (t - last.user) * realRatio;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!;
    const q = a[i]!;
    if (t <= q.user) return p.ref + ((t - p.user) / (q.user - p.user)) * (q.ref - p.ref);
  }
  return last.ref;
}

// ---------------------------------------------------------------------------
// Spatial normalization

export interface NormPoint {
  /** Torso lengths from the pelvis; +x = motion direction. */
  x: number;
  /** Torso lengths from the pelvis; +y = down (image convention). */
  y: number;
  v: number;
}

export interface NormalizedSequence {
  times: number[];
  /** Per frame: 33 points (invisible ones have v = 0), or null without a pelvis. */
  poses: (NormPoint[] | null)[];
  /** Median torso length in pixels; NaN when it could not be measured. */
  torsoPx: number;
}

const visible = (p: Landmark | undefined): p is Landmark => !!p && p.v >= MIN_VIS;

/** Median mid-shoulder to mid-hip distance in pixels over the frames that show both. */
export function torsoLengthPx(seq: PoseSequence): number {
  const ds: number[] = [];
  for (const f of seq.frames) {
    const lm = f.lm;
    if (!lm) continue;
    const ls = lm[LM.L_SHOULDER];
    const rs = lm[LM.R_SHOULDER];
    const lh = lm[LM.L_HIP];
    const rh = lm[LM.R_HIP];
    if (!visible(ls) || !visible(rs) || !visible(lh) || !visible(rh)) continue;
    const sx = ((ls.x + rs.x) / 2) * seq.width;
    const sy = ((ls.y + rs.y) / 2) * seq.height;
    const hx = ((lh.x + rh.x) / 2) * seq.width;
    const hy = ((lh.y + rh.y) / 2) * seq.height;
    ds.push(Math.hypot(sx - hx, sy - hy));
  }
  return ds.length ? median(ds) : NaN;
}

/** One frame in torso units around the pelvis, motion direction to +x. */
export function normalizePose(
  lm: Landmark[] | null,
  size: { width: number; height: number },
  torsoPx: number,
  forward: number,
): NormPoint[] | null {
  if (!lm || !isNum(torsoPx) || torsoPx <= 0) return null;
  const lh = lm[LM.L_HIP];
  const rh = lm[LM.R_HIP];
  if (!visible(lh) || !visible(rh)) return null;
  const f = forward < 0 ? -1 : 1;
  const cx = ((lh.x + rh.x) / 2) * size.width;
  const cy = ((lh.y + rh.y) / 2) * size.height;
  const out: NormPoint[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = lm[i];
    if (!visible(p)) {
      out.push({ x: 0, y: 0, v: 0 });
      continue;
    }
    out.push({
      x: ((p.x * size.width - cx) * f) / torsoPx,
      y: (p.y * size.height - cy) / torsoPx,
      v: p.v,
    });
  }
  return out;
}

export function normalizeSequence(seq: PoseSequence, forward: number): NormalizedSequence {
  const torsoPx = torsoLengthPx(seq);
  return {
    times: seq.frames.map((f) => f.t),
    poses: seq.frames.map((f) => normalizePose(f.lm, seq, torsoPx, forward)),
    torsoPx,
  };
}

/**
 * Pose at media time t, linearly interpolated between the two neighbouring
 * frames (so a 30 fps reference moves smoothly next to a 240 fps clip).
 * Outside the clip the first / last pose is held.
 */
export function poseAt(ns: NormalizedSequence, t: number): NormPoint[] | null {
  const ts = ns.times;
  if (!ts.length) return null;
  if (t <= ts[0]!) return ns.poses[0] ?? null;
  if (t >= ts[ts.length - 1]!) return ns.poses[ts.length - 1] ?? null;
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const a = ns.poses[lo];
  const b = ns.poses[hi];
  if (!a || !b) return a ?? b ?? null;
  const u = (t - ts[lo]!) / (ts[hi]! - ts[lo]! || 1);
  return a.map((p, i) => {
    const q = b[i]!;
    if (p.v < MIN_VIS || q.v < MIN_VIS) return u < 0.5 ? p : q;
    return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, v: Math.min(p.v, q.v) };
  });
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Extent of all visible points of the given sequences (torso units). */
export function poseBounds(seqs: NormalizedSequence[]): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const s of seqs)
    for (const pose of s.poses) {
      if (!pose) continue;
      for (const p of pose) {
        if (p.v < MIN_VIS) continue;
        b.minX = Math.min(b.minX, p.x);
        b.maxX = Math.max(b.maxX, p.x);
        b.minY = Math.min(b.minY, p.y);
        b.maxY = Math.max(b.maxY, p.y);
      }
    }
  if (!Number.isFinite(b.minX)) return { minX: -1.5, maxX: 1.5, minY: -2, maxY: 2.5 };
  return b;
}

// ---------------------------------------------------------------------------
// Metric differences

export type DeltaDirection = 'higher' | 'lower' | 'similar';

export interface MetricDelta {
  key: string;
  unit: string;
  you: number;
  ref: number;
  /** you − ref, in the metric's unit. */
  delta: number;
  direction: DeltaDirection;
  /** Either side measured with confidence below LOW_CONFIDENCE. */
  lowConfidence: boolean;
}

export const LOW_CONFIDENCE = 0.6;

/**
 * Engine 1.0.x could store a negative stride (wrong foot or direction); such a
 * value is not compared until the analysis is recomputed.
 */
function usableValue(key: string, v: number | undefined): v is number {
  return isNum(v) && !(key === 'stride_length' && v < 0);
}

/**
 * Differences for the metrics both sides have with the same unit, in `order`
 * (keys not in `order` follow in their own order). "Similar" uses the same
 * per-unit minimum change as the comparison with the athlete's own history.
 */
export function diffMetrics(you: Metrics, ref: Metrics, order: string[] = []): MetricDelta[] {
  const keys = [...order, ...Object.keys(you).filter((k) => !order.includes(k))];
  const out: MetricDelta[] = [];
  for (const key of keys) {
    const a = you[key];
    const b = ref[key];
    if (!a || !b || a.unit !== b.unit) continue;
    if (!usableValue(key, a.value) || !usableValue(key, b.value)) continue;
    const delta = a.value - b.value;
    const thr = MIN_DELTA[a.unit] ?? 0;
    out.push({
      key,
      unit: a.unit,
      you: a.value,
      ref: b.value,
      delta: Math.round(delta * 1000) / 1000,
      direction: Math.abs(delta) <= thr ? 'similar' : delta > 0 ? 'higher' : 'lower',
      lowConfidence: a.confidence < LOW_CONFIDENCE || b.confidence < LOW_CONFIDENCE,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comparability

export interface ComparableSide {
  engineVersion: string;
  warnings: string[];
  forward: number;
}

export type ComparabilityIssue =
  /**
   * Engine versions measure this motion differently: a different major, or
   * (when the kind is given) a different metric-definition generation.
   */
  | 'engine_major_differs'
  /** The user's clip has quality warnings (low fps, partial clip, ...). */
  | 'user_warnings'
  /** The reference clip has quality warnings. */
  | 'ref_warnings'
  /** Motion direction unknown on either side: mirroring may be wrong. */
  | 'direction_unknown'
  /** No event both clips share: time alignment falls back to real time. */
  | 'no_shared_events';

export function engineMajor(v: string): string {
  return v.split('.')[0] ?? v;
}

/** Reasons why the differences can only be taken as a rough reference. */
export function comparability(
  you: ComparableSide,
  ref: ComparableSide,
  warp?: TimeWarp,
  kind?: MotionKind,
): ComparabilityIssue[] {
  const out: ComparabilityIssue[] = [];
  const same = kind
    ? sameDefinitions(kind, you.engineVersion, ref.engineVersion)
    : engineMajor(you.engineVersion) === engineMajor(ref.engineVersion);
  if (!same) out.push('engine_major_differs');
  if (you.warnings.length) out.push('user_warnings');
  if (ref.warnings.length) out.push('ref_warnings');
  if (!you.forward || !ref.forward) out.push('direction_unknown');
  if (warp && !warp.anchors.length) out.push('no_shared_events');
  return out;
}
