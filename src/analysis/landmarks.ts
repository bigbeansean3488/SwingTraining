// MediaPipe Pose landmark indices used by the engine.
export const LM = {
  NOSE: 0,
  L_EAR: 7,
  R_EAR: 8,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
} as const;

export const LANDMARK_COUNT = 33;

/** Landmarks kept when compressing keypoints for storage (others are zeroed). */
export const KEPT_LANDMARKS: number[] = [
  0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];

/** Landmarks whose visibility defines per-frame tracking confidence. */
export const KEY_LANDMARKS: number[] = [0, 11, 12, 15, 16, 23, 24, 25, 26, 27, 28];

/** Skeleton edges for drawing. */
export const SKELETON_EDGES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
  [0, 7],
  [0, 8],
];
