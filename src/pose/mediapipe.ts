// MediaPipe Pose Landmarker wrapper. Runs entirely on-device.
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { Landmark } from '../analysis/types';

export type PoseModel = 'lite' | 'full' | 'heavy';
export const TASKS_VISION_VERSION = '1.2.3';
export const MODEL_URLS: Record<PoseModel, string> = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

export function modelVersion(model: PoseModel): string {
  return `pose_landmarker_${model}/float16/1@tasks-vision-${TASKS_VISION_VERSION}`;
}

export interface Landmarker {
  detect(image: TexImageSource, timestampMs: number): Landmark[] | null;
  delegate: 'GPU' | 'CPU';
  model: PoseModel;
  close(): void;
}

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

/**
 * A fresh landmarker per analysis: VIDEO mode tracks across frames, so reusing
 * one would make the first frames depend on the previous clip (not repeatable).
 */
export async function createLandmarker(model: PoseModel, preferCpu = false): Promise<Landmarker> {
  filesetPromise ??= FilesetResolver.forVisionTasks(`${location.origin}/mediapipe/wasm`);
  const fileset = await filesetPromise;
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URLS[model], delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  let delegate: 'GPU' | 'CPU' = preferCpu ? 'CPU' : 'GPU';
  let lm: PoseLandmarker;
  try {
    lm = await make(delegate);
  } catch (err) {
    if (delegate === 'CPU') throw err;
    console.warn('GPU delegate unavailable, falling back to CPU', err);
    delegate = 'CPU';
    lm = await make('CPU');
  }
  let lastTs = -1;
  return {
    delegate,
    model,
    detect(image, timestampMs) {
      // VIDEO mode needs strictly increasing timestamps.
      const ts = Math.max(lastTs + 1, Math.round(timestampMs));
      lastTs = ts;
      return fromResult(lm.detectForVideo(image, ts));
    },
    close() {
      lm.close();
    },
  };
}

function fromResult(r: PoseLandmarkerResult): Landmark[] | null {
  const pose = r.landmarks?.[0];
  if (!pose || !pose.length) return null;
  return pose.map((p) => ({
    x: round5(p.x),
    y: round5(p.y),
    v: round5(p.visibility ?? 0),
  }));
}

function round5(v: number) {
  return Math.round(v * 1e5) / 1e5;
}

/** Download a model into the cache so analysis works offline later. */
export async function prefetchModel(model: PoseModel): Promise<void> {
  const res = await fetch(MODEL_URLS[model]);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  await res.arrayBuffer();
  await fetch(`${location.origin}/mediapipe/wasm/vision_wasm_internal.wasm`).then((r) =>
    r.arrayBuffer(),
  );
  await fetch(`${location.origin}/mediapipe/wasm/vision_wasm_internal.js`).then((r) => r.text());
}
