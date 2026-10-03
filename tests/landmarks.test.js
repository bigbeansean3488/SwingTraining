import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMediaPipe, trackingCoverage, pointPx, LM, NUM_LANDMARKS } from '../src/pose/landmarks.js';
import { nearestFrameIndex } from '../src/ui/skeleton.js';

const mpPose = (vis = 0.9) => Array.from({ length: NUM_LANDMARKS }, (_, i) => ({ x: i / 100, y: 0.5, z: -0.1, visibility: vis }));

test('fromMediaPipe keeps x, y, z and visibility', () => {
  const lm = fromMediaPipe({ landmarks: [mpPose(0.77)] });
  assert.equal(lm.length, NUM_LANDMARKS);
  assert.deepEqual(lm[10], [0.1, 0.5, -0.1, 0.77]);
});

test('fromMediaPipe returns null when no person', () => {
  assert.equal(fromMediaPipe({ landmarks: [] }), null);
  assert.equal(fromMediaPipe(undefined), null);
});

test('pointPx converts to aspect-correct pixels', () => {
  const lm = fromMediaPipe({ landmarks: [mpPose()] });
  const p = pointPx({ lm }, 20, 1080, 1920);
  assert.ok(Math.abs(p.x - 0.2 * 1080) < 1e-6);
  assert.ok(Math.abs(p.y - 960) < 1e-6);
});

test('trackingCoverage counts missing frames and low visibility', () => {
  const good = fromMediaPipe({ landmarks: [mpPose(0.9)] });
  const lowWrists = good.map((p, i) => (i === LM.LEFT_WRIST || i === LM.RIGHT_WRIST ? [p[0], p[1], p[2], 0.2] : p));
  const seq = { frames: [{ t: 0, lm: good }, { t: 1, lm: lowWrists }, { t: 2, lm: null }, { t: 3, lm: good }] };
  const cov = trackingCoverage(seq);
  assert.equal(cov.poseFraction, 0.75);
  assert.equal(cov.groups.shoulders, 0.75);
  assert.equal(cov.groups.wrists, 0.5);
  assert.equal(cov.perLandmark[LM.LEFT_WRIST], 0.5);
});

test('nearestFrameIndex picks closest frame time', () => {
  const frames = [0, 0.033, 0.066, 0.1].map((t) => ({ t }));
  assert.equal(nearestFrameIndex(frames, -1), 0);
  assert.equal(nearestFrameIndex(frames, 0.045), 1);
  assert.equal(nearestFrameIndex(frames, 0.06), 2);
  assert.equal(nearestFrameIndex(frames, 5), 3);
  assert.equal(nearestFrameIndex([], 1), -1);
});
