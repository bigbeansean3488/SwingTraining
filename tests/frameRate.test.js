import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateFrameRate, checkVideoFile } from '../src/analysis/frameRate.js';

function samples(n, dt, { skipEvery = 0, jitter = 0 } = {}) {
  const out = [];
  let frame = 0;
  for (let i = 0; i < n; i++) {
    frame += skipEvery && i % skipEvery === 0 && i > 0 ? 2 : 1;
    out.push({ mediaTime: frame * dt + (i % 2 ? jitter : -jitter), presentedFrames: frame });
  }
  return out;
}

test('constant 30 fps is recovered', () => {
  const r = estimateFrameRate(samples(30, 1 / 30));
  assert.equal(r.reliable, true);
  assert.ok(Math.abs(r.fps - 30) < 0.01);
});

test('iPhone 600/19 timescale (~31.58 fps) is recovered', () => {
  const r = estimateFrameRate(samples(40, 19 / 600));
  assert.ok(Math.abs(r.fps - 600 / 19) < 0.01);
});

test('skipped frames are excluded instead of lowering fps', () => {
  const r = estimateFrameRate(samples(60, 1 / 60, { skipEvery: 3 }));
  assert.equal(r.reliable, true);
  assert.ok(Math.abs(r.fps - 60) < 0.01);
});

test('too few samples -> null fps, not a guess', () => {
  const r = estimateFrameRate(samples(5, 1 / 30));
  assert.equal(r.fps, null);
  assert.equal(r.reliable, false);
});

test('inconsistent intervals -> null fps', () => {
  const s = [];
  let t = 0;
  for (let i = 0; i < 30; i++) { t += i % 2 ? 1 / 30 : 1 / 12; s.push({ mediaTime: t, presentedFrames: i }); }
  const r = estimateFrameRate(s);
  assert.equal(r.fps, null);
});

test('checkVideoFile accepts video MIME and iOS empty-MIME .MOV', () => {
  assert.equal(checkVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 10 }).ok, true);
  assert.equal(checkVideoFile({ name: 'IMG_1.MOV', type: '', size: 10 }).ok, true);
});

test('checkVideoFile rejects non-video, empty, missing', () => {
  assert.equal(checkVideoFile({ name: 'a.jpg', type: 'image/jpeg', size: 10 }).ok, false);
  assert.equal(checkVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 0 }).ok, false);
  assert.equal(checkVideoFile(null).ok, false);
});
