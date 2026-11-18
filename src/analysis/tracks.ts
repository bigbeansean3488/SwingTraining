// Turns a PoseSequence into uniformly sampled, gap-filled, low-pass filtered
// landmark tracks in pixel space.
import { LANDMARK_COUNT, LM } from './landmarks';
import type { PoseSequence } from './types';
import {
  estimateFps,
  fillGaps,
  holdEdges,
  interpAt,
  isNum,
  lowpassZeroLag,
  median,
} from './signal';
import type { Vec } from './geometry';

/** Landmarks below this visibility are treated as missing before filtering. */
export const MIN_VISIBILITY = 0.3;
/** Longest gap (seconds) that is interpolated; longer gaps stay missing. */
export const MAX_GAP_S = 0.1;

export interface Track {
  x: number[];
  y: number[];
  /** Visibility resampled to the uniform grid (0 where missing). */
  v: number[];
}

export interface Tracks {
  fs: number;
  t: number[];
  n: number;
  /** Median torso length (mid-shoulder to mid-hip) in pixels. */
  torso: number;
  pos(idx: number): Track;
  fast(idx: number): Track;
  at(idx: number, i: number): Vec;
  mid(a: number, b: number, i: number): Vec;
}

export function buildTracks(
  input: PoseSequence,
  positionCutoffHz: number,
  speedCutoffHz: number,
): Tracks {
  const seq = fixLegLabelSwaps(input);
  const srcT = seq.frames.map((f) => f.t);
  const fs = estimateFps(srcT);
  const t0 = srcT[0] ?? 0;
  const tEnd = srcT[srcT.length - 1] ?? 0;
  const n = isNum(fs) ? Math.max(1, Math.round((tEnd - t0) * fs) + 1) : 0;
  const t = Array.from({ length: n }, (_, i) => t0 + i / fs);
  const maxGap = Math.max(1, Math.round(MAX_GAP_S * fs));

  const rawX: number[][] = [];
  const rawY: number[][] = [];
  const rawV: number[][] = [];
  for (let k = 0; k < LANDMARK_COUNT; k++) {
    const xs: number[] = [];
    const ys: number[] = [];
    const vs: number[] = [];
    for (const f of seq.frames) {
      const p = f.lm?.[k];
      if (p && p.v >= MIN_VISIBILITY) {
        xs.push(p.x * seq.width);
        ys.push(p.y * seq.height);
      } else {
        xs.push(NaN);
        ys.push(NaN);
      }
      vs.push(p ? p.v : 0);
    }
    rawX.push(resample(srcT, xs, t));
    rawY.push(resample(srcT, ys, t));
    rawV.push(resample(srcT, vs, t).map((v) => (isNum(v) ? v : 0)));
  }

  const cachePos = new Map<number, Track>();
  const cacheFast = new Map<number, Track>();
  const make = (idx: number, cutoff: number): Track => {
    const filt = (arr: number[]) => {
      const filled = fillGaps(arr, maxGap);
      const missing = filled.map((v) => !isNum(v));
      if (missing.every(Boolean)) return filled;
      const y = lowpassZeroLag(holdEdges(filled), cutoff, fs);
      return y.map((v, i) => (missing[i] ? NaN : v));
    };
    return { x: filt(rawX[idx]!), y: filt(rawY[idx]!), v: rawV[idx]! };
  };
  const pos = (idx: number) => {
    let tr = cachePos.get(idx);
    if (!tr) cachePos.set(idx, (tr = make(idx, positionCutoffHz)));
    return tr;
  };
  const fast = (idx: number) => {
    let tr = cacheFast.get(idx);
    if (!tr) cacheFast.set(idx, (tr = make(idx, speedCutoffHz)));
    return tr;
  };
  const at = (idx: number, i: number): Vec => {
    const tr = pos(idx);
    return { x: tr.x[i] ?? NaN, y: tr.y[i] ?? NaN };
  };
  const mid = (a: number, b: number, i: number): Vec => {
    const pa = at(a, i);
    const pb = at(b, i);
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  };

  const torsoSamples: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = mid(LM.L_SHOULDER, LM.R_SHOULDER, i);
    const h = mid(LM.L_HIP, LM.R_HIP, i);
    torsoSamples.push(Math.hypot(s.x - h.x, s.y - h.y));
  }

  return { fs, t, n, torso: median(torsoSamples), pos, fast, at, mid };
}

/** Left/right landmark pairs below the hip that side views tend to mislabel. */
const LEG_PAIRS: [number, number][] = [
  [LM.L_KNEE, LM.R_KNEE],
  [LM.L_ANKLE, LM.R_ANKLE],
  [LM.L_HEEL, LM.R_HEEL],
  [LM.L_FOOT, LM.R_FOOT],
];
/** Swap only when the swapped assignment is this much closer to the previous frame. */
export const SWAP_COST_RATIO = 0.5;

/**
 * From the side, the pose model often swaps the left/right labels of the legs
 * for a stretch of frames. Before any filtering, each frame's knee and ankle
 * labels are compared with the previous frame: when the crossed assignment is
 * clearly closer, the leg labels (knee to toe) of that frame are swapped back.
 * Returns a new sequence; the input is not modified.
 */
export function fixLegLabelSwaps(seq: PoseSequence): PoseSequence {
  const key = [LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE];
  let prev: { x: number; y: number }[] | null = null;
  let changed = false;
  const frames = seq.frames.map((f) => {
    if (!f.lm) return f;
    const ok = key.every((k) => (f.lm![k]?.v ?? 0) >= MIN_VISIBILITY);
    if (!ok) return f;
    const px = (k: number) => ({ x: f.lm![k]!.x * seq.width, y: f.lm![k]!.y * seq.height });
    let cur = key.map(px);
    if (prev) {
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const same =
        d(cur[0]!, prev[0]!) + d(cur[1]!, prev[1]!) + d(cur[2]!, prev[2]!) + d(cur[3]!, prev[3]!);
      const crossed =
        d(cur[0]!, prev[1]!) + d(cur[1]!, prev[0]!) + d(cur[2]!, prev[3]!) + d(cur[3]!, prev[2]!);
      if (crossed < SWAP_COST_RATIO * same) {
        const lm = [...f.lm];
        for (const [l, r] of LEG_PAIRS) [lm[l], lm[r]] = [f.lm[r]!, f.lm[l]!];
        cur = [cur[1]!, cur[0]!, cur[3]!, cur[2]!];
        changed = true;
        f = { ...f, lm };
      }
    }
    prev = cur;
    return f;
  });
  return changed ? { ...seq, frames } : seq;
}

/** Linear resampling that keeps NaN where either neighbor is missing. */
function resample(srcT: number[], values: number[], t: number[]): number[] {
  return t.map((tq) => interpAt(srcT, values, tq));
}

/** Index of the first uniform-grid sample at or after time `tq`; -1 if past the end. */
export function indexAtOrAfter(tr: Tracks, tq: number): number {
  if (!tr.n) return -1;
  const i = Math.max(0, Math.ceil((tq - tr.t[0]!) * tr.fs - 1e-6));
  return i < tr.n ? i : -1;
}

/** Index of the uniform-grid sample nearest to time `tq`. */
export function indexAt(tr: Tracks, tq: number): number {
  if (!tr.n) return -1;
  return Math.min(tr.n - 1, Math.max(0, Math.round((tq - tr.t[0]!) * tr.fs)));
}
