// Synthetic long practice recording: several swings in one continuous
// PoseSequence with idle time and non-swing distractors in between.
// Pure, deterministic. Used to test swing segmentation without footage.
import { LM, NUM_LANDMARKS } from '../pose/landmarks.js';
import { DEFAULT_SWING, bodyAt, smoothstep, mulberry32, gaussian, visibilityFor } from './swing.js';

const HAND_IDS = ['WRIST', 'PINKY', 'INDEX', 'THUMB'].flatMap((n) => [LM[`LEFT_${n}`], LM[`RIGHT_${n}`]]);
const ELBOW_IDS = [LM.LEFT_ELBOW, LM.RIGHT_ELBOW];

/**
 * @param {object} opts
 * @param {object[]} opts.swings   per-swing overrides of DEFAULT_SWING event/geometry params
 * @param {number}   [opts.lead]   s of idle stance before the first swing's local t=0
 * @param {number}   [opts.gap]    s between consecutive swings' local t=0 (≥ swing duration + 1)
 * @param {number}   [opts.tail]   s of idle after the last swing
 * @param {number}   [opts.recovery] s to return from the finish pose to the stance
 * @param {object[]} [opts.distractors] {type: 'waggle'|'walk'|'armRaise'|'leave', t0, t1, ...}
 *   waggle: hands bob by `amp` (T) at `hz`; walk: whole body steps `dx` (T) away and back;
 *   armRaise: hands go up `height` (T) and back down; leave: no person detected.
 * Remaining options (fps, width, facing, battingSide, noise, seed …) are shared by all swings.
 */
export function generatePractice({ swings, lead = 2, gap = 7, tail = 2, recovery = 1, distractors = [], ...base } = {}) {
  const shared = { ...DEFAULT_SWING, ...base };
  if (shared.pelvisX === null) shared.pelvisX = 0.5 - 0.1 * shared.facing;
  const ps = swings.map((s) => ({ ...shared, ...s }));
  const starts = ps.map((_, i) => lead + i * gap);
  const duration = starts[starts.length - 1] + ps[ps.length - 1].duration + tail;
  const rng = mulberry32(shared.seed);
  const n = Math.round(duration * shared.fps) + 1;

  const lerp = (A, B, f) => A.map((a, i) => [a[0] + (B[i][0] - a[0]) * f, a[1] + (B[i][1] - a[1]) * f]);
  function body(t) {
    const i = starts.findIndex((s, j) => t >= s && t <= s + ps[j].duration);
    if (i >= 0) return bodyAt(t - starts[i], ps[i]);
    const next = starts.findIndex((s) => s > t);
    const prev = next < 0 ? ps.length - 1 : next - 1;
    const stance = bodyAt(0, ps[next < 0 ? prev : next]);
    if (prev < 0) return stance;
    const since = t - (starts[prev] + ps[prev].duration);
    if (since >= recovery) return stance;
    return lerp(bodyAt(ps[prev].duration, ps[prev]), stance, smoothstep(since, 0, recovery));
  }

  const frames = [];
  for (let k = 0; k < n; k++) {
    const t = k / shared.fps;
    let P = body(t);
    const sway = 0.02 * Math.sin(2 * Math.PI * 0.3 * t);
    P = P.map(([x, y]) => [x + sway, y]);
    let absent = false;
    for (const d of distractors) {
      if (t < d.t0 || t > d.t1) continue;
      const u = (t - d.t0) / (d.t1 - d.t0);
      if (d.type === 'leave') absent = true;
      if (d.type === 'walk') P = P.map(([x, y]) => [x + d.dx * Math.sin(Math.PI * u), y]);
      if (d.type === 'waggle' || d.type === 'armRaise') {
        const dy = d.type === 'waggle' ? d.amp * Math.sin(2 * Math.PI * d.hz * (t - d.t0)) : -d.height * Math.sin(Math.PI * u);
        P = P.map(([x, y], j) => (HAND_IDS.includes(j) ? [x, y + dy] : ELBOW_IDS.includes(j) ? [x, y + dy / 2] : [x, y]));
      }
    }
    if (absent) { frames.push({ t: Math.round(t * 1e6) / 1e6, lm: null }); continue; }
    const lm = new Array(NUM_LANDMARKS);
    for (let j = 0; j < NUM_LANDMARKS; j++) {
      const nx = P[j][0] + shared.noise * gaussian(rng);
      const ny = P[j][1] + shared.noise * gaussian(rng);
      lm[j] = [
        (shared.pelvisX * shared.width + shared.facing * nx * shared.torsoPx) / shared.width,
        (shared.pelvisY * shared.height + ny * shared.torsoPx) / shared.height,
        0,
        visibilityFor(j, shared),
      ];
    }
    frames.push({ t: Math.round(t * 1e6) / 1e6, lm });
  }

  return {
    version: 1,
    width: shared.width,
    height: shared.height,
    sampleFps: shared.fps,
    start: 0,
    end: duration,
    model: 'synthetic',
    frames,
    truth: {
      swings: ps.map((p, i) => ({
        motionStart: starts[i] + p.strideStart,
        footPlant: starts[i] + p.plant,
        peakHandSpeed: starts[i] + (p.swingStart + p.swingEnd) / 2,
        swingEnd: starts[i] + p.finish,
      })),
      distractors,
    },
  };
}

/** Keep every `step`-th frame (coarse scan emulation). */
export function decimate(seq, step) {
  return { ...seq, sampleFps: seq.sampleFps / step, frames: seq.frames.filter((_, k) => k % step === 0) };
}
