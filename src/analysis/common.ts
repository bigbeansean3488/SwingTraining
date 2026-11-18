// Shared building blocks for batting and pitching analysis.
import type { Vec } from './geometry';
import { LM } from './landmarks';
import type { Tracks } from './tracks';
import { argmax, derivative, isNum, mean, median, percentile } from './signal';
import type { MetricResult } from './types';

export const ENGINE_VERSION = '1.3.0';

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
 * Only frames 0..end are used: after contact/release the rear foot often
 * swings forward farther than the stride foot and would be mistaken for it.
 */
export function findLeadLeg(
  tr: Tracks,
  end = tr.n - 1,
): { lead: Side; rear: Side; forward: 1 | -1 } {
  const last = Math.min(tr.n - 1, Math.max(0, end));
  const range = (idx: number) => {
    const x = tr.pos(idx).x.slice(0, last + 1);
    return percentile(x, 0.95) - percentile(x, 0.05);
  };
  const leftRange = range(LM.L_ANKLE);
  const rightRange = range(LM.R_ANKLE);
  const lead =
    (isNum(rightRange) ? rightRange : -1) > (isNum(leftRange) ? leftRange : -1) ? RIGHT : LEFT;
  const rear = lead === LEFT ? RIGHT : LEFT;
  return { lead, rear, forward: ankleDirection(tr, lead, last) };
}

/** Sign of the largest horizontal excursion of a side's ankle from its start, over 0..end. */
function ankleDirection(tr: Tracks, side: Side, end: number): 1 | -1 {
  const x = tr.pos(side.ankle).x.slice(0, end + 1);
  const refN = Math.max(3, Math.round(tr.n * 0.1));
  const ref = median(x.slice(0, refN));
  let best = 0;
  for (const v of x) if (isNum(v) && Math.abs(v - ref) > Math.abs(best)) best = v - ref;
  return best >= 0 ? 1 : -1;
}

export interface Legs {
  lead: Side;
  rear: Side;
  forward: 1 | -1;
}

/**
 * Batting: lead leg judged from the frames before the hand-speed peak.
 * Forward is where the lead foot stands relative to the rear foot in the
 * stance (the front foot is always nearer the pitcher), which stays right even
 * when the foot first moves backward; the motion direction is the fallback
 * when the feet are too close together to tell.
 */
export function battingLegs(tr: Tracks): Legs {
  const iC = argmax(handSpeed(tr));
  const legs = findLeadLeg(tr, iC >= 0 ? iC : tr.n - 1);
  const refN = Math.max(3, Math.round(tr.n * 0.1));
  const lx = tr.pos(legs.lead.ankle).x;
  const rx = tr.pos(legs.rear.ankle).x;
  const gap = median(lx.slice(0, refN).map((v, i) => v - rx[i]!));
  if (isNum(gap) && Math.abs(gap) > STANCE_GAP_MIN * tr.torso) {
    return { ...legs, forward: gap > 0 ? 1 : -1 };
  }
  return legs;
}

/** Stance foot spacing (torso units) needed to take the batting direction from the feet. */
export const STANCE_GAP_MIN = 0.3;

export interface PitchingLegs extends Legs {
  throwSide: Side;
  glove: Side;
  /** Throwing-wrist speed (torso/s). */
  wrist: number[];
}

/**
 * Pitching: the stride leg is the one whose knee is lifted highest before
 * release; when the two are too close to call, the leg opposite the throwing
 * arm. Forward is the direction the pelvis travels toward release.
 */
export function pitchingLegs(tr: Tracks): PitchingLegs {
  // Throwing arm: the wrist that reaches the higher peak speed.
  const lw = normSpeed(tr, LM.L_WRIST, true);
  const rw = normSpeed(tr, LM.R_WRIST, true);
  const lPeak = argmax(lw);
  const rPeak = argmax(rw);
  const throwSide = (lPeak >= 0 ? lw[lPeak]! : -1) > (rPeak >= 0 ? rw[rPeak]! : -1) ? LEFT : RIGHT;
  const glove = throwSide === LEFT ? RIGHT : LEFT;
  const wrist = throwSide === LEFT ? lw : rw;
  const iR = argmax(wrist);
  const end = iR >= 0 ? iR : tr.n - 1;
  const refN = Math.max(3, Math.round(tr.n * 0.1));

  const lift = (side: Side) => {
    const y = tr.pos(side.knee).y.slice(0, end + 1);
    const top = Math.min(...y.filter(isNum));
    return median(y.slice(0, refN)) - top;
  };
  const lL = lift(LEFT);
  const lR = lift(RIGHT);
  const clear = isNum(lL) && isNum(lR) && Math.abs(lL - lR) > LIFT_MARGIN * tr.torso;
  const lead = clear ? (lL > lR ? LEFT : RIGHT) : glove;
  const rear = lead === LEFT ? RIGHT : LEFT;

  const hipX = tr.pos(LM.L_HIP).x.map((v, i) => (v + tr.pos(LM.R_HIP).x[i]!) / 2);
  const travel = hipX[end]! - median(hipX.slice(0, refN));
  const forward: 1 | -1 =
    isNum(travel) && Math.abs(travel) > PELVIS_TRAVEL_MIN * tr.torso
      ? travel > 0
        ? 1
        : -1
      : ankleDirection(tr, lead, end);
  return { lead, rear, forward, throwSide, glove, wrist };
}

/** Knee-lift difference (torso units) needed to tell the stride leg from the knees alone. */
export const LIFT_MARGIN = 0.15;
/** Pelvis travel (torso units) needed to take the pitching direction from the pelvis. */
export const PELVIS_TRAVEL_MIN = 0.2;

/**
 * Lead/rear sides at frame i. Side views often swap MediaPipe's left/right leg
 * labels for a few frames; when the labelled lead ankle is clearly behind the
 * rear ankle, the labels are taken as swapped for that frame.
 */
export function sidesAt(tr: Tracks, legs: Legs, i: number): Legs & { swapped: boolean } {
  const a = tr.at(legs.lead.ankle, i).x;
  const b = tr.at(legs.rear.ankle, i).x;
  const swapped = isNum(a) && isNum(b) && (a - b) * legs.forward < -SWAP_MARGIN * tr.torso;
  return swapped
    ? { lead: legs.rear, rear: legs.lead, forward: legs.forward, swapped }
    : { ...legs, swapped };
}

/** How far (torso units) the lead ankle must be behind the rear ankle to count as a label swap. */
export const SWAP_MARGIN = 0.05;

/** A stride shorter than this (torso units, i.e. clearly backward) is reported as unmeasurable. */
export const STRIDE_MIN = -0.1;

export interface StrideResult {
  /** Reference point (stance ankle for batting, rear ankle for pitching). */
  from: Vec;
  /** Lead ankle at plant. */
  to: Vec;
  /** Torso units along the forward direction; null when implausible. */
  value: number | null;
  raw: number;
  swapped: boolean;
}

/** Batting stride: front-ankle position in the stance window [a, b] -> lead ankle at plant. */
export function battingStride(
  tr: Tracks,
  legs: Legs,
  a: number,
  b: number,
  iP: number,
): StrideResult {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = a; i <= b; i++) {
    const p = tr.at(sidesAt(tr, legs, i).lead.ankle, i);
    xs.push(p.x);
    ys.push(p.y);
  }
  const from = { x: median(xs), y: median(ys) };
  const s = sidesAt(tr, legs, iP);
  const to = tr.at(s.lead.ankle, iP);
  return strideResult(from, to, legs.forward, tr.torso, s.swapped);
}

/** Pitching stride: rear ankle -> lead ankle, both at plant. */
export function pitchingStride(tr: Tracks, legs: Legs, iP: number): StrideResult {
  const s = sidesAt(tr, legs, iP);
  return strideResult(
    tr.at(s.rear.ankle, iP),
    tr.at(s.lead.ankle, iP),
    legs.forward,
    tr.torso,
    s.swapped,
  );
}

function strideResult(
  from: Vec,
  to: Vec,
  forward: number,
  torso: number,
  swapped: boolean,
): StrideResult {
  const raw = ((to.x - from.x) * forward) / torso;
  // Small negatives are noise around "no stride"; clearly backward is a measurement failure.
  const value = !isNum(raw) ? null : raw < STRIDE_MIN ? null : Math.max(0, raw);
  return { from, to, value, raw, swapped };
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
