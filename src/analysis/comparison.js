// Multi-swing comparison: current swing vs a baseline of recent valid swings.
// Pure. Definitions: docs/metric-definitions.md §5.
import { mean, std } from './signal.js';
import { trajectoryDistance } from './normalize.js';
import { POSE_POINTS } from './pipeline.js';
import { METRIC_VALIDATION } from './validation.js';

export const COMPARISON_DEFAULTS = Object.freeze({
  baselineSize: 5,
  // Measurement-noise floors for the spread estimate. Without a floor, a
  // baseline of near-identical swings would turn trivial differences into huge
  // deviations. Initial values from synthetic noise + 2-frame timing
  // resolution; to be re-estimated from field repeatability data.
  floors: {
    head: 0.03,        // T
    stride: 0.05,      // T
    startToPeak: 0.033, // s (~2 frames at 60 fps)
    plantToPeak: 0.033, // s
    wristPath: 0.02,   // T (mean point-wise distance)
    pose: 0.02,        // T
  },
});

/** Scalar features extracted from a usable SwingAnalysis. null when unavailable. */
export function scalarFeatures(analysis) {
  const m = analysis.metrics;
  return {
    head: m.headStability.value,
    stride: m.stride.value,
    startToPeak: m.timing.value.startToPeak,
    plantToPeak: m.timing.value.plantToPeak,
  };
}

/** Point-wise mean of several trajectories (null where no input has a sample). */
export function meanTrajectory(trajs) {
  const n = Math.max(...trajs.map((t) => t.length));
  return Array.from({ length: n }, (_, i) => {
    const pts = trajs.map((t) => t[i]).filter(Boolean);
    if (!pts.length) return null;
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  });
}

/** Mean over body points of the trajectory distance between two pose trajectories. */
export function poseDistance(a, b, points = POSE_POINTS) {
  const ds = points.map((k) => (a[k] && b[k] ? trajectoryDistance(a[k], b[k]) : null)).filter((d) => d !== null);
  return ds.length ? ds.reduce((x, y) => x + y, 0) / ds.length : null;
}

function meanPose(poses, points = POSE_POINTS) {
  return Object.fromEntries(points.map((k) => [k, meanTrajectory(poses.map((p) => p[k]))]));
}

function compareScalar(current, values, floor) {
  const vals = values.filter((v) => v !== null && v !== undefined);
  if (current === null || current === undefined || !vals.length) return null;
  const m = mean(vals);
  const sd = std(vals); // null when < 2 values
  const spread = Math.max(sd ?? 0, floor);
  const z = (current - m) / spread;
  return {
    current,
    mean: m,
    sd,
    floor,
    spread,
    z,
    deviation: Math.abs(z),
    // How many baseline values are greater / smaller than the current one.
    rank: { greater: vals.filter((v) => v > current).length, smaller: vals.filter((v) => v < current).length, of: vals.length },
  };
}

/**
 * Trajectory comparison. distance = D(current, baseline mean);
 * typical = mean leave-one-out distance of baseline swings to the mean of the
 * other baseline swings (needs >= 2), floored; deviation = distance / typical.
 */
function compareTrajectory(current, baseline, distFn, meanFn, floor) {
  if (!current || !baseline.length) return null;
  const distance = distFn(current, meanFn(baseline));
  if (distance === null) return null;
  let typicalRaw = null;
  if (baseline.length >= 2) {
    const loo = baseline.map((b, i) => distFn(b, meanFn(baseline.filter((_, j) => j !== i)))).filter((d) => d !== null);
    typicalRaw = loo.length ? mean(loo) : null;
  }
  const typical = Math.max(typicalRaw ?? 0, floor);
  return {
    distance,
    typicalRaw,
    floor,
    typical,
    deviation: distance / typical,
    perBaseline: baseline.map((b) => distFn(current, b)),
  };
}

/**
 * Select the baseline: the most recent `baselineSize` usable swings before
 * the current one. `history` is ordered oldest → newest and must not include
 * the current swing.
 */
export function selectBaseline(history, baselineSize = COMPARISON_DEFAULTS.baselineSize) {
  return history.filter((s) => s.analysis?.usable && s.excludeFromBaseline !== true).slice(-baselineSize);
}

/**
 * Compare a usable swing against its baseline.
 * @param current  { id, analysis }
 * @param history  [{ id, analysis, excludeFromBaseline? }] oldest → newest
 */
export function compareToBaseline(current, history, overrides = {}) {
  const o = { ...COMPARISON_DEFAULTS, ...overrides, floors: { ...COMPARISON_DEFAULTS.floors, ...(overrides.floors || {}) } };
  if (!current.analysis?.usable) return { ok: false, reason: 'current swing not usable', baselineCount: 0 };
  const base = selectBaseline(history, o.baselineSize);
  if (!base.length) return { ok: false, reason: 'no previous valid swings yet — this swing starts the baseline', baselineCount: 0, baselineIds: [] };

  const cur = scalarFeatures(current.analysis);
  const feats = base.map((s) => scalarFeatures(s.analysis));
  const scalar = (k) => compareScalar(cur[k], feats.map((f) => f[k]), o.floors[k]);

  const components = {
    head: scalar('head'),
    stride: scalar('stride'),
    timing: { startToPeak: scalar('startToPeak'), plantToPeak: scalar('plantToPeak') },
    wristPath: compareTrajectory(
      current.analysis.metrics.wristPath.value,
      base.map((s) => s.analysis.metrics.wristPath.value).filter(Boolean),
      trajectoryDistance, meanTrajectory, o.floors.wristPath,
    ),
    pose: compareTrajectory(
      current.analysis.trajectory,
      base.map((s) => s.analysis.trajectory).filter(Boolean),
      poseDistance, meanPose, o.floors.pose,
    ),
  };
  return {
    ok: true,
    baselineCount: base.length,
    baselineIds: base.map((s) => s.id),
    components,
    validation: METRIC_VALIDATION.comparison,
  };
}

/** Flat list of (name, deviation) for explanation / ranking. */
export function componentDeviations(cmp) {
  if (!cmp?.ok) return [];
  const c = cmp.components;
  return [
    ['head', c.head?.deviation],
    ['stride', c.stride?.deviation],
    ['timing', Math.max(c.timing.startToPeak?.deviation ?? 0, c.timing.plantToPeak?.deviation ?? 0)],
    ['wristPath', c.wristPath?.deviation],
    ['pose', c.pose?.deviation],
  ].filter(([, d]) => d !== null && d !== undefined);
}
