import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { reduceSequence, expandSequence } from '../src/pose/landmarks.js';
import { createSession, createSwingRecord, setContactLabel, labelSummary, recomputeSession, exportSession, CONTACT_LABELS } from '../src/app/session.js';
import { openStore } from '../src/storage/indexedDb.js';
import { referenceSession } from '../src/synthetic/session.js';
import { generateSwing, dropFrames } from '../src/synthetic/swing.js';

function buildSession() {
  const session = createSession({ playerName: 'Test', battingSide: 'R' }, 1000);
  const swings = [];
  for (const s of referenceSession()) {
    swings.push(createSwingRecord({ session, seq: s.seq, analysis: analyzeSwing(s.seq), previous: swings, now: 2000 + swings.length }));
  }
  return { session, swings };
}

test('reduced landmark storage round-trips to the same analysis (within rounding)', () => {
  const seq = generateSwing({ seed: 3 });
  const a = analyzeSwing(seq);
  const b = analyzeSwing(expandSequence(JSON.parse(JSON.stringify(reduceSequence(seq)))));
  assert.equal(b.status, 'ok');
  assert.ok(Math.abs(a.metrics.stride.value - b.metrics.stride.value) < 0.005);
  assert.ok(Math.abs(a.metrics.headStability.value - b.metrics.headStability.value) < 0.005);
  for (const k of Object.keys(a.events)) assert.ok(Math.abs(a.events[k] - b.events[k]) < 0.005, k);
});

test('swing records are numbered and compared against earlier swings', () => {
  const { swings } = buildSession();
  assert.deepEqual(swings.map((s) => s.number), [1, 2, 3, 4, 5]);
  assert.equal(swings[0].consistency.score, null);
  assert.ok(swings[3].consistency.score < swings[1].consistency.score);
  assert.equal(swings[4].comparison.baselineCount, 4);
  assert.equal(swings[0].contact, null);
});

test('stored swing record stays small (no video, reduced landmarks)', () => {
  const { swings } = buildSession();
  const bytes = JSON.stringify(swings[2]).length;
  assert.ok(bytes < 300_000, `${bytes} bytes`);
});

test('QC-failed swing is stored as invalid, gets no score, and is not in later baselines', () => {
  const session = createSession({}, 1);
  const s1 = createSwingRecord({ session, seq: generateSwing({ seed: 1 }), analysis: analyzeSwing(generateSwing({ seed: 1 })), previous: [] });
  const badSeq = dropFrames(generateSwing({ seed: 2 }), 1.0, 1.3);
  const s2 = createSwingRecord({ session, seq: badSeq, analysis: analyzeSwing(badSeq), previous: [s1] });
  assert.equal(s2.valid, false);
  assert.equal(s2.consistency, null);
  const s3 = createSwingRecord({ session, seq: generateSwing({ seed: 3 }), analysis: analyzeSwing(generateSwing({ seed: 3 })), previous: [s1, s2] });
  assert.deepEqual(s3.comparison.baselineIds, [s1.id]);
});

test('contact labels: only good / medium / poor / null accepted', () => {
  const { swings } = buildSession();
  for (const l of CONTACT_LABELS) assert.equal(setContactLabel(swings[0], l).contact, l);
  assert.equal(setContactLabel(swings[0], null).contact, null);
  assert.throws(() => setContactLabel(swings[0], 'great'));
});

test('labelSummary groups motion metrics by contact label (descriptive only)', () => {
  const { swings } = buildSession();
  const labeled = swings.map((s, i) => setContactLabel(s, ['good', 'good', 'medium', 'poor', null][i]));
  const sum = labelSummary(labeled);
  assert.equal(sum.good.count, 2);
  assert.equal(sum.medium.count, 1);
  assert.equal(sum.poor.count, 1);
  assert.equal(sum.unlabeled.count, 1);
  assert.equal(sum.good.consistency, swings[1].consistency.score, 'swing 1 has no score, so the mean is swing 2 only');
  assert.ok(sum.poor.stride > sum.good.stride, 'swing 4 (poor) has the long stride');
});

test('excluding a swing from the baseline and recomputing changes later comparisons deterministically', () => {
  const { swings } = buildSession();
  const excluded = swings.map((s) => (s.number === 4 ? { ...s, excludeFromBaseline: true } : s));
  const re = recomputeSession(excluded);
  assert.ok(!re[4].comparison.baselineIds.includes(swings[3].id));
  assert.deepEqual(recomputeSession(excluded), re);
});

test('IndexedDB store: sessions and swings persist across reopen (page refresh)', async () => {
  const idb = new IDBFactory();
  const { session, swings } = buildSession();
  let store = await openStore(idb, 'test-db');
  await store.putSession(session);
  await store.putSwings(swings);
  await store.putSwing(setContactLabel(swings[1], 'good'));
  await store.setMeta('activeSession', session.id);
  store.close();

  store = await openStore(idb, 'test-db');
  assert.equal(await store.getMeta('activeSession'), session.id);
  const loaded = await store.listSwings(session.id);
  assert.deepEqual(loaded.map((s) => s.number), [1, 2, 3, 4, 5]);
  assert.equal(loaded[1].contact, 'good');
  assert.deepEqual(loaded[3].consistency, swings[3].consistency, 'stored metrics reproduce the score');
  assert.equal((await store.listSessions()).length, 1);

  await store.deleteSwing(swings[0].id);
  assert.equal((await store.listSwings(session.id)).length, 4);
  await store.deleteSession(session.id);
  assert.equal((await store.listSessions()).length, 0);
  assert.equal((await store.listSwings(session.id)).length, 0);
  store.close();
});

test('exportSession produces plain JSON with per-swing rows', () => {
  const { session, swings } = buildSession();
  const out = JSON.parse(JSON.stringify(exportSession(session, swings)));
  assert.equal(out.format, 'swingtraining-session');
  assert.equal(out.swings.length, 5);
  assert.equal(out.swings[3].row.number, 4);
});
