import { describe, expect, it } from 'vitest';
import { analyze } from './index';
import { analyzePitching } from './pitching';
import { angleAt, leanFromVertical } from './geometry';
import { loadFixture } from '../../tests/fixtures';
import { pitchingPose, pitchingTruth, SYNTH_TORSO_PX } from '../../tests/synthetic';

const T = SYNTH_TORSO_PX;
const pt = (p: [number, number]) => ({ x: p[0], y: p[1] });

/** Ground truth from the clean model: events found numerically, metrics at those times. */
function truth(s: 1 | -1) {
  const dt = 0.0005;
  let liftTop = 0;
  let minY = Infinity;
  for (let t = 0; t < 1.0; t += dt) {
    const y = pitchingPose(t, s).leadKnee[1];
    if (y < minY) {
      minY = y;
      liftTop = t;
    }
  }
  let release = 0;
  let peak = 0;
  for (let t = 0.9; t < 1.4; t += dt) {
    const a = pitchingPose(t, s).rearWrist;
    const b = pitchingPose(t + dt, s).rearWrist;
    const v = Math.hypot(b[0] - a[0], b[1] - a[1]) / dt;
    if (v > peak) {
      peak = v;
      release = t;
    }
  }
  const plant = pitchingTruth(s).events.plant;
  const P = pitchingPose(plant, s);
  const R = pitchingPose(release, s);
  return {
    events: { liftTop, plant, release },
    stride: ((P.leadAnkle[0] - P.rearAnkle[0]) * s) / T,
    kneePlant: angleAt(pt(P.leadHip), pt(P.leadKnee), pt(P.leadAnkle)),
    kneeRelease: angleAt(pt(R.leadHip), pt(R.leadKnee), pt(R.leadAnkle)),
    trunk: leanFromVertical(pt(R.hip), pt(R.sh), s),
    elbow: (P.rearSh[1] - P.rearElbow[1]) / T,
  };
}

const cases = [
  { name: 'pitching-240fps', evTol: 0.025, posTol: 0.04, angTol: 3 },
  { name: 'pitching-lefty-120fps-noisy', evTol: 0.03, posTol: 0.06, angTol: 5 },
  { name: 'pitching-30fps', evTol: 0.05, posTol: 0.1, angTol: 8 },
];

describe('analyzePitching on synthetic fixtures', () => {
  for (const c of cases) {
    describe(c.name, () => {
      const { seq, params } = loadFixture(c.name);
      const s = params.forward ?? 1;
      const r = analyzePitching(seq);
      const tr = truth(s);

      it('passes QC and finds direction', () => {
        expect(r.failure).toBeUndefined();
        expect(r.forward).toBe(s);
      });
      it('detects leg-lift top, foot plant and release', () => {
        expect(Math.abs(r.events.liftTop! - tr.events.liftTop)).toBeLessThan(c.evTol + 0.02);
        expect(Math.abs(r.events.plant! - tr.events.plant)).toBeLessThan(c.evTol);
        expect(Math.abs(r.events.release! - tr.events.release)).toBeLessThan(c.evTol);
        expect(r.events.finish!).toBeGreaterThan(r.events.release!);
      });
      it('measures stride, knee angles, trunk tilt and elbow height', () => {
        expect(Math.abs(r.metrics.stride_length!.value - tr.stride)).toBeLessThan(c.posTol);
        expect(Math.abs(r.metrics.lead_knee_plant!.value - tr.kneePlant)).toBeLessThan(c.angTol);
        expect(Math.abs(r.metrics.lead_knee_release!.value - tr.kneeRelease)).toBeLessThan(
          c.angTol,
        );
        expect(Math.abs(r.metrics.trunk_forward_release!.value - tr.trunk)).toBeLessThan(c.angTol);
        expect(Math.abs(r.metrics.elbow_height_plant!.value - tr.elbow)).toBeLessThan(c.posTol);
      });
      it('reports lift-to-release total time as the sum of its phases', () => {
        const a =
          r.metrics.phase_lift_to_plant_ms!.value + r.metrics.phase_plant_to_release_ms!.value;
        expect(r.metrics.phase_lift_to_release_ms!.value).toBeCloseTo(a, 0);
        expect(
          Math.abs(
            r.metrics.phase_lift_to_release_ms!.value -
              (tr.events.release - tr.events.liftTop) * 1000,
          ),
        ).toBeLessThan((c.evTol + 0.03) * 1000);
      });
    });
  }

  it('is deterministic', () => {
    const { seq } = loadFixture('pitching-lefty-120fps-noisy');
    expect(analyzePitching(seq)).toEqual(analyzePitching(structuredClone(seq)));
  });

  it('applies a time scale for stretched slow motion (durations in real time, events in media time)', () => {
    const { seq } = loadFixture('pitching-240fps');
    const stretched = { ...seq, frames: seq.frames.map((f) => ({ ...f, t: f.t * 8 })) };
    const plain = analyze('pitching', seq);
    const fixed = analyze('pitching', stretched, { timeScale: 1 / 8 });
    expect(fixed.failure).toBeUndefined();
    expect(fixed.metrics.phase_plant_to_release_ms!.value).toBeCloseTo(
      plain.metrics.phase_plant_to_release_ms!.value,
      0,
    );
    expect(fixed.events.release!).toBeCloseTo(plain.events.release! * 8, 2);
  });

  it('rejects when the pitcher is lost during the delivery', () => {
    const { seq } = loadFixture('pitching-240fps');
    const lost = {
      ...seq,
      frames: seq.frames.map((f) => (f.t > 0.95 && f.t < 1.2 ? { t: f.t, lm: null } : f)),
    };
    const r = analyzePitching(lost);
    expect(r.failure).toBeDefined();
    expect(r.metrics).toEqual({});
  });
});
