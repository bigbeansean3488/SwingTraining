// Single-swing analysis pipeline. Pure: PoseSequence in, SwingAnalysis out.
//
//   pose → normalize (pass 1) → detect events → QC on swing interval
//        → normalize (pass 2, stance origin just before motion start)
//        → individual metrics (only if QC usable)
import { normalizeSwing, resampleSwing } from './normalize.js';
import { detectEvents } from './temporal.js';
import { assessQuality } from '../pose/quality.js';
import { headStability } from './headStability.js';
import { stride } from './stride.js';
import { wristPath, swingAnchors } from './wristPath.js';
import { timing } from './timing.js';

export const PIPELINE_VERSION = 1;
export const PIPELINE_DEFAULTS = Object.freeze({
  stanceWindow: 0.3,   // s before motion start used as stance reference
  qcPreRoll: 0.3,      // s of context before motion start included in QC
  qcPostRoll: 0.2,     // s after swing end included in QC
});

/** Points kept in the stored, resampled full-body trajectory. */
export const POSE_POINTS = ['head', 'shoulderMid', 'pelvis', 'hands', 'leadElbow', 'rearElbow', 'leadKnee', 'rearKnee', 'leadAnkle', 'rearAnkle'];
export const POSE_SAMPLES = 51;

function frameRange(seq, t0, t1) {
  let from = seq.frames.findIndex((f) => f.t >= t0 - 1e-9);
  if (from < 0) from = seq.frames.length;
  let to = from;
  while (to < seq.frames.length && seq.frames[to].t <= t1 + 1e-9) to++;
  return { from, to };
}

function rejected(reason, extra = {}) {
  return { pipelineVersion: PIPELINE_VERSION, status: 'rejected', usable: false, reason, metrics: null, ...extra };
}

/**
 * Analyze one swing.
 * @returns {object} SwingAnalysis — see docs/architecture.md
 */
export function analyzeSwing(seq, overrides = {}) {
  const o = { ...PIPELINE_DEFAULTS, ...overrides };
  const n1 = normalizeSwing(seq);
  if (!n1.ok) {
    const qc = assessQuality(seq);
    return rejected(`Body not tracked: ${n1.reason}`, { qc });
  }
  const det = detectEvents(n1);
  if (!det.ok) {
    const qc = assessQuality(seq);
    return rejected(det.reason, { qc });
  }
  const ev = det.events;
  const { from, to } = frameRange(seq, ev.motionStart - o.qcPreRoll, ev.swingEnd + o.qcPostRoll);
  const qc = assessQuality(seq, { from, to });
  const base = {
    pipelineVersion: PIPELINE_VERSION,
    events: ev,
    sampleFps: seq.sampleFps,
    qc,
  };
  if (!qc.usable) return rejected('Unable to reliably analyze this swing.', base);

  // Pass 2: anchor the body frame on the stance just before motion starts.
  const norm = normalizeSwing(seq, { originRange: [ev.motionStart - o.stanceWindow, ev.motionStart] });
  if (!norm.ok) return rejected(`Body not tracked: ${norm.reason}`, base);
  const refIdx = norm.refIdx;

  const metrics = {
    headStability: headStability(norm, ev, refIdx, qc.level),
    stride: stride(norm, ev, refIdx, qc.level),
    wristPath: wristPath(norm, ev, qc.level),
    timing: timing(ev, det, seq.sampleFps, qc.level),
  };

  // Reduced full-body trajectory for motion-consistency comparison.
  const traj = resampleSwing(norm, { ta: ev.motionStart, tb: ev.swingEnd, n: POSE_SAMPLES, names: POSE_POINTS, anchors: swingAnchors(ev) });
  const round4 = (p) => (p ? [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4] : null);
  const trajectory = Object.fromEntries(POSE_POINTS.map((k) => [k, traj.points[k].map(round4)]));

  return {
    ...base,
    status: 'ok',
    usable: true,
    reason: null,
    normalization: { T: norm.T, origin: norm.origin, direction: norm.direction, directionSource: norm.directionSource, lead: norm.lead, headProxy: norm.headProxy },
    metrics,
    trajectory,
  };
}
