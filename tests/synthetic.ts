// Synthetic 2-D pose generator for tests. Self-contained (no imports) so that
// scripts/make-fixtures.ts can run it directly with Node type stripping.
//
// It draws a stick figure seen from the side camera (perpendicular to the
// throwing/pitching line, facing the athlete's front) with known event times,
// then converts it to MediaPipe-normalized landmarks.

export interface SynthLandmark {
  x: number;
  y: number;
  v: number;
}
export interface SynthFrame {
  t: number;
  lm: SynthLandmark[] | null;
}
export interface SynthSequence {
  width: number;
  height: number;
  frames: SynthFrame[];
}
export interface SynthOptions {
  fps: number;
  /** +1: motion toward image right (e.g. right-handed batter), -1: mirrored. */
  forward?: 1 | -1;
  /** Gaussian pixel noise (standard deviation). */
  noisePx?: number;
  seed?: number;
  /** Override stride length in torso units. */
  stride?: number;
  /** Multiply all event times (tempo change). */
  tempo?: number;
  /**
   * Pitching: how far (torso units) the rear foot swings forward after
   * release. Real pitchers often swing it past the stride foot.
   */
  rearFollow?: number;
  /** From this time on, MediaPipe's left/right leg labels are swapped (knee to toe). */
  swapLegsAfter?: number;
}

type P = [number, number];
const W = 1920;
const H = 1080;
export const SYNTH_TORSO_PX = 220;

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const ss = (t: number, a: number, b: number) => {
  const u = clamp01((t - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const bump = (t: number, a: number, b: number) => {
  const u = clamp01((t - a) / (b - a));
  return Math.sin(Math.PI * u) ** 2;
};
function normCdf(z: number): number {
  // Abramowitz–Stegun approximation of the error function.
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) *
      k *
      Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

function knee(hip: P, ankle: P, len: number, side: number): P {
  const dx = ankle[0] - hip[0];
  const dy = ankle[1] - hip[1];
  const d = Math.min(Math.hypot(dx, dy), 2 * len - 1e-6);
  const mx = (hip[0] + ankle[0]) / 2;
  const my = (hip[1] + ankle[1]) / 2;
  const h = Math.sqrt(Math.max(0, len * len - (d / 2) ** 2));
  const n = Math.hypot(dx, dy) || 1;
  // Perpendicular pointing toward `side` horizontally.
  let px = -dy / n;
  let py = dx / n;
  if (px * side < 0) {
    px = -px;
    py = -py;
  }
  return [mx + px * h, my + py * h];
}

export interface BattingTruth {
  events: { load: number; plant: number; contact: number; finish: number };
  forward: 1 | -1;
}

/** Joint positions (pixels) of the batting model at time t. */
export function battingPose(t: number, s: 1 | -1, strideT = 0.65, tempo = 1): Record<string, P> {
  const T = SYNTH_TORSO_PX;
  const k = (x: number) => x * tempo;
  const shift = 0.3 * T * ss(t, k(0.55), k(1.05));
  const hip: P = [900 + s * shift, 600 + 20 * ss(t, k(0.6), k(0.9))];
  const theta = ((5 - 17 * ss(t, k(0.85), k(1.1))) * Math.PI) / 180;
  const sh: P = [hip[0] + s * T * Math.sin(theta), hip[1] - T * Math.cos(theta)];
  const wh = 90 - 50 * ss(t, k(0.92), k(1.08));
  const ws = 150 - 80 * ss(t, k(0.97), k(1.12));
  const leadHip: P = [hip[0] + (s * wh) / 2, hip[1]];
  const rearHip: P = [hip[0] - (s * wh) / 2, hip[1]];
  const leadSh: P = [sh[0] + (s * ws) / 2, sh[1]];
  const rearSh: P = [sh[0] - (s * ws) / 2, sh[1]];
  const leadAnkle: P = [
    900 + s * 130 + s * strideT * T * ss(t, k(0.5), k(0.9)),
    950 - 50 * bump(t, k(0.5), k(0.9)),
  ];
  const rearAnkle: P = [900 - s * 130, 950];
  const L = 190;
  const leadKnee = knee(leadHip, leadAnkle, L, s);
  const rearKnee = knee(rearHip, rearAnkle, L, -s);
  const nose: P = [sh[0] + s * 10, sh[1] - 55 + 6 * ss(t, k(0.85), k(1.1))];
  // Hands travel along an arc. As in lab data, hand path speed peaks before
  // contact (HAND_PEAK_BEFORE_CONTACT_S), dips right after it, and rises
  // again in the follow-through before the hands stop.
  const tp = k(1.1) - HAND_PEAK_BEFORE_CONTACT_S * tempo;
  const u = normCdf((t - tp) / (SWING_SIGMA * tempo));
  const uf = normCdf((t - k(FOLLOW_PEAK_T)) / (FOLLOW_SIGMA * tempo));
  const phi = ((200 - SWING_DEG * u - FOLLOW_DEG * uf) * Math.PI) / 180;
  const hand: P = [900 + s * 10 + s * 120 * Math.cos(phi), 520 + 120 * Math.sin(phi)];
  return {
    hip,
    sh,
    leadHip,
    rearHip,
    leadSh,
    rearSh,
    leadAnkle,
    rearAnkle,
    leadKnee,
    rearKnee,
    nose,
    hand,
    leadWrist: [hand[0], hand[1] - 6],
    rearWrist: [hand[0], hand[1] + 6],
  };
}

/** Hand-speed peak precedes contact by this much (OBP lab median: 61 ms). */
export const HAND_PEAK_BEFORE_CONTACT_S = 0.06;
const SWING_SIGMA = 0.05;
const SWING_DEG = 260;
const FOLLOW_PEAK_T = 1.23;
const FOLLOW_SIGMA = 0.06;
const FOLLOW_DEG = 90;

/** Angular hand speed of the model (deg/s); path speed is proportional to it. */
function handRate(t: number, tempo: number): number {
  const g = (x: number, m: number, sd: number) =>
    Math.exp(-0.5 * ((x - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
  const tp = (1.1 - HAND_PEAK_BEFORE_CONTACT_S) * tempo;
  return (
    SWING_DEG * g(t, tp, SWING_SIGMA * tempo) +
    FOLLOW_DEG * g(t, FOLLOW_PEAK_T * tempo, FOLLOW_SIGMA * tempo)
  );
}

export function battingTruth(s: 1 | -1, tempo = 1): BattingTruth & { handPeak: number } {
  const handPeak = (1.1 - HAND_PEAK_BEFORE_CONTACT_S) * tempo;
  const peak = handRate(handPeak, tempo);
  // Finish: after the follow-through peak, hand speed falls below 20% of the swing peak.
  let finish = FOLLOW_PEAK_T * tempo;
  while (handRate(finish, tempo) >= 0.2 * peak) finish += 0.0001;
  return {
    events: {
      load: 0.5 * tempo,
      plant: 0.9 * tempo,
      contact: 1.1 * tempo,
      finish,
    },
    handPeak,
    forward: s,
  };
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
  return () => {
    // Box–Muller
    const u = Math.max(1e-12, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Build the 33-landmark array from named joints. */
function toLandmarks(
  j: Record<string, P>,
  s: 1 | -1,
  noise: () => number,
  noisePx: number,
): SynthLandmark[] {
  // For a right-handed athlete facing the camera with forward = image right,
  // the body's LEFT side is on image right. Mirrored athletes swap labels.
  const leadIsLeft = s > 0;
  const lm: SynthLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
  const set = (idx: number, p: P, v = 0.95) => {
    lm[idx] = {
      x: Math.round(((p[0] + noise() * noisePx) / W) * 1e5) / 1e5,
      y: Math.round(((p[1] + noise() * noisePx) / H) * 1e5) / 1e5,
      v,
    };
  };
  const L = (lead: number, rear: number) =>
    (leadIsLeft ? [lead, rear] : [rear, lead]) as [number, number];
  const [lSh, rSh] = L(0, 1).map((i) => (i === 0 ? j.leadSh! : j.rearSh!)) as [P, P];
  const [lHip, rHip] = L(0, 1).map((i) => (i === 0 ? j.leadHip! : j.rearHip!)) as [P, P];
  const [lKnee, rKnee] = L(0, 1).map((i) => (i === 0 ? j.leadKnee! : j.rearKnee!)) as [P, P];
  const [lAnk, rAnk] = L(0, 1).map((i) => (i === 0 ? j.leadAnkle! : j.rearAnkle!)) as [P, P];
  const [lWr, rWr] = L(0, 1).map((i) => (i === 0 ? j.leadWrist! : j.rearWrist!)) as [P, P];
  const lEl: P = j.leadElbow ?? [(lSh[0] + lWr[0]) / 2, (lSh[1] + lWr[1]) / 2 + 10];
  const rEl: P = j.rearElbow ?? [(rSh[0] + rWr[0]) / 2, (rSh[1] + rWr[1]) / 2 + 10];
  const [leftEl, rightEl] = j.leadElbow
    ? leadIsLeft
      ? [j.leadElbow, j.rearElbow!]
      : [j.rearElbow!, j.leadElbow]
    : [lEl, rEl];
  set(0, j.nose!);
  set(7, [j.nose![0] - 18, j.nose![1] + 4], 0.8);
  set(8, [j.nose![0] + 18, j.nose![1] + 4], 0.8);
  set(11, lSh);
  set(12, rSh);
  set(13, leftEl as P);
  set(14, rightEl as P);
  set(15, lWr);
  set(16, rWr);
  set(23, lHip);
  set(24, rHip);
  set(25, lKnee);
  set(26, rKnee);
  set(27, lAnk);
  set(28, rAnk);
  set(29, [lAnk[0] - s * 8, lAnk[1] + 10], 0.85);
  set(30, [rAnk[0] - s * 8, rAnk[1] + 10], 0.85);
  set(31, [lAnk[0] + s * 30, lAnk[1] + 14], 0.85);
  set(32, [rAnk[0] + s * 30, rAnk[1] + 14], 0.85);
  return lm;
}

/** Swap the left/right labels of knee, ankle, heel and foot index (25..32). */
function swapLegs(lm: SynthLandmark[], on: boolean): SynthLandmark[] {
  if (!on) return lm;
  const out = [...lm];
  for (let i = 25; i <= 31; i += 2) [out[i], out[i + 1]] = [lm[i + 1]!, lm[i]!];
  return out;
}

export function generateBatting(opts: SynthOptions): SynthSequence {
  const s = opts.forward ?? 1;
  const tempo = opts.tempo ?? 1;
  const noise = rng(opts.seed ?? 7);
  const n = Math.round(1.6 * tempo * opts.fps);
  const frames: SynthFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / opts.fps;
    frames.push({
      t: Math.round(t * 1e6) / 1e6,
      lm: swapLegs(
        toLandmarks(battingPose(t, s, opts.stride, tempo), s, noise, opts.noisePx ?? 0),
        t >= (opts.swapLegsAfter ?? Infinity),
      ),
    });
  }
  return { width: W, height: H, frames };
}

// ---------------------------------------------------------------------------
// Pitching model: leg lift, stride, arm cocking and release.

export interface PitchingTruth {
  events: { liftTop: number; plant: number; release: number; finish: number };
  forward: 1 | -1;
}

export function pitchingPose(
  t: number,
  s: 1 | -1,
  strideT = 1.6,
  tempo = 1,
  rearFollow = 0.3,
): Record<string, P> {
  const T = SYNTH_TORSO_PX;
  const k = (x: number) => x * tempo;
  // Phases: lift top 0.6 s, plant 1.0 s, release 1.15 s, finish ~1.25 s.
  const shift = 0.9 * T * ss(t, k(0.6), k(1.12));
  const hip: P = [800 + s * shift, 600 + 40 * ss(t, k(0.7), k(1.0))];
  const theta = ((-5 + 40 * ss(t, k(0.98), k(1.18))) * Math.PI) / 180;
  const sh: P = [hip[0] + s * T * Math.sin(theta), hip[1] - T * Math.cos(theta)];
  const leadHip: P = [hip[0] + s * 30, hip[1]];
  const rearHip: P = [hip[0] - s * 30, hip[1]];
  const leadSh: P = [sh[0] + s * 50, sh[1]];
  const rearSh: P = [sh[0] - s * 50, sh[1]];
  // Lead leg: lift (knee up) to 0.6 s, then stride to plant at 1.0 s.
  const lift = bump(t, k(0.2), k(1.0)) * 1.0;
  const leadAnkle: P = [800 + s * 40 + s * strideT * T * ss(t, k(0.6), k(1.0)), 950 - 160 * lift];
  const rearAnkle: P = [
    800 - s * 40 + s * rearFollow * T * ss(t, k(1.1), k(1.3)),
    950 - (rearFollow > 0.3 ? 120 * bump(t, k(1.1), k(1.3)) : 0),
  ];
  const L = 190;
  const leadKnee = knee(leadHip, leadAnkle, L, s);
  const rearKnee = knee(rearHip, rearAnkle, L, s);
  const nose: P = [sh[0] + s * 12, sh[1] - 55];
  // Throwing arm: rear side. Elbow above/below the shoulder line by design:
  // at plant the elbow sits 0.15 torso above the shoulder line.
  const tr = k(1.15);
  const sigma = 0.035 * tempo;
  const u = normCdf((t - tr) / sigma);
  const phi = ((160 - 200 * u) * Math.PI) / 180; // arm angle around the shoulder
  const armR = 150;
  const wrist: P = [rearSh[0] + s * armR * Math.cos(phi), rearSh[1] - armR * Math.sin(phi)];
  const elbowLift = 0.15 * T * (1 - ss(t, k(1.05), k(1.2)));
  const elbow: P = [(rearSh[0] + wrist[0]) / 2, rearSh[1] - elbowLift];
  const gloveWrist: P = [leadSh[0] + s * 40, leadSh[1] + 60];
  return {
    hip,
    sh,
    leadHip,
    rearHip,
    leadSh,
    rearSh,
    leadAnkle,
    rearAnkle,
    leadKnee,
    rearKnee,
    nose,
    leadWrist: gloveWrist,
    rearWrist: wrist,
    leadElbow: [(leadSh[0] + gloveWrist[0]) / 2, leadSh[1] + 40],
    rearElbow: elbow,
  };
}

export function pitchingTruth(s: 1 | -1, tempo = 1): PitchingTruth {
  const sigma = 0.035 * tempo;
  return {
    events: {
      liftTop: 0.6 * tempo,
      plant: 1.0 * tempo,
      release: 1.15 * tempo,
      finish: 1.15 * tempo + sigma * Math.sqrt(2 * Math.log(4)),
    },
    forward: s,
  };
}

export function generatePitching(opts: SynthOptions): SynthSequence {
  const s = opts.forward ?? 1;
  const tempo = opts.tempo ?? 1;
  const noise = rng(opts.seed ?? 11);
  const n = Math.round(1.6 * tempo * opts.fps);
  const frames: SynthFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / opts.fps;
    frames.push({
      t: Math.round(t * 1e6) / 1e6,
      lm: swapLegs(
        toLandmarks(
          pitchingPose(t, s, opts.stride, tempo, opts.rearFollow),
          s,
          noise,
          opts.noisePx ?? 0,
        ),
        t >= (opts.swapLegsAfter ?? Infinity),
      ),
    });
  }
  return { width: W, height: H, frames };
}
