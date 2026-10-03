// Pose data model + MediaPipe Pose (33-landmark) topology. Pure, no DOM.
//
// PoseSequence:
// {
//   version: 1,
//   width, height,          // source video pixels (landmark x,y are normalized to these)
//   sampleFps,              // analysis sampling rate (not necessarily the video's fps)
//   start, end,             // analyzed media-time window (s)
//   model,                  // e.g. 'pose_landmarker_full@0.10.35'
//   frames: [{ t, lm }]     // t = media time (s); lm = [[x, y, z, visibility] x 33] or null (no person)
// }

export const LM = Object.freeze({
  NOSE: 0, LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3, RIGHT_EYE_INNER: 4, RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6, LEFT_EAR: 7, RIGHT_EAR: 8, MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12, LEFT_ELBOW: 13, RIGHT_ELBOW: 14, LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18, LEFT_INDEX: 19, RIGHT_INDEX: 20, LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24, LEFT_KNEE: 25, RIGHT_KNEE: 26, LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30, LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
});

export const NUM_LANDMARKS = 33;

export const SKELETON_EDGES = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP], [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW], [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_HIP, LM.LEFT_KNEE], [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE], [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL], [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX], [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL], [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX], [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
  [LM.LEFT_EAR, LM.LEFT_EYE], [LM.LEFT_EYE, LM.NOSE], [LM.NOSE, LM.RIGHT_EYE], [LM.RIGHT_EYE, LM.RIGHT_EAR],
];

/** Landmark groups the V0 metrics depend on. */
export const REQUIRED_GROUPS = Object.freeze({
  head: [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR],
  shoulders: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  hips: [LM.LEFT_HIP, LM.RIGHT_HIP],
  wrists: [LM.LEFT_WRIST, LM.RIGHT_WRIST],
  knees: [LM.LEFT_KNEE, LM.RIGHT_KNEE],
  ankles: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
});

/** Default visibility threshold for treating a landmark as tracked. */
export const VIS_THRESHOLD = 0.5;

/**
 * Convert one MediaPipe PoseLandmarkerResult into the compact `lm` array.
 * Uses the first detected pose; returns null when no person was found.
 */
export function fromMediaPipe(result) {
  const pose = result?.landmarks?.[0];
  if (!pose || pose.length < NUM_LANDMARKS) return null;
  return pose.map((p) => [round(p.x), round(p.y), round(p.z), round(p.visibility ?? 0, 3)]);
}

function round(v, d = 5) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

/** Pixel-space point {x, y, v} for landmark i of a frame, or null. */
export function pointPx(frame, i, width, height) {
  const p = frame?.lm?.[i];
  if (!p) return null;
  return { x: p[0] * width, y: p[1] * height, v: p[3] };
}

/**
 * Per-landmark tracking coverage: fraction of frames where the landmark has
 * visibility >= threshold. Frames without a person count as not tracked.
 */
export function trackingCoverage(seq, threshold = VIS_THRESHOLD) {
  const n = seq.frames.length;
  const counts = new Array(NUM_LANDMARKS).fill(0);
  let withPose = 0;
  for (const f of seq.frames) {
    if (!f.lm) continue;
    withPose++;
    for (let i = 0; i < NUM_LANDMARKS; i++) if (f.lm[i][3] >= threshold) counts[i]++;
  }
  const perLandmark = counts.map((c) => (n ? c / n : 0));
  const groups = {};
  for (const [name, ids] of Object.entries(REQUIRED_GROUPS)) {
    // A group is covered in a frame if its best-visible member is tracked
    // (side view: the far-side limb is often occluded).
    let covered = 0;
    for (const f of seq.frames) {
      if (f.lm && ids.some((i) => f.lm[i][3] >= threshold)) covered++;
    }
    groups[name] = n ? covered / n : 0;
  }
  return { frames: n, poseFraction: n ? withPose / n : 0, perLandmark, groups };
}

/** Landmarks kept when storing a swing (everything the V0 analysis reads). */
export const STORED_LANDMARKS = [
  LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

/**
 * Compact storage form: only STORED_LANDMARKS, x/y/visibility rounded to 4
 * decimals (≈0.2 px on a 1920 px frame), z dropped.
 */
export function reduceSequence(seq) {
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return {
    version: 1,
    width: seq.width,
    height: seq.height,
    sampleFps: seq.sampleFps,
    start: seq.start,
    end: seq.end,
    model: seq.model,
    landmarks: STORED_LANDMARKS,
    frames: seq.frames.map((f) => ({ t: f.t, p: f.lm ? STORED_LANDMARKS.flatMap((i) => [r4(f.lm[i][0]), r4(f.lm[i][1]), r4(f.lm[i][3])]) : null })),
  };
}

/** Inverse of reduceSequence; landmarks not stored get visibility 0. */
export function expandSequence(red) {
  const ids = red.landmarks;
  return {
    version: 1,
    width: red.width,
    height: red.height,
    sampleFps: red.sampleFps,
    start: red.start,
    end: red.end,
    model: red.model,
    frames: red.frames.map((f) => {
      if (!f.p) return { t: f.t, lm: null };
      const lm = Array.from({ length: NUM_LANDMARKS }, () => [0, 0, 0, 0]);
      ids.forEach((i, j) => { lm[i] = [f.p[3 * j], f.p[3 * j + 1], 0, f.p[3 * j + 2]]; });
      return { t: f.t, lm };
    }),
  };
}
