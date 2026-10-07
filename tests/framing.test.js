import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFraming } from '../src/pose/framing.js';
import { generateSwing, transformImage, setVisibility } from '../src/synthetic/swing.js';
import { LM } from '../src/pose/landmarks.js';

const stance = (seq) => seq.frames[0].lm;
const check = (r, key) => r.checks.find((c) => c.key === key);

test('FRAMING: default synthetic batter is framed correctly', () => {
  const r = assessFraming(stance(generateSwing()));
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.ok(r.box.bottom - r.box.top > 0.4);
});

test('FRAMING: nobody detected', () => {
  const r = assessFraming(null);
  assert.equal(r.ok, false);
  assert.match(r.checks[0].text, /沒有偵測到人/);
});

test('FRAMING: batter too small → move closer', () => {
  const r = assessFraming(stance(transformImage(generateSwing(), { scale: 0.6 })));
  assert.equal(check(r, 'size').ok, false);
  assert.match(check(r, 'size').text, /靠近/);
});

test('FRAMING: batter too big / feet cut off → move back', () => {
  const r = assessFraming(stance(transformImage(generateSwing(), { scale: 1.9 })));
  assert.equal(r.ok, false);
  assert.equal(check(r, 'whole').ok, false);
});

test('FRAMING: feet not visible', () => {
  const ids = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_HEEL, LM.RIGHT_HEEL];
  const r = assessFraming(stance(setVisibility(generateSwing(), ids, 0.1)));
  assert.equal(check(r, 'whole').ok, false);
  assert.match(check(r, 'whole').text, /雙腳/);
});

test('FRAMING: batter at the image edge → no room for the stride', () => {
  const seq = generateSwing();
  const left = assessFraming(stance(transformImage(seq, { dx: -0.3 * seq.width })));
  const right = assessFraming(stance(transformImage(seq, { dx: 0.35 * seq.width })));
  assert.equal(check(left, 'center').ok, false);
  assert.match(check(left, 'center').text, /太靠左/);
  assert.equal(check(right, 'center').ok, false);
  assert.match(check(right, 'center').text, /太靠右/);
});

test('FRAMING: left-handed batter facing the other way is framed correctly', () => {
  const r = assessFraming(stance(generateSwing({ battingSide: 'L', facing: -1 })));
  assert.equal(r.ok, true, JSON.stringify(r.checks));
});
