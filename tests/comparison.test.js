import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { compareToBaseline, componentDeviations, selectBaseline, meanTrajectory } from '../src/analysis/comparison.js';
import { referenceSession, naturalVariation } from '../src/synthetic/session.js';
import { generateSwing, dropFrames } from '../src/synthetic/swing.js';

function analyzeSession(swings) {
  const done = [];
  const results = [];
  for (const s of swings) {
    const cur = { id: s.id, analysis: analyzeSwing(s.seq) };
    results.push({ ...cur, label: s.label, cmp: cur.analysis.usable ? compareToBaseline(cur, done) : null });
    done.push(cur);
  }
  return results;
}

const session = analyzeSession(referenceSession());
const byId = Object.fromEntries(session.map((r) => [r.id, r]));
const devs = (r) => Object.fromEntries(componentDeviations(r.cmp));

test('reference session: all swings analyzable', () => {
  for (const r of session) assert.equal(r.analysis.status, 'ok', `${r.id}: ${r.analysis.reason}`);
});

test('first swing has no baseline yet', () => {
  assert.equal(byId['syn-1'].cmp.ok, false);
  assert.match(byId['syn-1'].cmp.reason, /starts the baseline/);
});

test('near-baseline swings 2–3 have small deviations in every component', () => {
  for (const id of ['syn-2', 'syn-3']) {
    for (const [k, d] of Object.entries(devs(byId[id]))) assert.ok(d < 2, `${id} ${k} deviation ${d.toFixed(2)}`);
  }
});

test('swing 4 (longer stride): stride is the largest deviation and clearly abnormal', () => {
  const d = devs(byId['syn-4']);
  assert.ok(d.stride > 5, `stride deviation ${d.stride}`);
  assert.ok(d.head < 2, `head should stay normal: ${d.head}`);
  assert.ok(d.wristPath < 2, `hand path (pelvis-relative) should stay normal: ${d.wristPath}`);
  const top = Object.entries(d).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, 'stride');
  assert.ok(byId['syn-4'].cmp.components.stride.z > 0, 'stride is longer, not shorter');
});

test('swing 5 (more head movement): head is clearly abnormal and the largest component', () => {
  const d = devs(byId['syn-5']);
  assert.ok(d.head > 5, `head deviation ${d.head}`);
  const top = Object.entries(d).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, 'head');
  const head = byId['syn-5'].cmp.components.head;
  assert.equal(head.rank.greater, 0, 'more head movement than every baseline swing');
});

test('repeated similar swings deviate less than deliberately different ones (overall pose)', () => {
  const similar = Math.max(devs(byId['syn-2']).pose, devs(byId['syn-3']).pose);
  assert.ok(devs(byId['syn-4']).pose > similar, 'longer stride changes the body trajectory');
  assert.ok(devs(byId['syn-5']).pose > similar, 'head movement changes the body trajectory');
});

test('altered hand path is detected by the wrist-path component', () => {
  const swings = [0, 1, 2, 3].map((i) => ({ id: `w${i}`, seq: generateSwing(naturalVariation(i)) }));
  swings.push({ id: 'w-alt', seq: generateSwing({ ...naturalVariation(4), handRadius: 0.85, handPlaneSquash: 0.6 }) });
  const r = analyzeSession(swings);
  const d = devs(r.at(-1));
  assert.ok(d.wristPath > 5, `wrist path deviation ${d.wristPath}`);
  for (const x of r.slice(1, 4)) assert.ok(devs(x).wristPath < 2.5, `similar swing wrist deviation ${devs(x).wristPath}`);
});

test('rejected (QC-failed) swings never enter the baseline', () => {
  const good = { id: 'g', analysis: analyzeSwing(generateSwing(naturalVariation(0))) };
  const bad = { id: 'b', analysis: analyzeSwing(dropFrames(generateSwing(naturalVariation(1)), 1.0, 1.25)) };
  assert.equal(bad.analysis.usable, false);
  const base = selectBaseline([good, bad]);
  assert.deepEqual(base.map((s) => s.id), ['g']);
  const cur = { id: 'c', analysis: analyzeSwing(generateSwing(naturalVariation(2))) };
  assert.deepEqual(compareToBaseline(cur, [good, bad]).baselineIds, ['g']);
});

test('baseline uses only the most recent N valid swings', () => {
  const hist = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, analysis: { usable: true } }));
  assert.deepEqual(selectBaseline(hist, 5).map((s) => s.id), ['h3', 'h4', 'h5', 'h6', 'h7']);
  assert.deepEqual(selectBaseline([...hist.slice(0, 2), { id: 'x', analysis: { usable: true }, excludeFromBaseline: true }], 5).map((s) => s.id), ['h0', 'h1']);
});

test('single-swing baseline uses the noise floor, never divides by zero', () => {
  const a = { id: 'a', analysis: analyzeSwing(generateSwing(naturalVariation(0))) };
  const b = { id: 'b', analysis: analyzeSwing(generateSwing(naturalVariation(1))) };
  const cmp = compareToBaseline(b, [a]);
  assert.equal(cmp.components.stride.sd, null);
  assert.equal(cmp.components.stride.spread, cmp.components.stride.floor);
  for (const [, d] of componentDeviations(cmp)) assert.ok(Number.isFinite(d));
});

test('meanTrajectory averages point-wise and skips missing samples', () => {
  assert.deepEqual(meanTrajectory([[[0, 0], null], [[2, 2], [4, 4]]]), [[1, 1], [4, 4]]);
});

test('comparison is deterministic', () => {
  const again = analyzeSession(referenceSession());
  assert.deepEqual(again.map((r) => r.cmp), session.map((r) => r.cmp));
});
