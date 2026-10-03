import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality, detectJumps } from '../src/pose/quality.js';
import { LM } from '../src/pose/landmarks.js';
import { generateSwing, transformImage, setVisibility, dropFrames, shiftFrames } from '../src/synthetic/swing.js';

const base = generateSwing();
const status = (qc, id) => qc.checks.find((c) => c.id === id)?.status;

test('clean synthetic swing passes QC', () => {
  const qc = assessQuality(base);
  assert.equal(qc.level, 'good', JSON.stringify(qc.reasons));
  assert.equal(qc.usable, true);
  assert.equal(detectJumps(base).length, 0, 'fast hand motion must not count as a jump');
});

test('QC is deterministic', () => {
  assert.deepEqual(assessQuality(base), assessQuality(generateSwing()));
});

test('missing body for 0.3 s -> poor (tracking interruption)', () => {
  const qc = assessQuality(dropFrames(base, 1.0, 1.3));
  assert.equal(qc.level, 'poor');
  assert.equal(status(qc, 'gap_body'), 'fail');
});

test('short dropout (2 frames @60fps) -> still usable', () => {
  const qc = assessQuality(dropFrames(base, 1.0, 1.02));
  assert.equal(qc.usable, true);
});

test('low wrist confidence throughout -> poor with wrist reason', () => {
  const qc = assessQuality(setVisibility(base, [LM.LEFT_WRIST, LM.RIGHT_WRIST], 0.2));
  assert.equal(qc.level, 'poor');
  assert.equal(status(qc, 'group_wrists'), 'fail');
  assert.ok(qc.reasons.some((r) => r.includes('wrist')));
});

test('far-side wrist low but near-side wrist fine -> wrists still tracked', () => {
  const qc = assessQuality(setVisibility(base, [LM.RIGHT_WRIST], 0.1));
  assert.equal(status(qc, 'group_wrists'), 'pass');
});

test('ankles lost for 0.15 s -> fair (gap warning), 0.4 s -> poor', () => {
  const ids = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE];
  assert.equal(status(assessQuality(setVisibility(base, ids, 0.1, 0.8, 0.94)), 'gap_ankles'), 'warn');
  const bad = assessQuality(setVisibility(base, ids, 0.1, 0.8, 1.2));
  assert.equal(bad.level, 'poor');
  assert.equal(status(bad, 'gap_ankles'), 'fail');
});

test('single-frame skeleton jump -> warning; repeated jumps -> poor', () => {
  const one = shiftFrames(base, 0.3, 0, 1.0, 1.0);
  const qc1 = assessQuality(one);
  assert.equal(detectJumps(one).length, 2, 'jump out and back');
  assert.equal(qc1.level, 'fair');
  const many = shiftFrames(shiftFrames(one, 0.3, 0, 0.5, 0.5), -0.3, 0.1, 1.5, 1.5);
  assert.equal(assessQuality(many).level, 'poor');
});

test('sudden scale change (detector locks onto someone else) is a jump', () => {
  const seq = { ...base, frames: base.frames.map((f) => f) };
  const k = 70;
  seq.frames[k] = transformImage({ ...base, frames: [base.frames[k]] }, { scale: 0.5 }).frames[0];
  assert.ok(detectJumps(seq).some((j) => j.index === k));
});

test('partial body (feet cut off by framing) -> out-of-frame fail', () => {
  const zoomed = transformImage(base, { scale: 2.2, cx: 540, cy: 300 });
  const qc = assessQuality(zoomed);
  assert.equal(status(qc, 'outOfFrame'), 'fail');
  assert.equal(qc.level, 'poor');
});

test('player leaving the frame -> poor', () => {
  // Drift right from t=1.2 s until fully out.
  const drift = { ...base, frames: base.frames.map((f) => (f.t < 1.2 ? f : { t: f.t, lm: f.lm.map(([x, y, z, v]) => [x + (f.t - 1.2) * 1.5, y, z, v]) })) };
  const qc = assessQuality(drift);
  assert.equal(qc.level, 'poor');
  assert.equal(status(qc, 'outOfFrame'), 'fail');
});

test('player too small -> size fail; moderately small -> warn', () => {
  assert.equal(status(assessQuality(transformImage(base, { scale: 0.3 })), 'size'), 'fail');
  assert.equal(status(assessQuality(transformImage(base, { scale: 0.55 })), 'size'), 'warn');
});

test('too few frames -> poor', () => {
  const qc = assessQuality({ ...base, frames: base.frames.slice(0, 5) });
  assert.equal(qc.level, 'poor');
});

test('range restriction evaluates only the requested frames', () => {
  const seq = dropFrames(base, 0, 0.4); // missing at start only
  assert.equal(assessQuality(seq).level, 'poor');
  assert.equal(assessQuality(seq, { from: 30 }).level, 'good');
});

test('every non-pass check carries a reason and advice', () => {
  const qc = assessQuality(setVisibility(transformImage(base, { scale: 0.3 }), [LM.LEFT_WRIST, LM.RIGHT_WRIST], 0.1));
  assert.ok(qc.reasons.length >= 2);
  for (const a of qc.advice) assert.ok(typeof a === 'string' && a.length > 10);
});
