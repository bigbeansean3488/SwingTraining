import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { createSession, createSwingRecord, setContactLabel, updatePlayers, playersFromSessions, sessionFocus } from '../src/app/session.js';
import { reviewSession } from '../src/app/review.js';
import { variableSession, referenceSession } from '../src/synthetic/session.js';
import { generateSwing, dropFrames } from '../src/synthetic/swing.js';

function build(list, extra = []) {
  const session = createSession({ focus: 'stride' }, 1);
  const swings = [];
  for (const s of list) swings.push(createSwingRecord({ session, seq: s.seq, analysis: analyzeSwing(s.seq), previous: swings }));
  for (const seq of extra) swings.push(createSwingRecord({ session, seq, analysis: analyzeSwing(seq), previous: swings }));
  return swings;
}

test('review counts swings, valid, rejected and contact labels', () => {
  let swings = build(referenceSession(), [dropFrames(generateSwing({ seed: 9 }), 1.0, 1.3)]);
  swings = swings.map((s, i) => setContactLabel(s, ['good', 'good', 'medium', 'poor', null, null][i]));
  const r = reviewSession(swings, 'motion');
  assert.equal(r.total, 6);
  assert.equal(r.valid, 5);
  assert.equal(r.rejected, 1);
  assert.deepEqual(r.contactCounts, { good: 2, medium: 1, poor: 1 });
  assert.equal(r.labeled, 4);
  assert.equal(r.series.length, 6);
  assert.equal(r.series[5].score, null, 'rejected swing has no score');
});

test('best Motion Consistency swing and largest variation source', () => {
  const r = reviewSession(build(referenceSession()), 'motion');
  assert.equal(r.best.number, 3);
  assert.ok(['head', 'stride'].includes(r.largestVariation.component), r.largestVariation.component);
});

test('trend: first vs last scored swings', () => {
  const r = reviewSession(build(variableSession(10, 1)), 'motion');
  assert.ok(r.trend.k >= 2);
  assert.ok(Number.isFinite(r.trend.first) && Number.isFinite(r.trend.last));
  assert.equal(reviewSession(build(variableSession(3, 1)), 'motion').trend, null, 'too few swings → no trend');
});

test('contact-by-focus split only with ≥ 6 labeled scored swings (descriptive)', () => {
  let swings = build(variableSession(9, 3));
  assert.equal(reviewSession(swings, 'motion').contactByFocus, null);
  swings = swings.map((s, i) => setContactLabel(s, i % 2 ? 'good' : 'poor'));
  const r = reviewSession(swings, 'motion');
  assert.ok(r.contactByFocus);
  assert.equal(r.contactByFocus.high.n + r.contactByFocus.low.n, 8);
});

test('player shortcuts: most recent first, unique, keeps batting side', () => {
  let p = [];
  p = updatePlayers(p, { name: 'Sean', battingSide: 'R' }, 1);
  p = updatePlayers(p, { name: 'Kevin', battingSide: 'L' }, 2);
  p = updatePlayers(p, { name: ' Sean ', battingSide: 'L' }, 3);
  assert.deepEqual(p.map((x) => [x.name, x.battingSide]), [['Sean', 'L'], ['Kevin', 'L']]);
  assert.deepEqual(updatePlayers(p, { name: '  ' }), p);
  const from = playersFromSessions([{ playerName: 'A', battingSide: 'R', createdAt: 1 }, { playerName: 'B', battingSide: null, createdAt: 2 }, { playerName: '', createdAt: 3 }]);
  assert.deepEqual(from.map((x) => x.name), ['B', 'A']);
});

test('session focus: validated, and old sessions default to motion', () => {
  assert.equal(createSession({ focus: 'head' }).focus, 'head');
  assert.throws(() => createSession({ focus: 'power' }));
  assert.equal(sessionFocus({}), 'motion');
});
