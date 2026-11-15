// Public entry point of the analysis engine.
import { analyzeBatting } from './batting';
import { analyzePitching } from './pitching';
import type { AnalysisOptions, AnalysisResult, MotionKind, PoseSequence } from './types';

export { ENGINE_VERSION } from './common';
export type * from './types';

export interface AnalyzeOptions extends AnalysisOptions {
  /**
   * Real seconds per media second. For a slow-motion file that plays back
   * stretched (e.g. 240 fps capture saved as 30 fps), timeScale = 30/240.
   * Event times in the result stay in media time; durations are real time.
   */
  timeScale?: number;
}

type Analyzer = (seq: PoseSequence, opts?: AnalysisOptions) => AnalysisResult;
const analyzers: Record<MotionKind, Analyzer> = {
  batting: analyzeBatting,
  pitching: analyzePitching,
};

export function analyze(
  kind: MotionKind,
  seq: PoseSequence,
  opts: AnalyzeOptions = {},
): AnalysisResult {
  const fn = analyzers[kind];
  const s = opts.timeScale && opts.timeScale > 0 ? opts.timeScale : 1;
  if (s === 1) return fn(seq, opts);
  const scaled: PoseSequence = { ...seq, frames: seq.frames.map((f) => ({ ...f, t: f.t * s })) };
  const manual = opts.manualEvents
    ? Object.fromEntries(Object.entries(opts.manualEvents).map(([k, v]) => [k, v * s]))
    : undefined;
  const r = fn(scaled, { ...opts, manualEvents: manual });
  return {
    ...r,
    events: Object.fromEntries(Object.entries(r.events).map(([k, v]) => [k, v / s])),
  };
}
