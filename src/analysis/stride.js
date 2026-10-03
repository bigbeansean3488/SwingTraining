// Stride: lead-ankle displacement from stance to foot plant (T units, +
// toward the pitcher), plus plant location and timing.
import { indicesBetween, trackedFraction, medianPoint, pointAt, confidenceFrom, round } from './metricUtil.js';
import { METRIC_VALIDATION } from './validation.js';

export function stride(norm, events, refIdx, qcLevel = 'good') {
  const stance = medianPoint(norm, 'leadAnkle', refIdx);
  if (!stance) {
    return { value: null, confidence: 0, diagnostics: { reason: 'lead ankle not tracked at stance' }, validation: METRIC_VALIDATION.stride };
  }
  if (events.footPlant === null) {
    return {
      value: 0,
      unit: 'T',
      confidence: confidenceFrom(trackedFraction(norm, 'leadAnkle', refIdx), qcLevel) * 0.5,
      diagnostics: { reason: 'no stride detected (lead foot barely moved)', stanceX: round(stance[0]), stanceY: round(stance[1]) },
      validation: METRIC_VALIDATION.stride,
    };
  }
  // Plant location: median over a short window after the detected plant to
  // reduce noise (foot is stationary there by definition).
  const plantIdx = indicesBetween(norm.times, events.footPlant, Math.min(events.footPlant + 0.1, events.swingEnd));
  const plant = medianPoint(norm, 'leadAnkle', plantIdx) || pointAt(norm, 'leadAnkle', events.footPlant);
  if (!plant) {
    return { value: null, confidence: 0, diagnostics: { reason: 'lead ankle not tracked at plant' }, validation: METRIC_VALIDATION.stride };
  }
  const strideIdx = indicesBetween(norm.times, events.motionStart, events.footPlant);
  let lift = 0;
  for (const k of strideIdx) {
    const y = norm.points.leadAnkle.y[k];
    if (y !== null) lift = Math.max(lift, stance[1] - y); // image y is down
  }
  const cover = trackedFraction(norm, 'leadAnkle', [...refIdx, ...strideIdx, ...plantIdx]);
  return {
    value: round(plant[0] - stance[0]),
    unit: 'T',
    confidence: confidenceFrom(cover, qcLevel),
    diagnostics: {
      strideLength: round(plant[0] - stance[0]),
      strideVertical: round(plant[1] - stance[1]),
      plantX: round(plant[0]), // relative to stance pelvis
      plantY: round(plant[1]),
      stanceX: round(stance[0]),
      footLift: round(lift),
      strideDuration: round(events.footPlant - events.motionStart),
    },
    validation: METRIC_VALIDATION.stride,
  };
}
