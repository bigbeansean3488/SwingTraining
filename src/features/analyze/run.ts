// Orchestrates one analysis: extract poses -> analyze -> keyframes -> save.
import { analyze, ENGINE_VERSION } from '../../analysis';
import type { AnalysisResult, EventTimes, MotionKind, PoseSequence } from '../../analysis/types';
import { packKeypoints } from '../../lib/compress';
import { deleteBlob, putBlob, saveRow, setMeta, updateRow, uuid } from '../../lib/db';
import type { CaptureInfo, KeyframeRef, MotionAnalysis } from '../../lib/types';
import {
  extractPoses,
  seekTo,
  type ExtractOptions,
  type ExtractResult,
  type VideoProbe,
} from '../../pose/extract';
import { drawSkeleton, nearestFrame } from '../../ui/skeleton';

/** Object URLs of videos analyzed in this browser session (not persisted). */
export const sessionVideos = new Map<string, string>();

export interface RunParams {
  kind: MotionKind;
  playerId: string;
  teamId: string | null;
  file: File;
  videoUrl: string;
  video: HTMLVideoElement;
  probe: VideoProbe;
  extract: ExtractOptions;
  /** Real capture frame rate if the file is a time-stretched slow-motion export. */
  captureFps: number | null;
  keepVideo: boolean;
  createdBy: string | null;
}

export interface LastRunStats {
  at: string;
  kind: MotionKind;
  method: string;
  delegate: string;
  model: string;
  frames: number;
  processingMs: number;
  inferMs: number;
  msPerFrame: number;
  sourceFps: number | null;
  width: number;
  height: number;
  codec: string | null;
  fallbackReason: string | null;
  /** Frames the seek fallback could not read (missing in older records). */
  skippedFrames?: number;
}

/** Last failed analysis, shown on the diagnostics page. */
export interface LastErrorInfo {
  at: string;
  /** 'load' = reading the selected file, 'analyze' = frame extraction and inference. */
  stage: 'load' | 'analyze';
  code: string;
  fileSizeMB: number;
  fileType: string;
  fps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
}

export async function runAnalysis(p: RunParams): Promise<MotionAnalysis> {
  const ex = await extractPoses(p.video, p.probe, p.extract);
  const timeScale = p.captureFps && p.probe.fps ? p.probe.fps / p.captureFps : 1;
  const result = analyze(p.kind, ex.seq, { timeScale });
  const id = uuid();
  const keyframes = await captureKeyframes(id, p.video, ex.seq, result.events);
  let videoKey: string | null = null;
  if (p.keepVideo) {
    videoKey = `video:${id}`;
    await putBlob(videoKey, p.file);
  }
  const capture: CaptureInfo = {
    fileName: p.file.name,
    fileSize: p.file.size,
    sourceFps: p.probe.fps,
    analyzedFps: result.quality.fps,
    width: ex.seq.width,
    height: ex.seq.height,
    durationS: p.probe.durationS,
    method: ex.method,
    delegate: ex.delegate,
    frameStride: ex.frameStride,
    timeScale,
    range: [p.extract.start, p.extract.end],
    processingMs: ex.processingMs,
    inferMs: ex.inferMs,
    frames: ex.frames,
    view: 'side',
    codec: p.probe.codec,
    rotation: p.probe.rotation,
    fallbackReason: ex.fallbackReason ?? null,
    userAgent: navigator.userAgent,
  };
  const row = await saveRow('motion_analyses', {
    id,
    player_id: p.playerId,
    team_id: p.teamId,
    kind: p.kind,
    recorded_at: new Date(p.file.lastModified || Date.now()).toISOString(),
    capture,
    fps: result.quality.fps,
    model_version: ex.modelVersion,
    engine_version: ENGINE_VERSION,
    ...resultFields(result),
    manual_events: null,
    keypoints: await packKeypoints(ex.seq),
    keyframes,
    video_blob_key: videoKey,
    note: null,
    marked_good: false,
    created_by: p.createdBy,
  });
  sessionVideos.set(id, p.videoUrl);
  await setMeta('last_run', statsFrom(p, ex));
  return row;
}

function statsFrom(p: RunParams, ex: ExtractResult): LastRunStats {
  return {
    at: new Date().toISOString(),
    kind: p.kind,
    method: ex.method,
    delegate: ex.delegate,
    model: ex.model,
    frames: ex.frames,
    processingMs: ex.processingMs,
    inferMs: ex.inferMs,
    msPerFrame: ex.frames ? Math.round((ex.processingMs / ex.frames) * 10) / 10 : 0,
    sourceFps: p.probe.fps,
    width: p.probe.width,
    height: p.probe.height,
    codec: p.probe.codec,
    fallbackReason: ex.fallbackReason ?? null,
    skippedFrames: ex.skippedFrames,
  };
}

export function resultFields(r: AnalysisResult) {
  return {
    events: r.events,
    metrics: r.metrics,
    quality: {
      ok: r.quality.ok && !r.failure,
      issues: r.quality.issues,
      warnings: r.quality.warnings,
      validFraction: Math.round(r.quality.validFraction * 1000) / 1000,
      meanConfidence: Math.round(r.quality.meanConfidence * 1000) / 1000,
      fps: Math.round(r.quality.fps * 100) / 100,
    },
    failure: r.failure ?? null,
    forward: r.forward,
  };
}

/** Re-run the engine on stored keypoints (e.g. after manual event correction or an engine update). */
export async function recompute(
  row: MotionAnalysis,
  seq: PoseSequence,
  manual: EventTimes | null,
  video?: HTMLVideoElement,
): Promise<MotionAnalysis> {
  const result = analyze(row.kind, seq, {
    timeScale: row.capture.timeScale,
    manualEvents: manual ?? undefined,
  });
  let keyframes = row.keyframes;
  if (video) {
    for (const k of row.keyframes) if (k.blob_key) await deleteBlob(k.blob_key);
    keyframes = await captureKeyframes(row.id, video, seq, result.events);
  }
  return updateRow('motion_analyses', row.id, {
    ...resultFields(result),
    engine_version: ENGINE_VERSION,
    manual_events: manual,
    keyframes,
  });
}

/** Seek to each event and save a small JPEG of the frame with the skeleton drawn. */
export async function captureKeyframes(
  id: string,
  video: HTMLVideoElement,
  seq: PoseSequence,
  events: EventTimes,
): Promise<KeyframeRef[]> {
  const out: KeyframeRef[] = [];
  const times = seq.frames.map((f) => f.t);
  const w = 480;
  const h = Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (const [event, t] of Object.entries(events)) {
    if (event === 'stance') continue;
    try {
      await seekTo(video, t + 0.0005, 15000);
      ctx.drawImage(video, 0, 0, w, h);
      const i = nearestFrame(times, t);
      drawSkeleton(ctx, seq.frames[i]?.lm ?? null, w, h, 0.6);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.72));
      if (!blob) continue;
      const key = `kf:${id}:${event}`;
      await putBlob(key, blob);
      out.push({ event, blob_key: key, path: null });
    } catch {
      // A failed seek only loses that thumbnail.
    }
  }
  return out;
}
