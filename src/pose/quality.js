// Pose quality control (QC). Pure + deterministic, independent of baseball
// semantics. Decides whether a PoseSequence is reliable enough to measure.
//
// Each check returns { id, status: 'pass'|'warn'|'fail', value, limit, reason, advice }.
// Overall: any fail -> 'poor' (no metrics, excluded from baseline);
//          any warn -> 'fair' (metrics shown with reduced confidence);
//          else     -> 'good'.
// Thresholds live in QC_LIMITS and are documented in docs/metric-definitions.md.

import { LM, REQUIRED_GROUPS, VIS_THRESHOLD } from './landmarks.js';

export const QC_LIMITS = Object.freeze({
  minFrames: 10,
  // Fraction of frames with a detected person.
  presenceFail: 0.8, presenceWarn: 0.95,
  // Fraction of frames where a landmark group is tracked (best-visible member >= VIS_THRESHOLD).
  groupFail: 0.8, groupWarn: 0.9,
  // Longest continuous untracked stretch for a group or the whole body (seconds).
  gapFail: 0.2, gapWarn: 0.1,
  // Body height (head to ankles, median) as a fraction of image height.
  sizeFail: 0.2, sizeWarn: 0.3,
  // Fraction of frames with a required landmark outside the image.
  outFail: 0.1, outWarn: 0.02,
  // Torso-center speed treated as a tracking jump, in torso lengths per second.
  // Real body-center motion in a swing is ~1-3 T/s; this is far above it.
  jumpSpeed: 10,
  // Frame-to-frame torso length change ratio treated as a jump.
  jumpScaleRatio: 0.35,
  jumpWarn: 1, jumpFail: 3,
});

const CORE_GROUPS = ['shoulders', 'hips', 'wrists', 'ankles', 'head'];

const ADVICE = {
  presence: 'Keep the whole player in frame and improve lighting.',
  group_wrists: 'Hands are hard to see — improve lighting or move the camera so the hands are not hidden by the body.',
  group_ankles: 'Feet are not reliably visible — include the feet in the frame and avoid obstructions.',
  group_hips: 'Hips are not reliably visible — keep the full body in frame.',
  group_shoulders: 'Shoulders are not reliably visible — keep the full body in frame.',
  group_head: 'Head is not reliably visible — keep the head in frame.',
  gap: 'Tracking drops out for part of the swing — improve lighting or reduce motion blur (shoot at higher fps if available).',
  size: 'Player is too small in the image — move the camera closer.',
  outOfFrame: 'Player leaves the frame — widen the shot or move the camera back.',
  jumps: 'Skeleton jumps between frames (motion blur, occlusion or another person) — check lighting and background.',
  frames: 'Video segment is too short to analyze.',
};

const LABELS = {
  head: 'head', shoulders: 'shoulder', hips: 'hip', wrists: 'wrist', ankles: 'lead foot / ankle',
};

function groupTracked(lm, group) {
  return !!lm && REQUIRED_GROUPS[group].some((i) => lm[i][3] >= VIS_THRESHOLD);
}

function longestRun(flags, frames) {
  // Longest run of `false` measured in seconds between surrounding frame times.
  let best = 0;
  let runStart = -1;
  for (let k = 0; k <= flags.length; k++) {
    const bad = k < flags.length && !flags[k];
    if (bad && runStart < 0) runStart = k;
    if (!bad && runStart >= 0) {
      const tPrev = runStart > 0 ? frames[runStart - 1].t : frames[runStart].t;
      const tNext = k < frames.length ? frames[k].t : frames[k - 1].t;
      best = Math.max(best, tNext - tPrev);
      runStart = -1;
    }
  }
  return best;
}

function grade(value, failLimit, warnLimit, higherIsBetter) {
  if (higherIsBetter) return value < failLimit ? 'fail' : value < warnLimit ? 'warn' : 'pass';
  return value > failLimit ? 'fail' : value > warnLimit ? 'warn' : 'pass';
}

function midpoint(lm, a, b, W, H) {
  return [((lm[a][0] + lm[b][0]) / 2) * W, ((lm[a][1] + lm[b][1]) / 2) * H];
}

/** Torso center and torso length (px) for a frame. */
export function torsoOf(lm, W, H) {
  const sh = midpoint(lm, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, W, H);
  const hp = midpoint(lm, LM.LEFT_HIP, LM.RIGHT_HIP, W, H);
  return { center: [(sh[0] + hp[0]) / 2, (sh[1] + hp[1]) / 2], length: Math.hypot(sh[0] - hp[0], sh[1] - hp[1]) };
}

function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Detect tracking jumps: frames where the torso center moves implausibly fast
 * or the torso length changes abruptly versus the previous detected frame.
 * @returns {{index:number, t:number, speed:number, scaleRatio:number}[]}
 */
export function detectJumps(seq, limits = QC_LIMITS) {
  const { width: W, height: H, frames } = seq;
  const lengths = frames.filter((f) => f.lm).map((f) => torsoOf(f.lm, W, H).length);
  const ref = median(lengths);
  const jumps = [];
  let prev = null;
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k];
    if (!f.lm) { prev = null; continue; }
    const cur = torsoOf(f.lm, W, H);
    if (prev) {
      const dt = f.t - prev.t;
      const speed = dt > 0 ? Math.hypot(cur.center[0] - prev.center[0], cur.center[1] - prev.center[1]) / ref / dt : Infinity;
      const scaleRatio = Math.abs(cur.length - prev.length) / Math.max(1e-9, Math.min(cur.length, prev.length));
      if (speed > limits.jumpSpeed || scaleRatio > limits.jumpScaleRatio) jumps.push({ index: k, t: f.t, speed, scaleRatio });
    }
    prev = { ...cur, t: f.t };
  }
  return jumps;
}

/**
 * Run all QC checks on a PoseSequence (optionally restricted to frame index
 * range [from, to)).
 */
export function assessQuality(seq, { from = 0, to = seq.frames.length, limits = QC_LIMITS } = {}) {
  const frames = seq.frames.slice(from, to);
  const sub = { ...seq, frames };
  const { width: W, height: H } = seq;
  const n = frames.length;
  const checks = [];
  const add = (id, status, value, limit, reason, advice) => checks.push({ id, status, value, limit, reason, advice });

  if (n < limits.minFrames) {
    add('frames', 'fail', n, limits.minFrames, `only ${n} frames analyzed`, ADVICE.frames);
    return summarize(checks, n);
  }

  // 1. Person presence
  const present = frames.map((f) => !!f.lm);
  const presence = present.filter(Boolean).length / n;
  add('presence', grade(presence, limits.presenceFail, limits.presenceWarn, true), presence, limits.presenceFail,
    `player detected in ${pct(presence)} of frames`, ADVICE.presence);

  // 2. Per-group tracking + 3. longest gap
  for (const g of CORE_GROUPS) {
    const tracked = frames.map((f) => groupTracked(f.lm, g));
    const frac = tracked.filter(Boolean).length / n;
    add(`group_${g}`, grade(frac, limits.groupFail, limits.groupWarn, true), frac, limits.groupFail,
      `${LABELS[g]} tracked in ${pct(frac)} of frames`, ADVICE[`group_${g}`]);
    const gap = longestRun(tracked, frames);
    if (gap > 0) {
      add(`gap_${g}`, grade(gap, limits.gapFail, limits.gapWarn, false), gap, limits.gapFail,
        `${LABELS[g]} tracking lost for ${gap.toFixed(2)} s`, ADVICE.gap);
    }
  }
  const bodyGap = longestRun(present, frames);
  if (bodyGap > 0) {
    add('gap_body', grade(bodyGap, limits.gapFail, limits.gapWarn, false), bodyGap, limits.gapFail,
      `player lost for ${bodyGap.toFixed(2)} s`, ADVICE.gap);
  }

  // 4. Body size
  const heights = frames.filter((f) => f.lm).map((f) => {
    const top = Math.min(f.lm[LM.NOSE][1], f.lm[LM.LEFT_EAR][1], f.lm[LM.RIGHT_EAR][1]);
    const bottom = Math.max(f.lm[LM.LEFT_ANKLE][1], f.lm[LM.RIGHT_ANKLE][1]);
    return (bottom - top);
  });
  const size = heights.length ? median(heights) : 0;
  add('size', grade(size, limits.sizeFail, limits.sizeWarn, true), size, limits.sizeFail,
    `player height is ${pct(size)} of the image`, ADVICE.size);

  // 5. Out of frame: a required group whose best-visible member lies outside the image.
  const outside = frames.filter((f) => f.lm && CORE_GROUPS.some((g) => {
    const best = REQUIRED_GROUPS[g].reduce((a, i) => (f.lm[i][3] > f.lm[a][3] ? i : a));
    const [x, y] = f.lm[best];
    return x < 0 || x > 1 || y < 0 || y > 1;
  })).length / n;
  add('outOfFrame', grade(outside, limits.outFail, limits.outWarn, false), outside, limits.outFail,
    `player partly outside the frame in ${pct(outside)} of frames`, ADVICE.outOfFrame);

  // 6. Tracking jumps
  const jumps = detectJumps(sub, limits);
  add('jumps', jumps.length >= limits.jumpFail ? 'fail' : jumps.length >= limits.jumpWarn ? 'warn' : 'pass', jumps.length, limits.jumpFail,
    `${jumps.length} sudden skeleton jump${jumps.length === 1 ? '' : 's'}`, ADVICE.jumps);

  return summarize(checks, n, { jumps, W, H });
}

function summarize(checks, n, extra = {}) {
  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const level = fails.length ? 'poor' : warns.length ? 'fair' : 'good';
  const problems = [...fails, ...warns];
  return {
    level,
    usable: level !== 'poor',
    frames: n,
    checks,
    reasons: problems.map((c) => c.reason),
    advice: [...new Set(problems.map((c) => c.advice))],
    jumps: extra.jumps ?? [],
  };
}

function pct(x) { return `${Math.round(x * 100)}%`; }
