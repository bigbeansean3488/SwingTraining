import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { createSession, createSwingRecord } from '../src/app/session.js';
import { describeSwing, headText, strideText, handPathText, scoreBand } from '../src/app/interpret.js';
import { referenceSession } from '../src/synthetic/session.js';
import { generateSwing, dropFrames } from '../src/synthetic/swing.js';

const session = createSession({}, 1);
const swings = [];
for (const s of referenceSession()) swings.push(createSwingRecord({ session, seq: s.seq, analysis: analyzeSwing(s.seq), previous: swings }));
const d = swings.map(describeSwing);

test('first swing: building baseline', () => {
  assert.equal(d[0].kind, 'baseline');
  assert.match(d[0].headline, /building your baseline/);
});

test('near-baseline swing reads as similar everywhere', () => {
  for (const line of d[2].lines) assert.match(line.text, /Similar/, `${line.label}: ${line.text}`);
  assert.equal(d[2].band, 'high');
});

test('longer-stride swing says stride is longer; head and hand path similar', () => {
  const lines = Object.fromEntries(d[3].lines.map((l) => [l.label, l.text]));
  assert.equal(lines.Stride, 'Longer than your baseline');
  assert.match(lines.Head, /Similar/);
  assert.match(lines['Hand path'], /Similar/);
});

test('head-movement swing says more head movement than the last 4 swings', () => {
  const lines = Object.fromEntries(d[4].lines.map((l) => [l.label, l.text]));
  assert.equal(lines.Head, 'More head movement than your last 4 swings');
});

test('rejected swing: fail visibly with reasons and advice', () => {
  const bad = dropFrames(generateSwing(), 1.0, 1.3);
  const rec = createSwingRecord({ session, seq: bad, analysis: analyzeSwing(bad), previous: swings });
  const r = describeSwing(rec);
  assert.equal(r.kind, 'rejected');
  assert.equal(r.headline, 'Unable to reliably analyze this swing.');
  assert.ok(r.reasons.length > 0 && r.advice.length > 0);
});

test('wording never contains coaching claims', () => {
  const all = d.flatMap((x) => [x.headline, ...(x.lines || []).map((l) => l.text), x.timing]).filter(Boolean).join(' ').toLowerCase();
  for (const banned of ['incorrect', 'wrong', 'should', 'bad swing', 'good swing', 'rotation', 'injury']) assert.ok(!all.includes(banned), banned);
});

test('wording helpers handle missing data', () => {
  assert.equal(headText(null), 'Not available');
  assert.equal(strideText(null, null), 'Not available');
  assert.equal(handPathText(null), 'Not available');
  assert.equal(scoreBand(null), 'none');
  assert.equal(strideText(null, { diagnostics: { reason: 'no stride detected (lead foot barely moved)' } }), 'No stride detected');
});

test('rejection reason from event detection is listed first', () => {
  const seq = generateSwing();
  const cut = { ...seq, frames: seq.frames.filter((f) => f.t >= 0.7) };
  const rec = createSwingRecord({ session, seq: cut, analysis: analyzeSwing(cut), previous: swings });
  const r = describeSwing(rec);
  assert.equal(r.kind, 'rejected');
  assert.match(r.reasons[0], /before the analyzed window/);
});
