import { describe, expect, it } from 'vitest';
import { analyzeBatting, CONTACT_DELAY_MAX_S, contactDelay } from './batting';
import { firstBelowAfter, handSpeed } from './common';
import { angleAt, leanFromVertical } from './geometry';
import { argmax } from './signal';
import { buildTracks } from './tracks';
import { loadFixture } from '../../tests/fixtures';
import { battingPose, battingTruth, generateBatting, SYNTH_TORSO_PX } from '../../tests/synthetic';
import type { PoseSequence } from './types';

const T = SYNTH_TORSO_PX;

/** Ground truth computed from the clean synthetic model at the designed event times. */
function truthMetrics(s: 1 | -1) {
  const ev = battingTruth(s).events;
  const ref = battingPose(0.4, s);
  const P = battingPose(ev.plant, s);
  const C = battingPose(ev.contact, s);
  // Peak hand speed by fine finite differences.
  let peak = 0;
  for (let t = 0.9; t < 1.3; t += 0.0005) {
    const a = battingPose(t, s).hand;
    const b = battingPose(t + 0.0005, s).hand;
    peak = Math.max(peak, Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.0005 / T);
  }
  const pt = (p: [number, number]) => ({ x: p[0], y: p[1] });
  return {
    stride: ((P.leadAnkle[0] - ref.leadAnkle[0]) * s) / T,
    pelvis: ((C.hip[0] - ref.hip[0]) * s) / T,
    headDx: ((C.nose[0] - ref.nose[0]) * s) / T,
    headDy: (ref.nose[1] - C.nose[1]) / T,
    kneePlant: angleAt(pt(P.leadHip), pt(P.leadKnee), pt(P.leadAnkle)),
    kneeContact: angleAt(pt(C.leadHip), pt(C.leadKnee), pt(C.leadAnkle)),
    trunk: leanFromVertical(pt(C.hip), pt(C.sh), s),
    peakSpeed: peak,
  };
}

const cases: { name: string; evTol: number; posTol: number; angTol: number; speedTol: number }[] = [
  { name: 'batting-240fps', evTol: 0.025, posTol: 0.03, angTol: 3, speedTol: 0.08 },
  { name: 'batting-120fps-noisy', evTol: 0.03, posTol: 0.05, angTol: 5, speedTol: 0.12 },
  { name: 'batting-lefty-240fps-noisy', evTol: 0.03, posTol: 0.05, angTol: 5, speedTol: 0.12 },
  { name: 'batting-30fps', evTol: 0.05, posTol: 0.08, angTol: 8, speedTol: 0.3 },
];

describe('analyzeBatting on synthetic fixtures', () => {
  for (const c of cases) {
    describe(c.name, () => {
      const { seq, params } = loadFixture(c.name);
      const s = params.forward ?? 1;
      const r = analyzeBatting(seq);
      const truth = truthMetrics(s);
      const bt = battingTruth(s);
      const ev = bt.events;

      it('passes quality control and finds the direction', () => {
        expect(r.failure).toBeUndefined();
        expect(r.quality.ok).toBe(true);
        expect(r.forward).toBe(s);
        expect(r.quality.fps).toBeCloseTo(params.fps, 0);
      });
      it('detects the phase events', () => {
        expect(Math.abs(r.events.load! - ev.load)).toBeLessThan(c.evTol + 0.03);
        expect(Math.abs(r.events.plant! - ev.plant)).toBeLessThan(c.evTol);
        expect(Math.abs(r.events.contact! - ev.contact)).toBeLessThan(c.evTol);
        expect(Math.abs(r.events.finish! - ev.finish)).toBeLessThan(c.evTol + 0.02);
      });
      it('measures stride, pelvis shift and head displacement in torso units', () => {
        expect(r.metrics.stride_length!.unit).toBe('torso');
        expect(Math.abs(r.metrics.stride_length!.value - truth.stride)).toBeLessThan(c.posTol);
        expect(Math.abs(r.metrics.pelvis_shift!.value - truth.pelvis)).toBeLessThan(c.posTol);
        expect(Math.abs(r.metrics.head_dx!.value - truth.headDx)).toBeLessThan(c.posTol);
        expect(Math.abs(r.metrics.head_dy!.value - truth.headDy)).toBeLessThan(c.posTol);
      });
      it('measures knee and trunk angles', () => {
        expect(Math.abs(r.metrics.lead_knee_plant!.value - truth.kneePlant)).toBeLessThan(c.angTol);
        expect(Math.abs(r.metrics.lead_knee_contact!.value - truth.kneeContact)).toBeLessThan(
          c.angTol,
        );
        expect(Math.abs(r.metrics.trunk_tilt_contact!.value - truth.trunk)).toBeLessThan(c.angTol);
      });
      it('measures peak wrist speed and its timing', () => {
        const v = r.metrics.wrist_peak_speed!.value;
        expect(Math.abs(v - truth.peakSpeed) / truth.peakSpeed).toBeLessThan(c.speedTol);
        const tPeak = r.metrics.wrist_peak_time_ms!.value;
        expect(Math.abs(tPeak - (bt.handPeak - ev.plant) * 1000)).toBeLessThan(c.evTol * 1000 * 2);
      });
      it('phase durations add up to the event times', () => {
        const sum = r.metrics.phase_load_ms!.value + r.metrics.phase_plant_to_contact_ms!.value;
        expect(sum).toBeCloseTo((r.events.contact! - r.events.load!) * 1000, 0);
      });
      it('every metric carries value, unit and confidence', () => {
        for (const m of Object.values(r.metrics)) {
          expect(Number.isFinite(m.value)).toBe(true);
          expect(m.confidence).toBeGreaterThan(0);
          expect(m.confidence).toBeLessThanOrEqual(1);
        }
      });
    });
  }

  it('estimates pelvis-before-shoulder sequence (experimental)', () => {
    const r = analyzeBatting(loadFixture('batting-240fps').seq);
    const m = r.metrics.seq_pelvis_lead_ms!;
    expect(m.experimental).toBe(true);
    expect(m.value).toBeGreaterThan(20);
    expect(m.value).toBeLessThan(90);
  });

  it('is deterministic: the same input gives identical output', () => {
    const { seq } = loadFixture('batting-120fps-noisy');
    expect(analyzeBatting(seq)).toEqual(analyzeBatting(structuredClone(seq)));
  });

  it('is invariant to image scale and horizontal position', () => {
    const { seq } = loadFixture('batting-240fps');
    const moved: PoseSequence = {
      width: seq.width,
      height: seq.height,
      frames: seq.frames.map((f) => ({
        t: f.t,
        lm: f.lm!.map((p) => ({ x: 0.1 + p.x * 0.7, y: 0.05 + p.y * 0.7, v: p.v })),
      })),
    };
    const a = analyzeBatting(seq).metrics;
    const b = analyzeBatting(moved).metrics;
    expect(b.stride_length!.value).toBeCloseTo(a.stride_length!.value, 2);
    expect(b.lead_knee_plant!.value).toBeCloseTo(a.lead_knee_plant!.value, 0);
    expect(b.wrist_peak_speed!.value).toBeCloseTo(a.wrist_peak_speed!.value, 1);
  });

  it('places contact after the hand-speed peak, not at it', () => {
    const r = analyzeBatting(loadFixture('batting-240fps').seq);
    const dt = r.events.contact! - battingTruth(1).handPeak;
    expect(dt).toBeGreaterThanOrEqual(contactDelay(240) - 0.002);
    expect(dt).toBeLessThan(contactDelay(240) + 1 / 240 + 0.002);
  });

  it('shortens the delay at low frame rates, where rounding up adds part of a frame', () => {
    expect(contactDelay(240)).toBeGreaterThan(contactDelay(30));
    expect(contactDelay(30)).toBeCloseTo(0.064, 3);
    expect(contactDelay(24)).toBeCloseTo(0.06275, 4);
    expect(contactDelay(1000)).toBeLessThanOrEqual(CONTACT_DELAY_MAX_S);
  });

  it('finds the finish after the follow-through, not at the dip right after contact', () => {
    const { seq } = loadFixture('batting-240fps');
    const r = analyzeBatting(seq);
    const ev = battingTruth(1).events;
    // The old rule (first drop below 25% of the peak) stopped at the dip.
    const tr = buildTracks(seq, 12, 20);
    const hands = handSpeed(tr);
    const iH = argmax(hands);
    const oldFinish = tr.t[firstBelowAfter(hands, iH, 0.25 * hands[iH]!)]!;
    expect(oldFinish - ev.contact).toBeLessThan(0.1);
    expect(r.events.finish! - ev.contact).toBeGreaterThan(0.15);
    expect(Math.abs(r.events.finish! - ev.finish)).toBeLessThan(0.02);
  });

  it('the contact frame is not before contact, whatever the frame phase (30 fps)', () => {
    const ev = battingTruth(1).events;
    for (let k = 0; k < 6; k++) {
      const r = analyzeBatting(generateBatting({ fps: 30, phase: k / 180 }));
      expect(r.failure).toBeUndefined();
      expect(r.events.contact!).toBeGreaterThanOrEqual(ev.contact);
      expect(r.events.contact! - ev.contact).toBeLessThan(1 / 30 + 0.012);
    }
  });

  it('reports a clip that ends before contact', () => {
    const { seq } = loadFixture('batting-240fps');
    const cut = battingTruth(1).handPeak + 0.03;
    const r = analyzeBatting({ ...seq, frames: seq.frames.filter((f) => f.t <= cut) });
    expect(r.failure).toBe('events_not_found');
    expect(r.quality.warnings).toContain('contact_not_in_clip');
  });

  it('uses manually corrected events', () => {
    const { seq } = loadFixture('batting-240fps');
    const auto = analyzeBatting(seq);
    const r = analyzeBatting(seq, { manualEvents: { plant: 0.8 } });
    expect(r.events.plant).toBeCloseTo(0.8, 2);
    expect(r.metrics.stride_length!.value).toBeLessThan(auto.metrics.stride_length!.value);
  });
});

describe('analyzeBatting quality control', () => {
  it('rejects clips sampled below 24 fps', () => {
    const { seq } = loadFixture('batting-240fps');
    const slow = { ...seq, frames: seq.frames.filter((_, i) => i % 16 === 0) }; // 15 fps
    const r = analyzeBatting(slow);
    expect(r.failure).toBe('fps_too_low');
    expect(r.metrics).toEqual({});
  });

  it('rejects when the person is lost during the swing', () => {
    const { seq } = loadFixture('batting-240fps');
    const lost = {
      ...seq,
      frames: seq.frames.map((f) => (f.t > 0.85 && f.t < 1.05 ? { t: f.t, lm: null } : f)),
    };
    const r = analyzeBatting(lost);
    expect(r.failure).toBeDefined();
    expect(r.metrics).toEqual({});
  });

  it('rejects low-visibility tracking', () => {
    const { seq } = loadFixture('batting-240fps');
    const dim = {
      ...seq,
      frames: seq.frames.map((f) => ({ t: f.t, lm: f.lm!.map((p) => ({ ...p, v: 0.2 })) })),
    };
    const r = analyzeBatting(dim);
    expect(r.failure).toBe('tracking_poor');
    expect(r.metrics).toEqual({});
  });

  it('warns that timing is coarse below 100 fps', () => {
    const r = analyzeBatting(loadFixture('batting-30fps').seq);
    expect(r.quality.warnings).toContain('fps_low');
  });

  it('flags implausibly slow timing (e.g. a time-stretched slow-motion export)', () => {
    // 240 fps stretched 8x plays back at 30 fps with every motion 8x slower.
    const { seq } = loadFixture('batting-240fps');
    const stretched = { ...seq, frames: seq.frames.map((f) => ({ ...f, t: f.t * 8 })) };
    const r = analyzeBatting(stretched);
    expect(r.failure).toBe('timing_implausible');
  });
});
