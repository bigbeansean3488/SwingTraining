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

/**
 * Run pose detection while the video plays (muted), on frames delivered by
 * requestVideoFrameCallback. Much faster than seeking frame by frame on long
 * or high-resolution clips. Frames are taken at most every 1/targetFps s of
 * media time; the playback rate adapts so detection keeps up, but a slow
 * device can still skip frames, so the effective rate is reported.
 * Falls back to seeking when requestVideoFrameCallback is unavailable.
 *
 * @returns {Promise<import('./landmarks.js').PoseSequence>}
 */
export async function extractPoseByPlayback(video, {
  variant = 'lite', start = 0, end = video.duration, targetFps = 15, videoFps = 30,
  rate = 1, minRate = 0.1, maxRate = 2, onProgress, signal,
} = {}) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    return { ...(await extractPoseSequence(video, { variant, start, end, sampleFps: targetFps, onProgress, signal })), method: 'seek' };
  }
  const { landmarker, delegate, model } = await getPoseLandmarker(variant);
  await seekTo(video, start);
  const frames = [];
  const interval = 1 / targetFps;
  const perMediaSecond = Math.min(targetFps, videoFps);
  let nextT = start;
  let costMs = null; // EMA of detection time per frame
  const rates = [];
  const t0 = performance.now();
  video.muted = true;
  video.playbackRate = rate;

  await new Promise((resolve, reject) => {
    let done = false;
    let lastProgress = performance.now();
    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(watch);
      video.removeEventListener('ended', onEnded);
      video.pause();
      if (err) reject(err); else resolve();
    };
    const onEnded = () => finish();
    const onFrame = (_now, meta) => {
      if (done) return;
      if (signal?.aborted) return finish(new DOMException('Analysis cancelled', 'AbortError'));
      const mt = meta.mediaTime;
      if (mt > end + 1e-3) return finish();
      lastProgress = performance.now();
      if (mt + 1e-3 >= nextT && mt >= start - 1e-3) {
        while (nextT <= mt + 1e-3) nextT += interval;
        const ts = Math.max(tsBase, Math.round(mt * 1000));
        const c0 = performance.now();
        const result = landmarker.detectForVideo(video, ts);
        const c = performance.now() - c0;
        tsBase = ts + 1;
        frames.push({ t: round3(mt), lm: fromMediaPipe(result) });
        costMs = costMs === null ? c : 0.8 * costMs + 0.2 * c;
        // Detection must take < ~75% of the wall time one media frame lasts.
        const want = Math.min(maxRate, Math.max(minRate, 750 / (perMediaSecond * costMs)));
        if (Math.abs(want - video.playbackRate) / video.playbackRate > 0.15) video.playbackRate = want;
        rates.push(video.playbackRate);
        onProgress?.(Math.min(1, (mt - start) / Math.max(1e-3, end - start)), frames[frames.length - 1]);
      }
      video.requestVideoFrameCallback(onFrame);
    };
    // Safari may pause playback (e.g. when the tab is hidden): resume, and
    // give up if no frame arrives for a long time.
    const watch = setInterval(() => {
      if (done) return;
      if (video.paused && !video.ended) video.play().catch(() => {});
      if (performance.now() - lastProgress > 10000) finish(new Error('影片播放停止，無法繼續分析。'));
    }, 1000);
    video.addEventListener('ended', onEnded);
    video.requestVideoFrameCallback(onFrame);
    video.play().catch((err) => finish(err));
  });
  video.playbackRate = 1;

  const dts = frames.slice(1).map((f, k) => f.t - frames[k].t).filter((d) => d > 0).sort((a, b) => a - b);
  const medDt = dts.length ? dts[dts.length >> 1] : interval;
  return {
    version: 1,
    width: video.videoWidth,
    height: video.videoHeight,
    sampleFps: Math.round(1 / medDt),
    start,
    end,
    model,
    delegate,
    method: 'playback',
    playbackRate: rates.length ? round3(rates.reduce((a, b) => a + b, 0) / rates.length) : rate,
    processingMs: Math.round(performance.now() - t0),
    frames,
  };
}

function round3(v) { return Math.round(v * 1000) / 1000; }
