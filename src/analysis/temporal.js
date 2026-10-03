// Swing event detection from normalized tracks. Pure.
// Events are approximate motion landmarks, NOT bat-ball contact.
// Definitions: docs/metric-definitions.md §3.
import { speed2d } from './signal.js';

export const EVENT_DEFAULTS = Object.freeze({
  activityAbs: 0.5,       // T/s: absolute floor of the "moving" threshold
  activityRel: 0.05,      // fraction of peak hand speed
  plantRel: 0.1,          // plant when lead-ankle speed < 10% of its stride peak
  minStridePeak: 0.8,     // T/s: below this no stride is detected
  minPeakHandSpeed: 2.0,  // T/s: below this there is no swing in the window
  maxPause: 0.15,         // s: sub-threshold pauses this short stay part of the same motion
});

/** Linear-interpolated time where series crosses `level` between frames i and j. */
function crossing(times, s, i, j, level) {
  const a = s[i];
  const b = s[j];
  if (a === null || b === null || a === b) return times[j];
  const f = (level - a) / (b - a);
  return times[i] + Math.min(1, Math.max(0, f)) * (times[j] - times[i]);
}

/** Sub-frame peak time by fitting a parabola through the max and its neighbors. */
function refinePeak(times, s, k) {
  if (k <= 0 || k >= s.length - 1 || s[k - 1] === null || s[k + 1] === null) return times[k];
  const y0 = s[k - 1];
  const y1 = s[k];
  const y2 = s[k + 1];
  const denom = y0 - 2 * y1 + y2;
  if (denom === 0) return times[k];
  const off = (0.5 * (y0 - y2)) / denom; // in samples, |off| <= 0.5 for a true peak
  const dt = (times[k + 1] - times[k - 1]) / 2;
  return times[k] + Math.max(-0.5, Math.min(0.5, off)) * dt;
}

function argmax(s, from = 0, to = s.length) {
  let best = -1;
  for (let k = from; k < to; k++) if (s[k] !== null && (best < 0 || s[k] > s[best])) best = k;
  return best;
}

/**
 * Detect swing events in a normalized swing (see normalize.js).
 * @returns {{ ok: boolean, reason?: string, events: object, indices: object, signals: object, thresholds: object }}
 */
export function detectEvents(norm, overrides = {}) {
  const o = { ...EVENT_DEFAULTS, ...overrides };
  const { times, points } = norm;
  const hand = speed2d(times, points.hands.x, points.hands.y);
  const ankle = speed2d(times, points.leadAnkle.x, points.leadAnkle.y);
  const signals = { hand, ankle };

  const kPeak = argmax(hand);
  if (kPeak < 0 || hand[kPeak] < o.minPeakHandSpeed) {
    return { ok: false, reason: 'no swing motion detected (hands barely move)', events: {}, indices: {}, signals, thresholds: {} };
  }
  const peakHandSpeed = hand[kPeak];
  const theta = Math.max(o.activityAbs, o.activityRel * peakHandSpeed);
  const activity = times.map((_, k) => Math.max(hand[k] ?? 0, ankle[k] ?? 0));

  // Motion start: walk back from the peak through active frames; a pause
  // shorter than maxPause (e.g. between foot plant and the swing) does not
  // end the motion.
  let kStart = kPeak;
  for (;;) {
    while (kStart > 0 && activity[kStart - 1] >= theta) kStart--;
    if (kStart === 0) break;
    let j = kStart - 1;
    while (j >= 0 && activity[j] < theta) j--;
    if (j < 0 || times[kStart] - times[j + 1] > o.maxPause) break;
    kStart = j + 1;
  }
  if (kStart === 0) {
    return { ok: false, reason: 'swing starts before the analyzed window — include more time before the swing', events: {}, indices: {}, signals, thresholds: { theta } };
  }
  const tStart = crossing(times, activity, kStart - 1, kStart, theta);

  // End of swing: first frame after the peak with hand speed below threshold.
  let kEnd = kPeak;
  while (kEnd < times.length - 1 && (hand[kEnd + 1] ?? 0) >= theta) kEnd++;
  const endInside = kEnd < times.length - 1;
  const tEnd = endInside ? crossing(times, hand, kEnd, kEnd + 1, theta) : times[kEnd];

  // Foot plant: after the lead ankle's stride peak (between start and hand peak),
  // first time its speed falls below plantRel × that peak.
  let tPlant = null;
  let kAnklePeak = argmax(ankle, kStart, kPeak + 1);
  let stridePeak = kAnklePeak >= 0 ? ankle[kAnklePeak] : 0;
  if (stridePeak >= o.minStridePeak) {
    const level = o.plantRel * stridePeak;
    let k = kAnklePeak;
    while (k < times.length - 1 && (ankle[k + 1] ?? Infinity) >= level) k++;
    if (k < times.length - 1) tPlant = crossing(times, ankle, k, k + 1, level);
  } else {
    kAnklePeak = -1;
    stridePeak = 0;
  }

  const tPeak = refinePeak(times, hand, kPeak);
  return {
    ok: true,
    events: {
      motionStart: tStart,
      footPlant: tPlant,
      peakHandSpeed: tPeak,
      swingEnd: tEnd,
    },
    endInsideWindow: endInside,
    indices: { start: kStart, peak: kPeak, end: kEnd, anklePeak: kAnklePeak },
    peakHandSpeed,
    stridePeakSpeed: stridePeak,
    signals,
    thresholds: { theta, plant: tPlant === null ? null : o.plantRel * stridePeak },
  };
}
