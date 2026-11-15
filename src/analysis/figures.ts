// Geometry that shows WHERE each metric is measured, for drawing on top of a
// frame. Uses the same filtering, lead-leg choice and event frames as the
// metric computations in batting.ts / pitching.ts, so a value read off the
// figure equals the reported metric (checked in figures.test.ts).
// Coordinates are image pixels of the (rotated) analysis frames.
import { LEFT, RIGHT, cutoffs, findLeadLeg, handSpeed, medianPos, normSpeed } from './common';
import type { Vec } from './geometry';
import { LM } from './landmarks';
import { assessClip } from './quality';
import { argmax, isNum } from './signal';
import { buildTracks, indexAt, type Tracks } from './tracks';
import type { EventTimes, MotionKind, PoseSequence } from './types';

export type FigureShape =
  /** Interior angle at b (between b→a and b→c). */
  | { type: 'angle'; a: Vec; b: Vec; c: Vec }
  /** Measured displacement. */
  | { type: 'arrow'; from: Vec; to: Vec }
  /** Reference position (e.g. where the body part was in the stance). */
  | { type: 'ghost'; at: Vec }
  /** Helper line (e.g. the shoulder line or the vertical). */
  | { type: 'line'; from: Vec; to: Vec }
  /** Trajectory over time. */
  | { type: 'path'; points: Vec[] };

export interface MetricFigure {
  /** Event whose frame the figure belongs to. */
  event: string;
  /** Media time of that frame (seconds, same clock as the stored events). */
  t: number;
  shapes: FigureShape[];
}

export interface FigureSet {
  figures: Record<string, MetricFigure>;
  /** Torso length in pixels (the normalisation unit). */
  torso: number;
  forward: 1 | -1;
}

const EMPTY: FigureSet = { figures: {}, torso: NaN, forward: 1 };

/**
 * @param seq       stored pose sequence (media time)
 * @param events    stored event times (media time)
 * @param timeScale real seconds per media second, as used for the analysis
 */
export function metricFigures(
  kind: MotionKind,
  seq: PoseSequence,
  events: EventTimes,
  timeScale = 1,
): FigureSet {
  const s = timeScale > 0 ? timeScale : 1;
  const scaled: PoseSequence =
    s === 1 ? seq : { ...seq, frames: seq.frames.map((f) => ({ ...f, t: f.t * s })) };
  const quality = assessClip(scaled);
  if (!isNum(quality.fps)) return EMPTY;
  const fc = cutoffs(quality.fps);
  const tr = buildTracks(scaled, fc.position, fc.speed);
  if (!tr.n || !isNum(tr.torso)) return EMPTY;
  const idx = (name: string) => (isNum(events[name]) ? indexAt(tr, events[name]! * s) : -1);
  const time = (i: number) => tr.t[i]! / s;
  const figures =
    kind === 'batting' ? battingFigures(tr, idx, time) : pitchingFigures(tr, idx, time);
  return { figures, torso: tr.torso, forward: findLeadLeg(tr).forward };
}

type Idx = (name: string) => number;
type Time = (i: number) => number;

function battingFigures(tr: Tracks, idx: Idx, time: Time): Record<string, MetricFigure> {
  const out: Record<string, MetricFigure> = {};
  const { lead } = findLeadLeg(tr);
  const iL = idx('load');
  const iP = idx('plant');
  const iC = idx('contact');
  const iF = idx('finish');
  if (iL < 0 || iP < 0 || iC < 0) return out;
  const refA = Math.max(0, iL - Math.round(0.2 * tr.fs));
  const refB = Math.max(refA, iL);
  const fig = (event: string, i: number, shapes: FigureShape[]): MetricFigure => ({
    event,
    t: time(i),
    shapes,
  });

  // Stride: stance ankle position -> ankle at plant (horizontal component).
  const ankleRef = medianPos(tr, lead.ankle, refA, refB);
  const ankleP = tr.at(lead.ankle, iP);
  out.stride_length = fig('plant', iP, [
    { type: 'ghost', at: ankleRef },
    { type: 'arrow', from: { x: ankleRef.x, y: ankleP.y }, to: ankleP },
  ]);

  // Pelvis shift: stance pelvis centre -> pelvis centre at contact.
  const hipRef = mid(medianPos(tr, LM.L_HIP, refA, refB), medianPos(tr, LM.R_HIP, refA, refB));
  const hipC = tr.mid(LM.L_HIP, LM.R_HIP, iC);
  out.pelvis_shift = fig('contact', iC, [
    { type: 'ghost', at: hipRef },
    { type: 'arrow', from: { x: hipRef.x, y: hipC.y }, to: hipC },
  ]);

  // Head: stance nose position -> nose at contact.
  const headRef = medianPos(tr, LM.NOSE, refA, refB);
  const headC = tr.at(LM.NOSE, iC);
  out.head_dx = fig('contact', iC, [
    { type: 'ghost', at: headRef },
    { type: 'arrow', from: { x: headRef.x, y: headC.y }, to: headC },
  ]);
  out.head_dy = fig('contact', iC, [
    { type: 'ghost', at: headRef },
    { type: 'arrow', from: { x: headC.x, y: headRef.y }, to: headC },
  ]);

  const knee = (i: number): FigureShape => ({
    type: 'angle',
    a: tr.at(lead.hip, i),
    b: tr.at(lead.knee, i),
    c: tr.at(lead.ankle, i),
  });
  out.lead_knee_plant = fig('plant', iP, [knee(iP)]);
  out.lead_knee_contact = fig('contact', iC, [knee(iC)]);
  out.trunk_tilt_contact = fig('contact', iC, trunkShapes(tr, iC));

  // Hands: path of the wrist midpoint from plant to finish, peak marked.
  const end = iF >= 0 ? iF : tr.n - 1;
  const path: Vec[] = [];
  for (let i = iP; i <= end; i++) {
    const w = tr.mid(LM.L_WRIST, LM.R_WRIST, i);
    if (isNum(w.x) && isNum(w.y)) path.push(w);
  }
  if (path.length > 1) {
    const hands = handSpeed(tr);
    const iPeak = argmax(hands, iP, end);
    const shapes: FigureShape[] = [{ type: 'path', points: path }];
    if (iPeak >= 0) shapes.push({ type: 'ghost', at: tr.mid(LM.L_WRIST, LM.R_WRIST, iPeak) });
    out.wrist_peak_speed = fig('contact', iC, shapes);
  }
  return out;
}

function pitchingFigures(tr: Tracks, idx: Idx, time: Time): Record<string, MetricFigure> {
  const out: Record<string, MetricFigure> = {};
  const { lead, rear } = findLeadLeg(tr);
  const iP = idx('plant');
  const iR = idx('release');
  if (iP < 0 || iR < 0) return out;
  const fig = (event: string, i: number, shapes: FigureShape[]): MetricFigure => ({
    event,
    t: time(i),
    shapes,
  });

  // Same throwing-arm choice as pitching.ts: the wrist with the higher peak speed.
  const lw = normSpeed(tr, LM.L_WRIST, true);
  const rw = normSpeed(tr, LM.R_WRIST, true);
  const lPeak = argmax(lw);
  const rPeak = argmax(rw);
  const throwSide = (lPeak >= 0 ? lw[lPeak]! : -1) > (rPeak >= 0 ? rw[rPeak]! : -1) ? LEFT : RIGHT;
  const glove = throwSide === LEFT ? RIGHT : LEFT;

  const leadA = tr.at(lead.ankle, iP);
  const rearA = tr.at(rear.ankle, iP);
  out.stride_length = fig('plant', iP, [
    { type: 'ghost', at: rearA },
    { type: 'arrow', from: { x: rearA.x, y: leadA.y }, to: leadA },
  ]);

  const knee = (i: number): FigureShape => ({
    type: 'angle',
    a: tr.at(lead.hip, i),
    b: tr.at(lead.knee, i),
    c: tr.at(lead.ankle, i),
  });
  out.lead_knee_plant = fig('plant', iP, [knee(iP)]);
  out.lead_knee_release = fig('release', iR, [knee(iR)]);
  out.trunk_forward_release = fig('release', iR, trunkShapes(tr, iR));

  const sA = tr.at(glove.shoulder, iP);
  const sB = tr.at(throwSide.shoulder, iP);
  const e = tr.at(throwSide.elbow, iP);
  if (Math.abs(sB.x - sA.x) > 0.05 * tr.torso) {
    const lineY = (x: number) => sA.y + ((sB.y - sA.y) * (x - sA.x)) / (sB.x - sA.x);
    const lo = Math.min(sA.x, sB.x, e.x) - 0.2 * tr.torso;
    const hi = Math.max(sA.x, sB.x, e.x) + 0.2 * tr.torso;
    out.elbow_height_plant = fig('plant', iP, [
      { type: 'line', from: { x: lo, y: lineY(lo) }, to: { x: hi, y: lineY(hi) } },
      { type: 'arrow', from: { x: e.x, y: lineY(e.x) }, to: e },
    ]);
  }
  return out;
}

/** Pelvis centre -> shoulder centre, with a vertical reference of equal length. */
function trunkShapes(tr: Tracks, i: number): FigureShape[] {
  const hip = tr.mid(LM.L_HIP, LM.R_HIP, i);
  const sh = tr.mid(LM.L_SHOULDER, LM.R_SHOULDER, i);
  const len = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  const up = { x: hip.x, y: hip.y - len };
  return [
    { type: 'line', from: hip, to: up },
    { type: 'angle', a: up, b: hip, c: sh },
  ];
}

function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
