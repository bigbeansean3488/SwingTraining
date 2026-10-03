import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { wristPathDistance } from '../src/analysis/wristPath.js';
import { std, mean } from '../src/analysis/signal.js';
import { generateSwing, dropFrames, shiftFrames, transformImage } from '../src/synthetic/swing.js';

const run = (p = {}) => analyzeSwing(generateSwing(p));

function assertMetricShape(m, name) {
  assert.ok('value' in m, `${name}.value`);
  assert.ok(typeof m.confidence === 'number' && m.confidence >= 0 && m.confidence <= 1, `${name}.confidence`);
  assert.equal(typeof m.diagnostics, 'object', `${name}.diagnostics`);
  assert.equal(m.validation.field, 'PENDING', `${name} must not claim field validation`);
  assert.equal(m.validation.level, 'UNIT_VALIDATED');
}

test('pipeline returns every metric with value / confidence / diagnostics / validation', () => {
  const a = run();
  assert.equal(a.status, 'ok', a.reason);
  for (const [k, m] of Object.entries(a.metrics)) assertMetricShape(m, k);
  assert.equal(a.qc.level, 'good');
});

// ---------------- Timing ----------------

const TIMING_CASES = [
  { fps: 60 },
  { fps: 30 },
  { fps: 120 },
  { fps: 60, seed: 5, strideStart: 0.4, plant: 0.85, swingStart: 0.9, swingEnd: 1.15, finish: 1.5 },
  { fps: 60, seed: 6, strideStart: 0.6, plant: 1.1, swingStart: 1.2, swingEnd: 1.55, finish: 1.95, duration: 2.4 },
];

for (const c of TIMING_CASES) {
  test(`TIMING: events recovered vs known fixture times (${JSON.stringify(c)})`, () => {
    const seq = generateSwing(c);
    const truth = seq.truth.events;
    const a = analyzeSwing(seq);
    assert.equal(a.status, 'ok', a.reason);
    const frame = 1 / c.fps;
    const tol = Math.max(1.5 * frame, 0.02);
    // Start/end are threshold crossings of a smoothly starting/ending motion,
    // so they are biased inward by a few hundredths of a second by definition
    // (documented in metric-definitions §3). Same bias for every swing.
    const tolEdge = Math.max(1.5 * frame, 0.04);
    const ev = a.events;
    const err = {
      start: ev.motionStart - truth.motionStart,
      plant: ev.footPlant - truth.footPlant,
      peak: ev.peakHandSpeed - truth.peakHandSpeed,
      end: ev.swingEnd - truth.swingEnd,
    };
    for (const [k, e] of Object.entries(err)) {
      const lim = k === 'start' || k === 'end' ? tolEdge : tol;
      assert.ok(Math.abs(e) <= lim, `${k} error ${e.toFixed(4)} s > ${lim.toFixed(4)}`);
    }
    // Peak hand speed is refined sub-frame; expect better than half a frame.
    assert.ok(Math.abs(err.peak) <= 0.5 * frame + 1e-3, `peak error ${err.peak}`);
    const t = a.metrics.timing.value;
    assert.ok(Math.abs(t.startToPeak - (truth.peakHandSpeed - truth.motionStart)) <= 2 * tol);
  });
}

test('TIMING: a deliberately later swing (plant→peak +0.1 s) is measured as +0.1 s', () => {
  const normal = run();
  const late = run({ seed: 9, swingStart: 1.05, swingEnd: 1.35, finish: 1.7 });
  const d = late.metrics.timing.value.plantToPeak - normal.metrics.timing.value.plantToPeak;
  assert.ok(Math.abs(d - 0.1) < 0.02, `delta ${d}`);
});

// ---------------- Head stability ----------------

test('HEAD: stationary (A) < moderate (B) < large (C) displacement', () => {
  const A = run({ headMoveX: 0.02, headMoveY: 0.01, seed: 11 }).metrics.headStability;
  const B = run({ headMoveX: 0.15, headMoveY: 0.06, seed: 12 }).metrics.headStability;
  const C = run({ headMoveX: 0.4, headMoveY: 0.15, seed: 13 }).metrics.headStability;
  assert.ok(A.value < B.value && B.value < C.value, `A=${A.value} B=${B.value} C=${C.value}`);
  // Value is relative to the moving pelvis: only the injected head offset remains.
  assert.ok(Math.abs(C.value - Math.hypot(0.4, 0.15)) < 0.05, `C=${C.value}`);
  // Anchored (camera-fixed) diagnostic also includes the 0.35 T body drift.
  assert.ok(Math.abs(C.diagnostics.maxDisplacementAnchored - Math.hypot(0.4 + 0.35, 0.15)) < 0.05, `C anchored=${C.diagnostics.maxDisplacementAnchored}`);
  assert.ok(C.diagnostics.forwardAtPeak > 0.2, 'forward drift reported in diagnostics');
});

test('HEAD: longer stride alone does not change head stability (components stay separate)', () => {
  const normal = run({ seed: 22 }).metrics.headStability.value;
  const longer = run({ seed: 23, strideLength: 1.4 }).metrics.headStability.value;
  assert.ok(Math.abs(longer - normal) < 0.03, `normal ${normal} longer-stride ${longer}`);
});

test('HEAD: oscillating head (wobble) scores worse than steady head with same drift', () => {
  const steady = run({ seed: 21 }).metrics.headStability;
  const wobble = run({ seed: 21, headWobble: 0.12 }).metrics.headStability;
  assert.ok(wobble.value > steady.value + 0.05);
  assert.ok(wobble.diagnostics.pathLengthAnchored > 1.5 * steady.diagnostics.pathLengthAnchored);
});

test('HEAD: invariant to camera translation/scale', () => {
  const seq = generateSwing({ headMoveX: 0.2, seed: 4 });
  const a = analyzeSwing(seq).metrics.headStability.value;
  const b = analyzeSwing(transformImage(seq, { dx: 150, dy: 80, scale: 0.7 })).metrics.headStability.value;
  assert.ok(Math.abs(a - b) < 1e-3);
});

// ---------------- Stride ----------------

test('STRIDE: similar swings → low variance; altered stride → large deviation', () => {
  const similar = [1.0, 1.02, 0.98, 1.01, 0.99].map((L, i) => run({ strideLength: L, seed: 30 + i }).metrics.stride.value);
  const sd = std(similar);
  const m = mean(similar);
  assert.ok(sd < 0.03, `sd ${sd}`);
  assert.ok(Math.abs(m - 1.0) < 0.05, `mean ${m}`);
  for (const L of [1.4, 0.6]) {
    const v = run({ strideLength: L, seed: 40, pelvisX: 0.35 }).metrics.stride.value; // keep the long stride inside the frame
    assert.ok(Math.abs(v - m) > 10 * sd, `altered ${L}: ${v} vs mean ${m} sd ${sd}`);
    assert.ok(Math.abs(v - L) < 0.06, `stride value ${v} ≈ ${L}`);
  }
});

test('STRIDE: plant location and duration diagnostics', () => {
  const s = run().metrics.stride;
  assert.ok(Math.abs(s.diagnostics.plantX - 1.55) < 0.06, `plantX ${s.diagnostics.plantX}`);
  assert.ok(s.diagnostics.footLift > 0.1);
  assert.ok(Math.abs(s.diagnostics.strideDuration - 0.4) < 0.04);
});

test('STRIDE: no-stride swing reports 0 with reduced confidence (not an error)', () => {
  const a = run({ strideLength: 0, footLift: 0, pelvisShiftRatio: 0 });
  assert.equal(a.status, 'ok', a.reason);
  assert.equal(a.metrics.stride.value, 0);
  assert.ok(a.metrics.stride.confidence < 0.6);
});

// ---------------- Wrist path ----------------

test('WRIST PATH: distance(similar pair) < distance(different pair)', () => {
  const p1 = run({ seed: 50 }).metrics.wristPath.value;
  const p2 = run({ seed: 51, handRadius: 0.66 }).metrics.wristPath.value;
  const p3 = run({ seed: 52, handRadius: 0.85, handPlaneSquash: 0.6 }).metrics.wristPath.value;
  const similar = wristPathDistance(p1, p2);
  const different = wristPathDistance(p1, p3);
  assert.ok(similar < different / 3, `similar ${similar} different ${different}`);
});

test('WRIST PATH: tempo change alone barely changes the path (event-anchored warp)', () => {
  const p1 = run({ seed: 60 }).metrics.wristPath.value;
  const slower = run({ seed: 61, swingStart: 1.0, swingEnd: 1.38, finish: 1.75 }).metrics.wristPath.value;
  const altered = run({ seed: 62, handRadius: 0.85, handPlaneSquash: 0.6 }).metrics.wristPath.value;
  assert.ok(wristPathDistance(p1, slower) < wristPathDistance(p1, altered) / 3);
});

// ---------------- Gating ----------------

test('swing with tracking loss during the swing is rejected; metrics withheld', () => {
  const a = analyzeSwing(dropFrames(generateSwing(), 1.0, 1.2));
  assert.equal(a.status, 'rejected');
  assert.equal(a.metrics, null);
  assert.equal(a.qc.level, 'poor');
  assert.match(a.reason, /Unable to reliably analyze/);
});

test('tracking problem outside the swing interval does not reject the swing', () => {
  const a = analyzeSwing(dropFrames(generateSwing({ duration: 2.4 }), 2.1, 2.4));
  assert.equal(a.status, 'ok', a.reason);
});

test('fair QC lowers metric confidence', () => {
  const good = run();
  const fair = analyzeSwing(shiftFrames(generateSwing(), 0.2, 0, 1.4, 1.4)); // one jump inside QC window
  assert.equal(fair.qc.level, 'fair');
  assert.ok(fair.metrics.stride.confidence < good.metrics.stride.confidence);
});

test('standing still → rejected (no swing motion)', () => {
  const a = run({ strideLength: 0, footLift: 0, pelvisShiftRatio: 0, handRadius: 0.0001, headMoveX: 0, headMoveY: 0 });
  assert.equal(a.status, 'rejected');
  assert.match(a.reason, /no swing motion/);
});

test('swing already in progress at window start → rejected with advice', () => {
  const seq = generateSwing();
  const cut = { ...seq, frames: seq.frames.filter((f) => f.t >= 0.7) };
  const a = analyzeSwing(cut);
  assert.equal(a.status, 'rejected');
  assert.match(a.reason, /before the analyzed window/);
});

test('analysis is deterministic', () => {
  assert.deepEqual(run({ seed: 77 }), run({ seed: 77 }));
});
