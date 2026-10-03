// Hand/wrist path: the "hands" point (visibility-weighted wrist mean)
// relative to the per-frame pelvis, resampled over the swing with
// event-anchored time warping, so path shape can be compared across swings
// independently of tempo and of stride/weight-shift translation (which the
// stride metric captures).
import { resampleSwing, trajectoryDistance, relativeToPelvis } from './normalize.js';
import { indicesBetween, trackedFraction, confidenceFrom, round } from './metricUtil.js';
import { METRIC_VALIDATION } from './validation.js';

/** Canonical u positions for events in the time warp (conventions, see docs §4.3). */
export const PATH_ANCHORS = Object.freeze({ footPlant: 0.5, peakHandSpeed: 0.8 });
export const PATH_SAMPLES = 51;

export function swingAnchors(events) {
  const a = [];
  if (events.footPlant !== null && events.footPlant > events.motionStart && events.footPlant < events.peakHandSpeed) {
    a.push({ t: events.footPlant, u: PATH_ANCHORS.footPlant });
  }
  a.push({ t: events.peakHandSpeed, u: PATH_ANCHORS.peakHandSpeed });
  return a;
}

export function wristPath(norm, events, qcLevel = 'good') {
  const rel = {
    ...norm,
    points: { handsRel: relativeToPelvis(norm, 'hands') },
    tracked: { handsRel: norm.tracked.hands.map((h, k) => h && norm.tracked.pelvis[k]) },
  };
  const r = resampleSwing(rel, {
    ta: events.motionStart, tb: events.swingEnd, n: PATH_SAMPLES, names: ['handsRel'], anchors: swingAnchors(events),
  });
  const path = r.points.handsRel;
  const valid = path.filter(Boolean);
  if (valid.length < PATH_SAMPLES / 2) {
    return { value: null, confidence: 0, diagnostics: { reason: 'hands not tracked through the swing', missing: r.missing.handsRel }, validation: METRIC_VALIDATION.wristPath };
  }
  let length = 0;
  for (let i = 1; i < path.length; i++) if (path[i] && path[i - 1]) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const idx = indicesBetween(norm.times, events.motionStart, events.swingEnd);
  return {
    value: path.map((p) => (p ? [round(p[0]), round(p[1])] : null)),
    unit: 'T (resampled path)',
    confidence: confidenceFrom(trackedFraction(rel, 'handsRel', idx) * (valid.length / path.length), qcLevel),
    diagnostics: {
      samples: PATH_SAMPLES,
      frame: 'relative to per-frame pelvis',
      missingSamples: r.missing.handsRel,
      pathLength: round(length),
      maxForward: round(Math.max(...valid.map((p) => p[0]))),
      maxBack: round(Math.min(...valid.map((p) => p[0]))),
      lowest: round(Math.max(...valid.map((p) => p[1]))),
      highest: round(Math.min(...valid.map((p) => p[1]))),
      anchors: PATH_ANCHORS,
    },
    validation: METRIC_VALIDATION.wristPath,
  };
}

/** Mean point-wise distance between two wrist paths (T). */
export function wristPathDistance(a, b) {
  if (!a || !b) return null;
  return trajectoryDistance(a, b);
}
