// Timing features from detected events (seconds of media time).
// Peak hand speed is a swing-event proxy, NOT bat-ball contact.
import { confidenceFrom, round } from './metricUtil.js';
import { METRIC_VALIDATION } from './validation.js';

export function timing(events, detection, sampleFps, qcLevel = 'good') {
  const { motionStart, footPlant, peakHandSpeed, swingEnd } = events;
  const diff = (a, b) => (a === null || b === null ? null : round(b - a, 4));
  // Event times are interpolated between frames; their resolution is still
  // limited by the sampling rate, so confidence is lower at low fps.
  const fpsFactor = Math.min(1, sampleFps / 60);
  return {
    value: {
      startToPlant: diff(motionStart, footPlant),
      plantToPeak: diff(footPlant, peakHandSpeed),
      startToPeak: diff(motionStart, peakHandSpeed),
      peakToEnd: diff(peakHandSpeed, swingEnd),
      total: diff(motionStart, swingEnd),
    },
    unit: 's',
    confidence: confidenceFrom(fpsFactor * (footPlant === null ? 0.6 : 1) * (detection.endInsideWindow ? 1 : 0.6), qcLevel),
    diagnostics: {
      events: Object.fromEntries(Object.entries(events).map(([k, v]) => [k, round(v, 4)])),
      peakHandSpeed: round(detection.peakHandSpeed, 3), // T/s
      stridePeakSpeed: round(detection.stridePeakSpeed, 3),
      sampleFps,
      frameResolution: round(1 / sampleFps, 4),
      endInsideWindow: detection.endInsideWindow,
    },
    validation: METRIC_VALIDATION.timing,
  };
}
