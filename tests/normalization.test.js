import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSwing, resampleSwing, trajectoryDistance, relativeToPelvis, POINTS } from '../src/analysis/normalize.js';
import { fillShortGaps, interpAt, movingAverage } from '../src/analysis/signal.js';
import { generateSwing, transformImage, setVisibility } from '../src/synthetic/swing.js';
import { LM } from '../src/pose/landmarks.js';

const resampled = (seq, opts = {}) => resampleSwing(normalizeSwing(seq, opts), { n: 101 });

/** Max over points of the mean point-wise distance between two resampled swings. */
function maxDistance(a, b, names = POINTS) {
  return Math.max(...names.map((k) => trajectoryDistance(a.points[k], b.points[k])));
}

const base = generateSwing();
const baseR = resampled(base);

// ---------- signal helpers ----------

test('fillShortGaps interpolates short interior gaps only', () => {
  assert.deepEqual(fillShortGaps([0, null, null, 3], 2), [0, 1, 2, 3]);
  assert.deepEqual(fillShortGaps([0, null, null, null, 4], 2), [0, null, null, null, 4]);
  assert.deepEqual(fillShortGaps([null, 1, null], 3), [null, 1, null]);
});

test('interpAt interpolates and refuses outside/null neighbors', () => {
  assert.equal(interpAt([0, 1], [0, 10], 0.25), 2.5);
  assert.equal(interpAt([0, 1], [0, 10], 2), null);
  assert.equal(interpAt([0, 1, 2], [0, null, 2], 0.5), null);
});

test('movingAverage keeps nulls and averages available neighbors', () => {
  assert.deepEqual(movingAverage([0, 3, null, 6], 3), [1.5, 1.5, null, 6]);
});

// ---------- normalization invariances ----------

test('basic normalized geometry: origin at stance pelvis, torso = 1, +x toward pitcher', () => {
  const n = normalizeSwing(base);
  assert.equal(n.ok, true);
  assert.ok(Math.abs(n.T - 300) / 300 < 0.02, `T=${n.T}`);
  assert.equal(n.direction, 1);
  assert.equal(n.directionSource, 'stride');
  assert.equal(n.lead, 'LEFT');
  assert.ok(Math.abs(n.points.pelvis.x[0]) < 0.02 && Math.abs(n.points.pelvis.y[0]) < 0.02);
  assert.ok(n.points.shoulderMid.y[0] < -0.9, 'shoulders above pelvis');
  const lastAnkle = n.points.leadAnkle.x.at(-1);
  assert.ok(Math.abs(lastAnkle - 1.55) < 0.05, `lead ankle ends ~0.55+1.0 T forward: ${lastAnkle}`);
});

test('TRANSLATION: shifting the body in the image leaves normalized trajectories unchanged', () => {
  for (const [dx, dy] of [[250, 0], [-300, 120], [0, -400]]) {
    const d = maxDistance(baseR, resampled(transformImage(base, { dx, dy })));
    assert.ok(d < 1e-3, `dx=${dx} dy=${dy}: ${d}`);
  }
});

test('SCALE: resizing the body leaves normalized trajectories unchanged', () => {
  for (const scale of [0.5, 0.8, 1.6]) {
    const d = maxDistance(baseR, resampled(transformImage(base, { scale })));
    assert.ok(d < 1e-3, `scale=${scale}: ${d}`);
  }
});

test('MIRROR: batter facing the other way normalizes to the same trajectories', () => {
  const mirrored = generateSwing({ facing: -1 });
  const n = normalizeSwing(mirrored);
  assert.equal(n.direction, -1);
  assert.ok(maxDistance(baseR, resampled(mirrored)) < 1e-3);
});

test('left-handed batter: lead side detected as RIGHT', () => {
  assert.equal(normalizeSwing(generateSwing({ battingSide: 'L', facing: -1 })).lead, 'RIGHT');
});

test('DURATION (frame count): 30 / 60 / 120 fps versions match after temporal resampling', () => {
  const clean = (fps) => resampled(generateSwing({ fps, noise: 0 }));
  const r60 = clean(60);
  for (const fps of [30, 120]) {
    const d = maxDistance(r60, clean(fps));
    assert.ok(d < 0.03, `fps=${fps}: mean distance ${d}`);
  }
});

test('DURATION (tempo): uniformly slower swing matches after temporal resampling', () => {
  const k = 1.3;
  const p = { noise: 0 };
  const slow = generateSwing({ ...p, duration: 2 * k, strideStart: 0.5 * k, plant: 0.9 * k, swingStart: 0.95 * k, swingEnd: 1.25 * k, finish: 1.6 * k });
  const d = maxDistance(resampled(generateSwing(p)), resampled(slow));
  assert.ok(d < 0.03, `${d}`);
});

test('REAL DIFFERENCE: longer stride is preserved (lead ankle +0.5 T)', () => {
  const longer = normalizeSwing(generateSwing({ strideLength: 1.5, seed: 7 }));
  const ref = normalizeSwing(base);
  const diff = longer.points.leadAnkle.x.at(-1) - ref.points.leadAnkle.x.at(-1);
  assert.ok(Math.abs(diff - 0.5) < 0.05, `diff=${diff}`);
});

test('REAL DIFFERENCE: altered hand path is far larger than noise between repeats', () => {
  const repeat = resampled(generateSwing({ seed: 2 }));
  const altered = resampled(generateSwing({ seed: 3, handRadius: 0.85, handPlaneSquash: 0.6 }));
  const noiseD = trajectoryDistance(baseR.points.hands, repeat.points.hands);
  const changeD = trajectoryDistance(baseR.points.hands, altered.points.hands);
  assert.ok(changeD > 5 * noiseD, `noise=${noiseD} change=${changeD}`);
});

test('REAL DIFFERENCE: survives translation + scale of the altered swing', () => {
  const altered = generateSwing({ seed: 3, headMoveX: 0.4 });
  const moved = transformImage(altered, { dx: 200, dy: -100, scale: 0.7 });
  const a = resampled(altered);
  const b = resampled(moved);
  assert.ok(trajectoryDistance(a.points.head, b.points.head) < 1e-3);
  assert.ok(trajectoryDistance(baseR.points.head, b.points.head) > 0.1);
});

test('short wrist dropout is bridged; long dropout stays missing (no invented data)', () => {
  const ids = [LM.LEFT_WRIST, LM.RIGHT_WRIST];
  const short = normalizeSwing(setVisibility(base, ids, 0.1, 1.0, 1.03)); // 2 frames
  assert.equal(short.points.hands.x.filter((v) => v === null).length, 0);
  const long = normalizeSwing(setVisibility(base, ids, 0.1, 1.0, 1.2)); // 12 frames
  assert.ok(long.points.hands.x.filter((v) => v === null).length >= 8);
  const r = resampleSwing(long);
  assert.ok(r.missing.hands > 0);
});

test('relativeToPelvis gives per-frame body-centered coordinates', () => {
  const n = normalizeSwing(base);
  const rel = relativeToPelvis(n, 'shoulderMid');
  for (let k = 0; k < rel.y.length; k++) assert.ok(Math.abs(rel.y[k] + 1) < 0.05);
});

test('normalization fails visibly when torso is not tracked', () => {
  const blind = setVisibility(base, [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], 0);
  const n = normalizeSwing(blind);
  assert.equal(n.ok, false);
});
