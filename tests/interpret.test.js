import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing } from '../src/analysis/pipeline.js';
import { createSession, createSwingRecord } from '../src/app/session.js';
import { describeSwing, headText, strideText, handPathText, scoreBand, focusScores, qcReasonZh, FOCUS_ORDER } from '../src/app/interpret.js';
import { referenceSession } from '../src/synthetic/session.js';
import { generateSwing, dropFrames } from '../src/synthetic/swing.js';

const session = createSession({}, 1);
const swings = [];
for (const s of referenceSession()) swings.push(createSwingRecord({ session, seq: s.seq, analysis: analyzeSwing(s.seq), previous: swings }));
const d = (i, focus = 'motion') => describeSwing(swings[i], focus, swings.slice(0, i));

test('first valid swing: building the Baseline, no score', () => {
  const r = d(0);
  assert.equal(r.kind, 'baseline');
  assert.match(r.note, /建立 Baseline/);
  assert.equal(r.focus, undefined);
});

test('near-baseline swing reads as 相近 everywhere and scores high', () => {
  const r = d(2);
  assert.equal(r.kind, 'compared');
  assert.match(r.focus.text, /相近/);
  for (const s of r.secondary) assert.match(s.text, /相近/, `${s.label}: ${s.text}`);
  assert.equal(r.focus.band, 'high');
  assert.equal(r.qc.text, 'Tracking 良好');
});

test('longer-stride swing: Stride 明顯較長; Motion names Stride as the largest difference', () => {
  const r = d(3, 'stride');
  assert.equal(r.focus.label, 'Stride Consistency');
  assert.equal(r.focus.text, '這一棒的 Stride 比最近 Baseline 明顯較長');
  assert.ok(r.focus.score < 50, `stride score ${r.focus.score}`);
  const motion = d(3, 'motion');
  assert.match(motion.focus.text, /差異最大的是 Stride/);
});

test('head-movement swing: Head Stability focus is low with a rank statement', () => {
  const r = d(4, 'head');
  assert.equal(r.focus.text, 'Head movement 比最近 4 棒都多');
  assert.ok(r.focus.score < 30, `head score ${r.focus.score}`);
  assert.ok(r.focus.delta < 0 && /−/.test(r.focus.deltaText), r.focus.deltaText);
});

test('selected focus is primary; the other three are secondary', () => {
  for (const f of FOCUS_ORDER) {
    const r = d(3, f);
    assert.equal(r.focus.key, f);
    assert.deepEqual(r.secondary.map((s) => s.key).sort(), FOCUS_ORDER.filter((k) => k !== f).sort());
  }
});

test('Head Stability display score is one-sided: less head movement than baseline is not penalized', () => {
  const steady = { ...swings[2], comparison: structuredClone(swings[2].comparison) };
  const h = steady.comparison.components.head;
  h.current = h.mean - 0.2; // much less movement
  assert.equal(focusScores(steady).head, 100);
  h.current = h.mean + 0.1; // one half-score more movement
  assert.equal(focusScores(steady).head, 50);
});

test('rejected swing: clear Chinese reasons, states it will not enter the Baseline', () => {
  const bad = dropFrames(generateSwing(), 1.0, 1.3);
  const rec = createSwingRecord({ session, seq: bad, analysis: analyzeSwing(bad), previous: swings });
  const r = describeSwing(rec, 'motion', swings);
  assert.equal(r.kind, 'rejected');
  assert.equal(r.headline, '這一棒 Tracking 不穩定');
  assert.equal(r.note, '這一棒不會加入 Baseline。');
  assert.ok(r.reasons.some((x) => /追蹤中斷|消失/.test(x)), r.reasons.join(' | '));
  assert.ok(r.advice.length > 0);
  assert.equal(r.focus, undefined, 'no score shown for a failed measurement');
});

test('rejection reason from event detection is listed first, in Chinese', () => {
  const seq = generateSwing();
  const cut = { ...seq, frames: seq.frames.filter((f) => f.t >= 0.7) };
  const rec = createSwingRecord({ session, seq: cut, analysis: analyzeSwing(cut), previous: swings });
  const r = describeSwing(rec, 'motion', swings);
  assert.match(r.reasons[0], /揮棒前約 1 秒開始錄影/);
});

test('QC reasons are translated for every check id', () => {
  const ids = ['presence', 'group_wrists', 'group_ankles', 'gap_wrists', 'gap_body', 'size', 'outOfFrame', 'jumps', 'frames'];
  for (const id of ids) {
    const t = qcReasonZh({ id, value: id === 'jumps' || id === 'frames' ? 2 : 0.5, reason: 'EN' });
    assert.notEqual(t, 'EN', id);
    assert.ok(!/[a-z]{4,}/.test(t.replace(/Tracking|Stride|Baseline/g, '')), `${id}: ${t}`);
  }
});

test('wording never contains coaching diagnosis or Simplified Chinese', () => {
  const all = swings.flatMap((_, i) => FOCUS_ORDER.map((f) => d(i, f)))
    .flatMap((x) => [x.headline, x.note, x.focus?.text, x.focus?.deltaText, ...(x.secondary || []).map((s) => s.text), x.timing])
    .filter(Boolean).join(' ');
  for (const banned of ['錯誤', '應該', '太早', '太晚', '髖開', '受傷', '不正確']) assert.ok(!all.includes(banned), banned);
  for (const simplified of ['稳', '动', '击', '轨', '与', '这', '较', '时', '节', '头', '没']) assert.ok(!all.includes(simplified), `simplified: ${simplified}`);
});

test('wording helpers handle missing data', () => {
  assert.equal(headText(null), '無法比較');
  assert.equal(strideText(null, null), '無法比較');
  assert.equal(handPathText(null), '無法比較');
  assert.equal(scoreBand(null), 'none');
  assert.match(strideText(null, { diagnostics: { reason: 'no stride detected (lead foot barely moved)' } }), /沒有偵測到/);
});
