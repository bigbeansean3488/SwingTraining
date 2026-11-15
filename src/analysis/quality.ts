// Pose quality control. Fail visibly: poor tracking produces no numbers.
import { KEY_LANDMARKS } from './landmarks';
import { estimateFps, isNum, mean } from './signal';
import type { PoseSequence, QualityReport } from './types';

export const QC = {
  /** Below this sampling rate, timing metrics are meaningless: reject. */
  minFps: 24,
  /** Below this, warn that timing resolution is limited. */
  lowFpsWarn: 100,
  /** A frame counts as tracked when its key-landmark mean visibility reaches this. */
  minFrameConfidence: 0.5,
  /** Fraction of tracked frames required inside the motion window. */
  minValidFraction: 0.8,
  /** Fraction of tracked frames required over the whole clip before trying. */
  minClipValidFraction: 0.5,
  minFrames: 12,
} as const;

/** Mean visibility of the key landmarks per frame; 0 when no pose was found. */
export function frameConfidence(seq: PoseSequence): number[] {
  return seq.frames.map((f) => {
    if (!f.lm) return 0;
    const v = mean(KEY_LANDMARKS.map((k) => f.lm![k]?.v ?? 0));
    return isNum(v) ? v : 0;
  });
}

/** Clip-level checks done before any event detection. */
export function assessClip(seq: PoseSequence): QualityReport {
  const conf = frameConfidence(seq);
  const fps = estimateFps(seq.frames.map((f) => f.t));
  const valid = conf.filter((c) => c >= QC.minFrameConfidence).length;
  const validFraction = conf.length ? valid / conf.length : 0;
  const issues: string[] = [];
  const warnings: string[] = [];
  if (seq.frames.length < QC.minFrames) issues.push('too_few_frames');
  if (!isNum(fps) || fps < QC.minFps) issues.push('fps_too_low');
  else if (fps < QC.lowFpsWarn) warnings.push('fps_low');
  if (validFraction < QC.minClipValidFraction) issues.push('tracking_poor');
  return {
    ok: issues.length === 0,
    issues,
    warnings,
    fps: isNum(fps) ? fps : 0,
    frameCount: seq.frames.length,
    validFraction,
    meanConfidence: isNum(mean(conf)) ? mean(conf) : 0,
    frameConfidence: conf,
  };
}

/** Fraction of frames with time in [t0, t1] that are tracked. */
export function windowValidFraction(
  seq: PoseSequence,
  conf: number[],
  t0: number,
  t1: number,
): number {
  let n = 0;
  let ok = 0;
  seq.frames.forEach((f, i) => {
    if (f.t >= t0 - 1e-9 && f.t <= t1 + 1e-9) {
      n++;
      if (conf[i]! >= QC.minFrameConfidence) ok++;
    }
  });
  return n ? ok / n : 0;
}
