// Core data types of the pure analysis engine.
// Coordinates are MediaPipe-normalized image coordinates: x in [0,1] of image
// width, y in [0,1] of image height (y grows downward).

export interface Landmark {
  x: number;
  y: number;
  /** MediaPipe visibility in [0,1]; 0 when unknown. */
  v: number;
}

export interface PoseFrame {
  /** Media time in seconds (already corrected by any time scale). */
  t: number;
  /** 33 MediaPipe pose landmarks, or null when no person was detected. */
  lm: Landmark[] | null;
}

export interface PoseSequence {
  /** Image size in pixels (after rotation), needed to undo the aspect ratio. */
  width: number;
  height: number;
  frames: PoseFrame[];
}

export type MotionKind = 'batting' | 'pitching';

export interface MetricResult {
  value: number;
  /** Display unit, e.g. 'torso', 'deg', 'ms', 'torso/s'. */
  unit: string;
  /** 0..1, derived from landmark visibility at the frames used. */
  confidence: number;
  experimental?: boolean;
  diagnostics?: Record<string, number | string | boolean | null>;
}

export type Metrics = Record<string, MetricResult>;

/** Event name -> media time in seconds. */
export type EventTimes = Record<string, number>;

export interface QualityReport {
  ok: boolean;
  /** Short reason codes; see qualityMessage() in the UI for wording. */
  issues: string[];
  warnings: string[];
  fps: number;
  frameCount: number;
  validFraction: number;
  meanConfidence: number;
  /** Per-frame confidence (mean visibility of key landmarks; 0 = no pose). */
  frameConfidence: number[];
}

export interface AnalysisOptions {
  /** Low-pass cutoff (Hz) for positions used in displacements and angles. */
  positionCutoffHz?: number;
  /** Low-pass cutoff (Hz) for the wrist speed signal. */
  speedCutoffHz?: number;
  /** Manually corrected event times (seconds); override detection. */
  manualEvents?: EventTimes;
}

export interface AnalysisResult {
  kind: MotionKind;
  engineVersion: string;
  quality: QualityReport;
  /** Empty when quality or event detection failed. */
  events: EventTimes;
  metrics: Metrics;
  /** +1 if the motion goes toward image right, -1 toward image left. */
  forward: 1 | -1 | 0;
  /** Why no metrics were produced (reason code), if so. */
  failure?: string;
  filter: { positionCutoffHz: number; speedCutoffHz: number; order: number };
}
