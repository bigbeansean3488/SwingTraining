// Lead-leg choice and stride sign under the failure modes seen on real
// videos: the pitcher's rear foot swinging past the stride foot after
// release, and MediaPipe swapping the left/right leg labels.
import { describe, expect, it } from 'vitest';
import { analyzeBatting } from './batting';
import {
  battingLegs,
  battingStride,
  cutoffs,
  findLeadLeg,
  pitchingLegs,
  sidesAt,
  STRIDE_MIN,
} from './common';
import { metricFigures } from './figures';
import { analyzePitching } from './pitching';
import { assessClip } from './quality';
import { LM } from './landmarks';
import { buildTracks, fixLegLabelSwaps, indexAt } from './tracks';
import type { PoseSequence } from './types';
import {
  battingPose,
  battingTruth,
  generateBatting,
  generatePitching,
  pitchingPose,
  pitchingTruth,
  SYNTH_TORSO_PX,
} from '../../tests/synthetic';

const T = SYNTH_TORSO_PX;

function tracksOf(seq: PoseSequence) {
  const q = assessClip(seq);
  const fc = cutoffs(q.fps);
  return buildTracks(seq, fc.position, fc.speed);
}

function pitchStrideTruth(s: 1 | -1, rearFollow = 0.3) {
  const plant = pitchingTruth(s).events.plant;
  const P = pitchingPose(plant, s, 1.6, 1, rearFollow);
  return ((P.leadAnkle[0] - P.rearAnkle[0]) * s) / T;
}

function battingStrideTruth(s: 1 | -1) {
  const plant = battingTruth(s).events.plant;
  const ref = battingPose(0.35, s);
  return ((battingPose(plant, s).leadAnkle[0] - ref.leadAnkle[0]) * s) / T;
}

describe('pitching: rear foot swings past the stride foot after release', () => {
  for (const s of [1, -1] as const) {
    const seq = generatePitching({ fps: 240, forward: s, rearFollow: 2.4 });

    it(`reproduces the old failure (forward ${s})`, () => {
      // Judged over the whole clip, the rear leg moves farther and wins.
      const tr = tracksOf(seq);
      const old = findLeadLeg(tr);
      const legs = pitchingLegs(tr);
      expect(old.lead.ankle).not.toBe(legs.lead.ankle);
    });

    it(`keeps the stride positive and correct (forward ${s})`, () => {
      const r = analyzePitching(seq);
      expect(r.failure).toBeUndefined();
      expect(r.forward).toBe(s);
      const m = r.metrics.stride_length!;
      expect(m.value).toBeGreaterThan(0);
      expect(Math.abs(m.value - pitchStrideTruth(s, 2.4))).toBeLessThan(0.04);
      expect(r.quality.warnings).not.toContain('stride_implausible');
    });

    it(`draws the figure from the same feet (forward ${s})`, () => {
      const r = analyzePitching(seq);
      const f = metricFigures('pitching', seq, r.events).figures.stride_length!;
      const arrow = f.shapes.find((x) => x.type === 'arrow')!;
      if (arrow.type !== 'arrow') throw new Error('no arrow');
      expect(((arrow.to.x - arrow.from.x) * s) / T).toBeCloseTo(r.metrics.stride_length!.value, 3);
    });
  }
});

describe('left/right leg labels swapped by the pose model', () => {
  it('pitching: stride and lead knee stay correct when labels swap before plant', () => {
    const s = 1;
    const ev = pitchingTruth(s).events;
    const seq = generatePitching({ fps: 240, forward: s, swapLegsAfter: 0.98 });
    const r = analyzePitching(seq, { manualEvents: ev });
    const m = r.metrics.stride_length!;
    expect(Math.abs(m.value - pitchStrideTruth(s))).toBeLessThan(0.04);
    const clean = analyzePitching(generatePitching({ fps: 240, forward: s }), {
      manualEvents: ev,
    });
    expect(
      Math.abs(r.metrics.lead_knee_plant!.value - clean.metrics.lead_knee_plant!.value),
    ).toBeLessThan(3);
  });

  it('batting: stride stays correct when labels swap after the stride', () => {
    const s = -1;
    const ev = battingTruth(s).events;
    const seq = generateBatting({ fps: 240, forward: s, swapLegsAfter: 0.88 });
    const r = analyzeBatting(seq, { manualEvents: ev });
    expect(r.forward).toBe(s);
    const m = r.metrics.stride_length!;
    expect(Math.abs(m.value - battingStrideTruth(s))).toBeLessThan(0.04);
  });

  it('repairs the swapped labels frame by frame before filtering', () => {
    const clean = generatePitching({ fps: 120 });
    const swapped = generatePitching({ fps: 120, swapLegsAfter: 0.7 });
    const fixed = fixLegLabelSwaps(swapped);
    expect(fixed).not.toBe(swapped);
    for (let i = 0; i < clean.frames.length; i++) {
      expect(fixed.frames[i]!.lm![LM.L_ANKLE]).toEqual(clean.frames[i]!.lm![LM.L_ANKLE]);
      expect(fixed.frames[i]!.lm![LM.R_KNEE]).toEqual(clean.frames[i]!.lm![LM.R_KNEE]);
    }
    // Clean input comes back unchanged (same object).
    expect(fixLegLabelSwaps(clean)).toBe(clean);
  });

  it('finds the events on its own when labels swap mid-motion', () => {
    const s = -1;
    const seq = generateBatting({ fps: 240, forward: s, swapLegsAfter: 0.7, noisePx: 2, seed: 4 });
    const r = analyzeBatting(seq);
    expect(r.failure).toBeUndefined();
    expect(Math.abs(r.events.plant! - battingTruth(s).events.plant)).toBeLessThan(0.025);
    expect(Math.abs(r.metrics.stride_length!.value - battingStrideTruth(s))).toBeLessThan(0.06);
  });

  it('does not invent swaps when the feet cross (30 fps, rear foot swinging through)', () => {
    const seq = generatePitching({ fps: 30, rearFollow: 2.4 });
    expect(fixLegLabelSwaps(seq)).toBe(seq);
    const r = analyzePitching(seq);
    expect(Math.abs(r.metrics.stride_length!.value - pitchStrideTruth(1, 2.4))).toBeLessThan(0.1);
  });

  it('sidesAt only swaps when the lead ankle is clearly behind', () => {
    const seq = generateBatting({ fps: 240 });
    const tr = tracksOf(seq);
    const legs = battingLegs(tr);
    const i = indexAt(tr, 0.3);
    expect(sidesAt(tr, legs, i).swapped).toBe(false);
    expect(sidesAt(tr, { ...legs, lead: legs.rear, rear: legs.lead }, i).swapped).toBe(true);
  });
});

describe('stride sanity check', () => {
  const seq = generateBatting({ fps: 240 });
  const tr = tracksOf(seq);
  const legs = battingLegs(tr);
  const ev = battingTruth(1).events;
  const iL = indexAt(tr, ev.load);
  const iP = indexAt(tr, ev.plant);
  const a = Math.max(0, iL - Math.round(0.2 * tr.fs));

  it('measures a normal stride as positive', () => {
    const r = battingStride(tr, legs, a, iL, iP);
    expect(r.value).toBeCloseTo(battingStrideTruth(1), 1);
  });

  it('reports a slightly negative stride (no stride + noise) as zero', () => {
    const r = battingStride(tr, legs, a, iL, a);
    expect(r.raw).toBeLessThanOrEqual(0.01);
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThan(0.02);
  });

  for (const s of [1, -1] as const) {
    it(`a backward step keeps the direction and is reported as unmeasurable (forward ${s})`, () => {
      // The front foot steps toward the catcher: the motion points backward,
      // but the stance foot order still gives the real direction.
      const back = generateBatting({ fps: 240, forward: s, stride: -0.4 });
      const r = analyzeBatting(back, { manualEvents: battingTruth(s).events });
      expect(r.forward).toBe(s);
      expect(r.metrics.stride_length).toBeUndefined();
      expect(r.quality.warnings).toContain('stride_implausible');
      expect(r.metrics.lead_knee_plant).toBeDefined();
    });
  }

  it('the threshold separates noise from a backward stride', () => {
    expect(STRIDE_MIN).toBeLessThan(0);
    expect(STRIDE_MIN).toBeGreaterThanOrEqual(-0.2);
  });
});
