// Frame-by-frame pose extraction from a local video file.
// Strategy (docs/DECISIONS.md D6): WebCodecs sequential decoding first (every
// frame, exact container timestamps, repeatable); seek-per-frame fallback.
import type { PoseFrame, PoseSequence } from '../analysis/types';
import { demuxVideo, type DemuxedVideo } from './demux';
import { createLandmarker, modelVersion, type PoseModel } from './mediapipe';

export type ExtractMethod = 'webcodecs' | 'seek';

export interface VideoProbe {
  durationS: number;
  width: number;
  height: number;
  /** Frame rate from container timestamps (null if the container could not be parsed). */
  fps: number | null;
  frameCount: number | null;
  codec: string | null;
  rotation: number;
  webcodecs: boolean;
  demux: DemuxedVideo | null;
  note?: string;
}

export interface ExtractOptions {
  model: PoseModel;
  /** Analyze every Nth frame (1 = all). */
  frameStride: number;
  start: number;
  end: number;
  forceMethod?: ExtractMethod;
  preferCpu?: boolean;
  /** Longest side of the image handed to MediaPipe. */
  maxSide?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface ExtractResult {
  seq: PoseSequence;
  method: ExtractMethod;
  delegate: 'GPU' | 'CPU';
  model: PoseModel;
  modelVersion: string;
  sourceFps: number | null;
  frameStride: number;
  processingMs: number;
  inferMs: number;
  frames: number;
  /** Frames that could not be read in the seek fallback (left out of the sequence). */
  skippedFrames: number;
  fallbackReason?: string;
}

/** Give up loading when no data arrives for this long (reset on every progress event). */
export const VIDEO_LOAD_IDLE_MS = 60000;

/**
 * Resolves once duration and size are known (loadedmetadata). iOS Safari often
 * never fires loadeddata for an off-screen video that is not playing, so
 * waiting for frame data here made large clips time out (frames are decoded
 * later, by WebCodecs or by seeking).
 */
export function loadVideoElement(
  url: string,
  idleMs = VIDEO_LOAD_IDLE_MS,
): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      v.onloadedmetadata = null;
      v.onprogress = null;
      v.onerror = null;
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('video_load_timeout'));
      }, idleMs);
    };
    v.onloadedmetadata = () => {
      cleanup();
      resolve(v);
    };
    v.onprogress = arm;
    v.onerror = () => {
      cleanup();
      reject(new Error('video_unsupported'));
    };
    arm();
    v.src = url;
    v.load();
  });
}

export async function probeVideo(file: File, video: HTMLVideoElement): Promise<VideoProbe> {
  let demux: DemuxedVideo | null = null;
  let note: string | undefined;
  try {
    demux = await demuxVideo(file);
  } catch (err) {
    note = `container: ${(err as Error).message}`;
  }
  let webcodecs = false;
  let rotation = 0;
  if (demux) {
    rotation = demux.rotation;
    // The <video> element applies rotation; trust its orientation if it disagrees.
    const portraitByElement = video.videoHeight > video.videoWidth;
    const swapped = rotation % 180 !== 0;
    const portraitByTrack = swapped
      ? demux.codedWidth > demux.codedHeight
      : demux.codedHeight > demux.codedWidth;
    if (portraitByElement !== portraitByTrack) rotation = swapped ? 0 : 90;
    demux.rotation = rotation;
    if (typeof VideoDecoder !== 'undefined') {
      try {
        const support = await VideoDecoder.isConfigSupported(decoderConfig(demux));
        webcodecs = !!support.supported;
        if (!webcodecs) note = `WebCodecs: ${demux.codec} not supported`;
      } catch (err) {
        note = `WebCodecs: ${(err as Error).message}`;
      }
    } else {
      note = 'WebCodecs unavailable';
    }
  }
  return {
    durationS: Number.isFinite(video.duration) ? video.duration : (demux?.durationS ?? 0),
    width: video.videoWidth,
    height: video.videoHeight,
    fps: demux && Number.isFinite(demux.fps) ? demux.fps : null,
    frameCount: demux?.frameTimes.length ?? null,
    codec: demux?.codec ?? null,
    rotation,
    webcodecs,
    demux,
    note,
  };
}

function decoderConfig(d: DemuxedVideo): VideoDecoderConfig {
  return {
    codec: d.codec,
    codedWidth: d.codedWidth,
    codedHeight: d.codedHeight,
    description: d.description,
    optimizeForLatency: false,
  };
}

/** Output canvas size for a source of size w×h after rotation, capped at maxSide. */
function outSize(w: number, h: number, rotation: number, maxSide: number) {
  const [rw, rh] = rotation % 180 ? [h, w] : [w, h];
  const k = Math.min(1, maxSide / Math.max(rw, rh));
  return { cw: Math.round(rw * k), ch: Math.round(rh * k) };
}

function drawRotated(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  rotation: number,
  cw: number,
  ch: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (rotation === 90) {
    ctx.translate(cw, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0, ch, cw);
  } else if (rotation === 180) {
    ctx.translate(cw, ch);
    ctx.rotate(Math.PI);
    ctx.drawImage(src, 0, 0, cw, ch);
  } else if (rotation === 270) {
    ctx.translate(0, ch);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(src, 0, 0, ch, cw);
  } else {
    ctx.drawImage(src, 0, 0, cw, ch);
  }
}

export async function extractPoses(
  video: HTMLVideoElement,
  probe: VideoProbe,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const t0 = performance.now();
  const landmarker = await createLandmarker(opts.model, opts.preferCpu);
  let inferMs = 0;
  const frames: PoseFrame[] = [];
  const maxSide = opts.maxSide ?? 1280;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  const infer = (src: CanvasImageSource, w: number, h: number, rotation: number, t: number) => {
    const { cw, ch } = outSize(w, h, rotation, maxSide);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    drawRotated(ctx, src, rotation, cw, ch);
    const a = performance.now();
    const lm = landmarker.detect(canvas, t * 1000);
    inferMs += performance.now() - a;
    frames.push({ t: Math.round(t * 1e6) / 1e6, lm });
  };

  let method: ExtractMethod = 'seek';
  let skippedFrames = 0;
  let fallbackReason: string | undefined;
  try {
    const useWebCodecs = probe.webcodecs && probe.demux && opts.forceMethod !== 'seek';
    if (useWebCodecs) {
      try {
        await decodeWithWebCodecs(probe.demux!, opts, infer);
        method = 'webcodecs';
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        fallbackReason = (err as Error).message;
        frames.length = 0;
      }
    } else {
      fallbackReason = probe.note ?? 'forced';
    }
    if (method === 'seek') {
      // A fresh landmarker keeps the result independent of the failed attempt.
      landmarker.close();
      const fresh = await createLandmarker(opts.model, opts.preferCpu);
      Object.assign(landmarker, { detect: fresh.detect, close: fresh.close });
      skippedFrames = await decodeBySeeking(video, probe, opts, (t) =>
        infer(video, video.videoWidth, video.videoHeight, 0, t),
      );
    }
  } finally {
    landmarker.close();
  }
  const { cw, ch } = outSize(
    canvas.width || video.videoWidth,
    canvas.height || video.videoHeight,
    0,
    1e9,
  );
  return {
    seq: { width: cw, height: ch, frames },
    method,
    delegate: landmarker.delegate,
    model: opts.model,
    modelVersion: modelVersion(opts.model),
    sourceFps: probe.fps,
    frameStride: opts.frameStride,
    processingMs: Math.round(performance.now() - t0),
    inferMs: Math.round(inferMs),
    frames: frames.length,
    skippedFrames,
    fallbackReason,
  };
}

async function decodeWithWebCodecs(
  d: DemuxedVideo,
  opts: ExtractOptions,
  infer: (src: CanvasImageSource, w: number, h: number, rotation: number, t: number) => void,
): Promise<void> {
  const toT = (cts: number, ts: number) => (cts - d.timeOffset) / ts;
  // Presentation-ordered list of frames inside the range decides which to analyze.
  const wanted = d.frameTimes.filter((t) => t >= opts.start - 1e-6 && t <= opts.end + 1e-6);
  const pick = new Set(
    wanted.filter((_, i) => i % opts.frameStride === 0).map((t) => Math.round(t * 1e6)),
  );
  const total = pick.size;
  // Decode from the last sync sample at or before the range start.
  const decodeOrder = d.samples;
  let first = 0;
  for (let i = 0; i < decodeOrder.length; i++) {
    const s = decodeOrder[i]!;
    if (s.is_sync && toT(s.cts, s.timescale) <= opts.start + 1e-6) first = i;
  }
  const queue: VideoFrame[] = [];
  let error: Error | null = null;
  let wake: (() => void) | null = null;
  const decoder = new VideoDecoder({
    output: (f) => {
      queue.push(f);
      wake?.();
    },
    error: (e) => {
      error = e instanceof Error ? e : new Error(String(e));
      wake?.();
    },
  });
  decoder.configure(decoderConfig(d));
  let next = first;
  let done = 0;
  let flushed = false;
  let flushPromise: Promise<void> | null = null;
  // Samples whose presentation time is past the range end still need decoding
  // until every wanted frame came out (B-frame reordering).
  const lastNeeded = Math.max(...[...pick].map((x) => x / 1e6));
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      if (error) throw error;
      while (
        !flushed &&
        next < decodeOrder.length &&
        decoder.decodeQueueSize < 8 &&
        queue.length < 4
      ) {
        const s = decodeOrder[next++]!;
        decoder.decode(
          new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: Math.round(toT(s.cts, s.timescale) * 1e6),
            duration: Math.round((s.duration / s.timescale) * 1e6),
            data: s.data!,
          }),
        );
        // Once a sync sample beyond the last needed frame is queued, nothing earlier is pending.
        if (s.is_sync && toT(s.cts, s.timescale) > lastNeeded + 0.05) {
          next = decodeOrder.length;
        }
      }
      if (!flushed && next >= decodeOrder.length) {
        flushed = true;
        flushPromise = decoder.flush();
        flushPromise.then(() => wake?.()).catch(() => {});
      }
      while (queue.length) {
        const f = queue.shift()!;
        try {
          const t = f.timestamp / 1e6;
          if (pick.has(Math.round(t * 1e6))) {
            infer(f, f.displayWidth, f.displayHeight, d.rotation, t);
            done++;
            opts.onProgress?.(done, total);
          }
        } finally {
          f.close();
        }
        if (done >= total) break;
      }
      if (done >= total) break;
      if (flushed && flushPromise) {
        let settled = false;
        await Promise.race([flushPromise.then(() => (settled = true)), waitFor()]);
        if (settled && queue.length === 0) break;
      } else if (queue.length === 0) {
        await waitFor();
      }
    }
  } finally {
    for (const f of queue) f.close();
    if (decoder.state !== 'closed') decoder.close();
  }
  if (done === 0) throw new Error('WebCodecs produced no frames');

  function waitFor(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, 50);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  }
}

export function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.min(Math.max(t, 0), video.duration || t);
    // Setting currentTime to its current value fires no 'seeked' event.
    if (Math.abs(video.currentTime - target) < 1e-6 && video.readyState >= 2) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('seek_timeout'));
    }, timeoutMs);
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      // Safari can fire 'seeked' before the new frame is painted; wait one frame callback.
      if ('requestVideoFrameCallback' in video) {
        let settled = false;
        video.requestVideoFrameCallback(() => {
          settled = true;
          resolve();
        });
        setTimeout(() => {
          if (!settled) resolve();
        }, 120);
      } else resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = target;
  });
}

/** Seek fallback: a frame that times out twice is skipped, up to this share of frames. */
export const MAX_SKIPPED_FRACTION = 0.05;

/** Returns the number of skipped frames; throws 'seek_failed' when too many fail. */
async function decodeBySeeking(
  video: HTMLVideoElement,
  probe: VideoProbe,
  opts: ExtractOptions,
  infer: (t: number) => void,
): Promise<number> {
  let times: number[];
  if (probe.demux) {
    times = probe.demux.frameTimes;
  } else {
    const fps = await estimateFpsByPlayback(video);
    const n = Math.floor(probe.durationS * fps);
    times = Array.from({ length: n }, (_, i) => i / fps);
  }
  const inRange = times.filter((t) => t >= opts.start - 1e-6 && t <= opts.end + 1e-6);
  const picked = inRange.filter((_, i) => i % opts.frameStride === 0);
  const half = probe.fps ? 0.3 / probe.fps : 0.005;
  const maxSkipped = Math.max(3, Math.floor(picked.length * MAX_SKIPPED_FRACTION));
  let skipped = 0;
  for (let k = 0; k < picked.length; k++) {
    if (opts.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    let ok = true;
    try {
      await seekTo(video, picked[k]! + half);
    } catch {
      // One retry with a longer wait: a slow seek often completes the second time.
      try {
        await seekTo(video, picked[k]! + half, 15000);
      } catch {
        ok = false;
      }
    }
    if (ok) infer(picked[k]!);
    else if (++skipped > maxSkipped) throw new Error('seek_failed');
    opts.onProgress?.(k + 1, picked.length);
  }
  return skipped;
}

/** Frame rate from requestVideoFrameCallback during a short muted playback; 30 if unknown. */
async function estimateFpsByPlayback(video: HTMLVideoElement): Promise<number> {
  if (!('requestVideoFrameCallback' in video)) return 30;
  const samples: { t: number; n: number }[] = [];
  await new Promise<void>((resolve) => {
    const stop = setTimeout(() => {
      video.pause();
      resolve();
    }, 1500);
    const cb = (_: number, meta: VideoFrameCallbackMetadata) => {
      samples.push({ t: meta.mediaTime, n: meta.presentedFrames });
      if (samples.length < 40) video.requestVideoFrameCallback(cb);
      else {
        clearTimeout(stop);
        video.pause();
        resolve();
      }
    };
    video.requestVideoFrameCallback(cb);
    video.play().catch(() => resolve());
  });
  const d: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i]!.n - samples[i - 1]!.n === 1) d.push(samples[i]!.t - samples[i - 1]!.t);
  }
  d.sort((a, b) => a - b);
  const med = d[d.length >> 1];
  await seekTo(video, 0).catch(() => {});
  return med && med > 0 ? 1 / med : 30;
}
