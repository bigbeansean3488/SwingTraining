import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { compareToBaseline } from '../src/analysis/comparison.js';
import { motionConsistency, consistencyInputs, scoreFromInputs, componentScore, sessionConsistency, CONSISTENCY_PARAMS } from '../src/analysis/consistency.js';
import { referenceSession, variableSession } from '../src/synthetic/session.js';

function scoreSession(swings) {
  const done = [];
  return swings.map((s) => {
    const cur = { id: s.id, analysis: analyzeSwing(s.seq) };
    const cmp = cur.analysis.usable ? compareToBaseline(cur, done) : null;
    done.push(cur);
    return { id: s.id, label: s.label, cmp, consistency: motionConsistency(cmp) };
  });
}

test('component score: 100 at zero difference, 50 at the half-score difference, monotonic', () => {
  assert.equal(componentScore(0, 0.1), 100);
  assert.ok(Math.abs(componentScore(0.1, 0.1) - 50) < 1e-9);
  assert.ok(componentScore(0.05, 0.1) > componentScore(0.1, 0.1));
  assert.ok(componentScore(0.3, 0.1) < componentScore(0.2, 0.1));
});

test('weights are transparent and sum to 1', () => {
  const sum = Object.values(CONSISTENCY_PARAMS.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});

test('first swing has no score (baseline only)', () => {
  const [first] = scoreSession(referenceSession());
  assert.equal(first.consistency.score, null);
});

test('reference session: near-baseline swings score high, deliberate changes score lower', () => {
  const r = scoreSession(referenceSession());
  const [, s2, s3, s4, s5] = r.map((x) => x.consistency.score);
  assert.ok(s2 >= 85 && s3 >= 85, `near-baseline ${s2}, ${s3}`);
  assert.ok(s4 < s2 - 15 && s4 < s3 - 15, `longer stride ${s4}`);
  assert.ok(s5 < s2 - 15 && s5 < s3 - 15, `more head movement ${s5}`);
  // Explainable: the low component matches the deliberate change.
  const low = (x) => x.consistency.components.filter((c) => c.used).sort((a, b) => a.score - b.score)[0].name;
  assert.ok(['stride', 'pose'].includes(low(r[3])), `swing 4 lowest component ${low(r[3])}`);
  assert.equal(low(r[4]), 'head');
});

test('session ordering: stable > moderately variable > highly variable', () => {
  const mean = (amount) => sessionConsistency(scoreSession(variableSession(8, amount)).map((x) => x.consistency.score)).mean;
  const stable = mean(0.5);
  const moderate = mean(2.5);
  const high = mean(6);
  assert.ok(stable > moderate && moderate > high, `stable ${stable} moderate ${moderate} high ${high}`);
  // How far apart the sessions land depends on the PROVISIONAL half-score
  // calibration (field data needed); only require a clear gap here.
  assert.ok(stable - high > 10, `gap ${stable - high}`);
});

test('deterministic: identical input → identical score', () => {
  const a = scoreSession(referenceSession()).map((x) => x.consistency);
  const b = scoreSession(referenceSession()).map((x) => x.consistency);
  assert.deepEqual(a, b);
});

test('reproducible from stored inputs (JSON round-trip)', () => {
  for (const x of scoreSession(referenceSession()).slice(1)) {
    const stored = JSON.parse(JSON.stringify(consistencyInputs(x.cmp)));
    assert.deepEqual(scoreFromInputs(stored), x.consistency);
  }
});

test('raw component values are retained in the result', () => {
  const x = scoreSession(referenceSession())[3].consistency;
  for (const c of x.components) {
    assert.ok('diff' in c && 'weight' in c && 'score' in c);
  }
  assert.equal(x.validation.field, 'PENDING');
});

test('missing component → weights renormalized over available components', () => {
  const r = scoreFromInputs({ baselineCount: 3, head: 0, stride: 0, timing: null, wristPath: 0, pose: 0 });
  assert.equal(r.score, 100);
  const used = r.components.filter((c) => c.used);
  assert.equal(used.length, 4);
  assert.ok(Math.abs(used.reduce((a, c) => a + c.effectiveWeight, 0) - 1) < 1e-12);
});
