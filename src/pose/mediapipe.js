// MediaPipe Pose Landmarker wrapper (browser only). Loads from CDN, runs
// entirely on-device. Produces a PoseSequence (see landmarks.js).
import { fromMediaPipe } from './landmarks.js';
import { seekTo } from '../ui/video.js';

export const TASKS_VISION_VERSION = '0.10.35';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`;
const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

let visionModule = null;
const cache = new Map();

async function loadVision() {
  if (!visionModule) visionModule = await import(`${CDN}/vision_bundle.mjs`);
  return visionModule;
}

/**
 * Create (or reuse) a PoseLandmarker in VIDEO mode. Tries GPU first and
 * falls back to CPU (some iOS versions / headless browsers lack WebGL2 GPU
 * delegate support).
 */
export async function getPoseLandmarker(variant = 'full') {
  if (cache.has(variant)) return cache.get(variant);
  const { FilesetResolver, PoseLandmarker } = await loadVision();
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODELS[variant], delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await make('GPU');
  } catch (err) {
    console.warn('GPU delegate failed, using CPU:', err?.message || err);
    delegate = 'CPU';
    landmarker = await make('CPU');
  }
  const entry = { landmarker, delegate, model: `pose_landmarker_${variant}@${TASKS_VISION_VERSION}` };
  cache.set(variant, entry);
  return entry;
}

let tsBase = 0;

/**
 * Seek through [start, end] at `sampleFps` and run pose detection on each
 * frame. Seeking (rather than real-time playback) makes results independent
 * of device speed: every sampled frame is analyzed.
 *
 * @returns {Promise<import('./landmarks.js').PoseSequence>}
 */
export async function extractPoseSequence(video, { variant = 'full', start = 0, end = video.duration, sampleFps = 30, onProgress, signal } = {}) {
  const { landmarker, delegate, model } = await getPoseLandmarker(variant);
  const step = 1 / sampleFps;
  const times = [];
  for (let t = start; t <= end + 1e-6; t += step) times.push(Math.min(t, video.duration - 1e-3));
  const frames = [];
  // VIDEO mode needs strictly increasing timestamps across calls, including
  // across separate analyses with the same landmarker.
  const base = tsBase;
  const t0 = performance.now();
  for (let k = 0; k < times.length; k++) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    await seekTo(video, times[k]);
    const ts = base + Math.round(times[k] * 1000) + k; // +k keeps strict monotonicity
    const result = landmarker.detectForVideo(video, ts);
    frames.push({ t: round3(video.currentTime), lm: fromMediaPipe(result) });
    tsBase = ts + 1;
    onProgress?.((k + 1) / times.length, frames[frames.length - 1]);
  }
  return {
    version: 1,
    width: video.videoWidth,
    height: video.videoHeight,
    sampleFps,
    start,
    end,
    model,
    delegate,
    processingMs: Math.round(performance.now() - t0),
    frames,
  };
}

function round3(v) { return Math.round(v * 1000) / 1000; }
