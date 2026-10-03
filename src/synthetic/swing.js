// Synthetic side-view swing generator. Pure, deterministic (seeded noise).
//
// Produces a PoseSequence (see src/pose/landmarks.js) for a stick-figure
// batter whose event times and geometry are known exactly, so analysis code
// can be tested without real footage. This is NOT a biomechanical model; it
// only needs to be plausible enough to exercise the pipeline.
//
// Body frame: units of torso length T (mid-shoulder to mid-hip), origin at
// the initial pelvis center, +X toward the pitcher, +Y down (image-like).

import { LM, NUM_LANDMARKS } from '../pose/landmarks.js';

export const DEFAULT_SWING = Object.freeze({
  fps: 60,
  duration: 2.0,
  width: 1080,
  height: 1920,
  torsoPx: 300,          // image scale: pixels per torso length
  pelvisX: 0.5,          // initial pelvis center, normalized image coords
  pelvisY: 0.55,
  facing: 1,             // +1: pitcher toward image right, -1: toward left
  battingSide: 'R',      // lead side = LEFT for 'R', RIGHT for 'L'
  // Events (s). Peak hand speed is exactly (swingStart + swingEnd) / 2.
  strideStart: 0.5,
  plant: 0.9,
  swingStart: 0.95,
  swingEnd: 1.25,
  finish: 1.6,
  // Geometry (T units)
  strideLength: 1.0,     // lead-ankle travel toward pitcher
  pelvisShiftRatio: 0.35,
  footLift: 0.15,
  headMoveX: 0.03,       // head displacement over the swing (relative to start)
  headMoveY: 0.02,
  headWobble: 0,         // extra oscillating head motion amplitude
  handRadius: 0.65,      // hand arc radius around the shoulder-center pivot
  handArcStartDeg: 170,
  handArcEndDeg: -40,
  handPivotDropY: 0.15,
  handPlaneSquash: 1.0,  // <1 flattens the arc vertically (different hand path)
  // Observation model
  noise: 0.003,          // gaussian landmark noise (T units)
  seed: 1,
  visNear: 0.95,
  visFar: 0.75,
  visFarWrist: 0.6,
});

/** Smoothstep 0→1 over [a, b]; zero velocity at both ends, peak speed at the midpoint. */
export function smoothstep(t, a, b) {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const u = (t - a) / (b - a);
  return u * u * (3 - 2 * u);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Body-frame positions [X, Y] for all 33 landmarks at time t. */
export function bodyAt(t, p) {
  const stride = smoothstep(t, p.strideStart, p.plant);
  const swing = smoothstep(t, p.swingStart, p.swingEnd);
  const follow = smoothstep(t, p.swingEnd, p.finish);
  const headProg = smoothstep(t, p.strideStart, p.swingEnd);

  const pelvis = [p.pelvisShiftRatio * p.strideLength * stride, 0];
  const shoulderMid = [pelvis[0] + 0.05, pelvis[1] - 1];

  // Feet: rear foot planted; lead foot strides with a small lift.
  const rearAnkle = [-0.75, 1.75];
  const liftU = t > p.strideStart && t < p.plant ? Math.sin(Math.PI * (t - p.strideStart) / (p.plant - p.strideStart)) : 0;
  const leadAnkle = [0.55 + p.strideLength * stride, 1.75 - p.footLift * liftU];

  // Head: smooth displacement plus optional wobble during the swing window.
  const wob = p.headWobble * Math.sin(2 * Math.PI * 3 * Math.max(0, t - p.strideStart)) * (t > p.strideStart && t < p.finish ? 1 : 0);
  const headOff = [p.headMoveX * headProg + wob, p.headMoveY * headProg];
  const nose = [shoulderMid[0] + 0.15 + headOff[0], shoulderMid[1] - 0.55 + headOff[1]];

  // Hands: load back during stride, arc through the zone, then follow through.
  const pivot = [shoulderMid[0], shoulderMid[1] + p.handPivotDropY];
  const a0 = (p.handArcStartDeg * Math.PI) / 180;
  const a1 = (p.handArcEndDeg * Math.PI) / 180;
  const ang = a0 + (a1 - a0) * swing;
  const arc = (a) => [pivot[0] + p.handRadius * Math.cos(a), pivot[1] + p.handRadius * p.handPlaneSquash * Math.sin(a)];
  let hands = arc(ang);
  if (swing === 0) {
    const load = smoothstep(t, p.strideStart, p.plant);
    const start = arc(a0);
    hands = [start[0] + 0.1 * (1 - load), start[1] - 0.05 * (1 - load)];
  }
  if (follow > 0) {
    const end = arc(a1);
    const fin = [shoulderMid[0] - 0.25, shoulderMid[1] - 0.25];
    hands = [end[0] + (fin[0] - end[0]) * follow, end[1] + (fin[1] - end[1]) * follow];
  }

  const lead = p.battingSide === 'R' ? 'LEFT' : 'RIGHT';
  const rear = lead === 'LEFT' ? 'RIGHT' : 'LEFT';
  const P = new Array(NUM_LANDMARKS);
  const set = (name, xy) => { P[LM[name]] = xy; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mid = (a, b, off = [0, 0]) => [(a[0] + b[0]) / 2 + off[0], (a[1] + b[1]) / 2 + off[1]];

  const leadHip = add(pelvis, [0.08, 0]);
  const rearHip = add(pelvis, [-0.08, 0]);
  const leadSh = add(shoulderMid, [0.08, 0]);
  const rearSh = add(shoulderMid, [-0.08, 0]);
  const leadWrist = add(hands, [0.03, 0]);
  const rearWrist = add(hands, [-0.03, 0.02]);

  set(`${lead}_HIP`, leadHip); set(`${rear}_HIP`, rearHip);
  set(`${lead}_SHOULDER`, leadSh); set(`${rear}_SHOULDER`, rearSh);
  set(`${lead}_ANKLE`, leadAnkle); set(`${rear}_ANKLE`, rearAnkle);
  set(`${lead}_KNEE`, mid(leadHip, leadAnkle, [0.12, 0])); set(`${rear}_KNEE`, mid(rearHip, rearAnkle, [0.1, 0]));
  set(`${lead}_HEEL`, add(leadAnkle, [-0.08, 0.06])); set(`${rear}_HEEL`, add(rearAnkle, [-0.08, 0.06]));
  set(`${lead}_FOOT_INDEX`, add(leadAnkle, [0.2, 0.08])); set(`${rear}_FOOT_INDEX`, add(rearAnkle, [0.2, 0.08]));
  set(`${lead}_WRIST`, leadWrist); set(`${rear}_WRIST`, rearWrist);
  set(`${lead}_ELBOW`, mid(leadSh, leadWrist, [0, 0.15])); set(`${rear}_ELBOW`, mid(rearSh, rearWrist, [0, 0.15]));
  for (const side of ['LEFT', 'RIGHT']) {
    const w = P[LM[`${side}_WRIST`]];
    set(`${side}_PINKY`, add(w, [0.03, 0.04])); set(`${side}_INDEX`, add(w, [0.05, 0.03])); set(`${side}_THUMB`, add(w, [0.04, 0]));
  }
  set('NOSE', nose);
  set('LEFT_EYE', add(nose, [-0.04, -0.06])); set('LEFT_EYE_INNER', add(nose, [-0.02, -0.06])); set('LEFT_EYE_OUTER', add(nose, [-0.07, -0.06]));
  set('RIGHT_EYE', add(nose, [-0.04, -0.05])); set('RIGHT_EYE_INNER', add(nose, [-0.02, -0.05])); set('RIGHT_EYE_OUTER', add(nose, [-0.07, -0.05]));
  set('LEFT_EAR', add(nose, [-0.17, -0.03])); set('RIGHT_EAR', add(nose, [-0.16, -0.02]));
  set('MOUTH_LEFT', add(nose, [-0.02, 0.07])); set('MOUTH_RIGHT', add(nose, [-0.03, 0.07]));
  return P;
}

function visibilityFor(i, p) {
  const far = p.battingSide === 'R' ? 'RIGHT' : 'LEFT'; // open-side view: rear side is far from camera
  if (i === LM[`${far}_WRIST`]) return p.visFarWrist;
  const name = Object.keys(LM).find((k) => LM[k] === i);
  if (name.startsWith(far)) return p.visFar;
  return p.visNear;
}

/**
 * Generate a synthetic PoseSequence.
 * @param {Partial<typeof DEFAULT_SWING>} overrides
 */
export function generateSwing(overrides = {}) {
  const p = { ...DEFAULT_SWING, ...overrides };
  const rng = mulberry32(p.seed);
  const n = Math.round(p.duration * p.fps) + 1;
  const frames = [];
  for (let k = 0; k < n; k++) {
    const t = k / p.fps;
    const body = bodyAt(t, p);
    const lm = body.map(([X, Y], i) => {
      const nx = X + p.noise * gaussian(rng);
      const ny = Y + p.noise * gaussian(rng);
      const px = p.pelvisX * p.width + p.facing * nx * p.torsoPx;
      const py = p.pelvisY * p.height + ny * p.torsoPx;
      return [px / p.width, py / p.height, 0, visibilityFor(i, p)];
    });
    frames.push({ t: Math.round(t * 1e6) / 1e6, lm });
  }
  return {
    version: 1,
    width: p.width,
    height: p.height,
    sampleFps: p.fps,
    start: 0,
    end: p.duration,
    model: 'synthetic',
    frames,
    truth: {
      params: p,
      events: {
        motionStart: p.strideStart,
        footPlant: p.plant,
        peakHandSpeed: (p.swingStart + p.swingEnd) / 2,
        swingEnd: p.swingEnd,
        finish: p.finish,
      },
    },
  };
}

// ---- Controlled transformations / corruptions (return new sequences) ----

function mapFrames(seq, fn) {
  return { ...seq, frames: seq.frames.map((f, k) => ({ t: f.t, lm: f.lm ? fn(f.lm, f.t, k) : null })) };
}

/** Translate by (dx, dy) pixels and scale by `scale` about image point (cx, cy) pixels. */
export function transformImage(seq, { dx = 0, dy = 0, scale = 1, cx = seq.width / 2, cy = seq.height / 2 } = {}) {
  const { width: W, height: H } = seq;
  return mapFrames(seq, (lm) => lm.map(([x, y, z, v]) => [((x * W - cx) * scale + cx + dx) / W, ((y * H - cy) * scale + cy + dy) / H, z, v]));
}

/** Set visibility of landmarks `ids` to `vis` for frames with t in [t0, t1]. */
export function setVisibility(seq, ids, vis, t0 = -Infinity, t1 = Infinity) {
  return mapFrames(seq, (lm, t) => lm.map((p, i) => (ids.includes(i) && t >= t0 && t <= t1 ? [p[0], p[1], p[2], vis] : p)));
}

/** Remove the whole pose (no person detected) for frames with t in [t0, t1]. */
export function dropFrames(seq, t0, t1) {
  return { ...seq, frames: seq.frames.map((f) => (f.t >= t0 && f.t <= t1 ? { t: f.t, lm: null } : f)) };
}

/** Offset every landmark by (dx, dy) normalized units for frames in [t0, t1] (simulates a tracking jump). */
export function shiftFrames(seq, dx, dy, t0, t1) {
  return mapFrames(seq, (lm, t) => (t >= t0 && t <= t1 ? lm.map(([x, y, z, v]) => [x + dx, y + dy, z, v]) : lm));
}
