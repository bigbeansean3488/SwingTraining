// Head stability: how far the head proxy moves from its stance position
// during the swing, in the anchored body frame (T units). Lower = steadier.
import { indicesBetween, trackedFraction, medianPoint, pointAt, confidenceFrom, round } from './metricUtil.js';
import { relativeToPelvis } from './normalize.js';
import { METRIC_VALIDATION } from './validation.js';

/**
 * @param norm   normalized swing (origin = stance pelvis)
 * @param events detected events (motionStart, peakHandSpeed, swingEnd)
 * @param refIdx stance reference frame indices
 */
export function headStability(norm, events, refIdx, qcLevel = 'good') {
  const idx = indicesBetween(norm.times, events.motionStart, events.swingEnd);
  const ref = medianPoint(norm, 'head', refIdx);
  if (!ref || !idx.length) {
    return { value: null, confidence: 0, diagnostics: { reason: 'head not tracked at stance or during swing' }, validation: METRIC_VALIDATION.headStability };
  }
  const head = norm.points.head;
  let maxD = 0;
  let sumSq = 0;
  let count = 0;
  let path = 0;
  let prev = null;
  for (const k of idx) {
    if (head.x[k] === null) { prev = null; continue; }
    const p = [head.x[k], head.y[k]];
    const d = Math.hypot(p[0] - ref[0], p[1] - ref[1]);
    maxD = Math.max(maxD, d);
    sumSq += d * d;
    count++;
    if (prev) path += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  const atPeak = pointAt(norm, 'head', events.peakHandSpeed);
  // Moving-origin variant: head relative to the per-frame pelvis.
  const rel = relativeToPelvis(norm, 'head');
  const relRef = [refIdx.map((k) => rel.x[k]).filter((v) => v !== null), refIdx.map((k) => rel.y[k]).filter((v) => v !== null)];
  const relRefPt = relRef[0].length ? [relRef[0].reduce((a, b) => a + b) / relRef[0].length, relRef[1].reduce((a, b) => a + b) / relRef[1].length] : null;
  let maxRel = null;
  if (relRefPt) {
    maxRel = 0;
    for (const k of idx) if (rel.x[k] !== null) maxRel = Math.max(maxRel, Math.hypot(rel.x[k] - relRefPt[0], rel.y[k] - relRefPt[1]));
  }
  return {
    value: round(maxD),
    unit: 'T',
    confidence: confidenceFrom(trackedFraction(norm, 'head', idx), qcLevel),
    diagnostics: {
      maxDisplacement: round(maxD),
      rmsDisplacement: round(count ? Math.sqrt(sumSq / count) : null),
      pathLength: round(path),
      forwardAtPeak: atPeak ? round(atPeak[0] - ref[0]) : null, // + toward pitcher
      dropAtPeak: atPeak ? round(atPeak[1] - ref[1]) : null,    // + downward
      maxDisplacementVsPelvis: round(maxRel),
      headProxy: norm.headProxy,
    },
    validation: METRIC_VALIDATION.headStability,
  };
}
