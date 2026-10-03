import test from 'node:test';
import assert from 'node:assert/strict';
import { findSwings, sliceSequence } from '../src/analysis/segmentation.js';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { generatePractice, decimate } from '../src/synthetic/practice.js';
import { naturalVariation } from '../src/synthetic/session.js';
import { transformImage } from '../src/synthetic/swing.js';

const swings = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ ...naturalVariation(i), ...extra }));

// Distractors placed between swings (swing i occupies [2 + 7i, 4 + 7i] s).
const DISTRACTORS = [
  { type: 'walk', t0: 5, t1: 7.5, dx: 1.5 },          // steps out of the box and back
  { type: 'armRaise', t0: 12, t1: 13.5, height: 1.2 }, // adjusts helmet
  { type: 'leave', t0: 19, t1: 21 },                   // leaves the frame
  { type: 'waggle', t0: 26, t1: 28, amp: 0.12, hz: 1.5 },
];

function assertMatchesTruth(found, truth, tol) {
  assert.equal(found.length, truth.length, `found ${found.map((s) => s.peak).join(', ')} vs truth ${truth.map((s) => s.peakHandSpeed.toFixed(2)).join(', ')}`);
  for (const [i, s] of found.entries()) {
    const tr = truth[i];
    assert.ok(Math.abs(s.peak - tr.peakHandSpeed) <= tol, `swing ${i + 1}: peak ${s.peak} vs ${tr.peakHandSpeed.toFixed(3)}`);
    // The analysis window must contain the whole swing with some quiet stance before it.
    assert.ok(s.window[0] <= tr.motionStart - 0.3, `swing ${i + 1}: window starts ${s.window[0]} after stance (${tr.motionStart})`);
    assert.ok(s.window[1] >= tr.swingEnd, `swing ${i + 1}: window ends ${s.window[1]} before swing end (${tr.swingEnd})`);
  }
}

for (const fps of [60, 30, 15]) {
  test(`SEGMENT: finds every swing in a 5-swing recording with distractors (${fps} fps scan)`, () => {
    const seq = generatePractice({ swings: swings(5), distractors: DISTRACTORS });
    const r = findSwings(decimate(seq, 60 / fps));
    assert.equal(r.ok, true, r.reason);
    assertMatchesTruth(r.swings, seq.truth.swings, 1.5 / fps + 0.02);
  });
}

test('SEGMENT: no swings in a recording with only distractors', () => {
  const seq = generatePractice({ swings: swings(1), distractors: DISTRACTORS, tail: 30 });
  // Analyze only the part after the single swing has finished.
  const r = findSwings(sliceSequence(seq, 6, seq.end));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.swings, []);
});

test('SEGMENT: each window, analyzed at full rate, recovers the swing events', () => {
  const seq = generatePractice({ swings: swings(4), distractors: DISTRACTORS.slice(0, 3) });
  const r = findSwings(decimate(seq, 4));
  assert.equal(r.swings.length, 4);
  for (const [i, s] of r.swings.entries()) {
    const a = analyzeSwing(sliceSequence(seq, ...s.window));
    const tr = seq.truth.swings[i];
    assert.equal(a.status, 'ok', `swing ${i + 1}: ${a.reason}`);
    assert.ok(Math.abs(a.events.peakHandSpeed - tr.peakHandSpeed) < 0.03, `swing ${i + 1} peak ${a.events.peakHandSpeed}`);
    assert.ok(Math.abs(a.events.motionStart - tr.motionStart) < 0.1, `swing ${i + 1} start ${a.events.motionStart} vs ${tr.motionStart}`);
  }
});

test('SEGMENT: left-handed batter facing the other way, smaller in frame', () => {
  const seq = transformImage(generatePractice({ swings: swings(3), battingSide: 'L', facing: -1 }), { scale: 0.6 });
  const r = findSwings(decimate(seq, 4));
  assertMatchesTruth(r.swings, seq.truth.swings, 0.1);
});

test('SEGMENT: fast swings are still found at a 15 fps scan', () => {
  const seq = generatePractice({ swings: swings(3, { swingStart: 0.95, swingEnd: 1.12 }) });
  const r = findSwings(decimate(seq, 4));
  assertMatchesTruth(r.swings, seq.truth.swings, 0.1);
});

test('SEGMENT: swings closer than minGap are reported once (documented limit)', () => {
  const seq = generatePractice({ swings: swings(2), gap: 2.2, recovery: 0.2 });
  const r = findSwings(seq);
  assert.equal(r.swings.length, 1);
});

test('SEGMENT: windows of neighboring swings never overlap', () => {
  const seq = generatePractice({ swings: swings(3), gap: 3.2, recovery: 0.5 });
  const r = findSwings(seq);
  assert.equal(r.swings.length, 3);
  for (let i = 1; i < r.swings.length; i++) assert.ok(r.swings[i].window[0] >= r.swings[i - 1].window[1] - 1e-9);
});

test('SEGMENT: a swing while nobody is tracked is not reported', () => {
  const seq = generatePractice({ swings: swings(2), distractors: [{ type: 'leave', t0: 8.5, t1: 10.6 }] });
  // Hands vanish (whole body leaves) around the second swing's peak but the
  // body is visible briefly before → no candidate there.
  const r = findSwings(seq);
  assert.equal(r.swings.length, 1);
  assert.ok(Math.abs(r.swings[0].peak - seq.truth.swings[0].peakHandSpeed) < 0.05);
});

test('SEGMENT: nobody in the video → not ok, no swings', () => {
  const seq = generatePractice({ swings: swings(1), distractors: [{ type: 'leave', t0: 0, t1: 100 }] });
  const r = findSwings(seq);
  assert.equal(r.ok, false);
  assert.deepEqual(r.swings, []);
});
