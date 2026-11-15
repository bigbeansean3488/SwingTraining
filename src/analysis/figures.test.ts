import { describe, expect, it } from 'vitest';
import { analyze } from './index';
import { metricFigures, type FigureShape, type MetricFigure } from './figures';
import { angleAt } from './geometry';
import { loadFixture } from '../../tests/fixtures';

function shape<T extends FigureShape['type']>(f: MetricFigure | undefined, type: T) {
  const s = f?.shapes.find((x) => x.type === type);
  if (!s) throw new Error(`missing ${type}`);
  return s as Extract<FigureShape, { type: T }>;
}

/** Signed horizontal arrow length in torso units, along the motion direction. */
// Metrics are stored rounded (torso units: 3 decimals, degrees: 1 decimal).
const dxTorso = (f: MetricFigure | undefined, torso: number, forward: number) => {
  const a = shape(f, 'arrow');
  return ((a.to.x - a.from.x) * forward) / torso;
};

describe('metric figures match the reported metrics', () => {
  for (const name of ['batting-240fps', 'batting-lefty-240fps-noisy', 'batting-30fps']) {
    it(name, () => {
      const { seq } = loadFixture(name);
      const r = analyze('batting', seq);
      expect(r.failure).toBeUndefined();
      const { figures: f, torso, forward } = metricFigures('batting', seq, r.events);
      const m = r.metrics;
      expect(forward).toBe(r.forward);
      expect(dxTorso(f.stride_length, torso, forward)).toBeCloseTo(m.stride_length!.value, 3);
      expect(dxTorso(f.pelvis_shift, torso, forward)).toBeCloseTo(m.pelvis_shift!.value, 3);
      expect(dxTorso(f.head_dx, torso, forward)).toBeCloseTo(m.head_dx!.value, 3);
      const hy = shape(f.head_dy, 'arrow');
      expect((hy.from.y - hy.to.y) / torso).toBeCloseTo(m.head_dy!.value, 3);
      for (const k of ['lead_knee_plant', 'lead_knee_contact'] as const) {
        const a = shape(f[k], 'angle');
        expect(angleAt(a.a, a.b, a.c)).toBeCloseTo(m[k]!.value, 1);
      }
      const tr = shape(f.trunk_tilt_contact, 'angle');
      expect(angleAt(tr.a, tr.b, tr.c)).toBeCloseTo(Math.abs(m.trunk_tilt_contact!.value), 1);
      expect(f.stride_length!.event).toBe('plant');
      expect(f.stride_length!.t).toBeCloseTo(r.events.plant!, 9);
      expect(shape(f.wrist_peak_speed, 'path').points.length).toBeGreaterThan(2);
    });
  }

  for (const name of ['pitching-240fps', 'pitching-lefty-120fps-noisy']) {
    it(name, () => {
      const { seq } = loadFixture(name);
      const r = analyze('pitching', seq);
      expect(r.failure).toBeUndefined();
      const { figures: f, torso, forward } = metricFigures('pitching', seq, r.events);
      const m = r.metrics;
      expect(dxTorso(f.stride_length, torso, forward)).toBeCloseTo(m.stride_length!.value, 3);
      for (const k of ['lead_knee_plant', 'lead_knee_release'] as const) {
        const a = shape(f[k], 'angle');
        expect(angleAt(a.a, a.b, a.c)).toBeCloseTo(m[k]!.value, 1);
      }
      const tr = shape(f.trunk_forward_release, 'angle');
      expect(angleAt(tr.a, tr.b, tr.c)).toBeCloseTo(Math.abs(m.trunk_forward_release!.value), 1);
      const e = shape(f.elbow_height_plant, 'arrow');
      expect((e.from.y - e.to.y) / torso).toBeCloseTo(m.elbow_height_plant!.value, 3);
      expect(f.lead_knee_release!.t).toBeCloseTo(r.events.release!, 9);
    });
  }

  it('follows a time-scaled (stretched slow-motion) analysis', () => {
    const { seq } = loadFixture('batting-240fps');
    const s = 8;
    const stretched = { ...seq, frames: seq.frames.map((fr) => ({ ...fr, t: fr.t * s })) };
    const r = analyze('batting', stretched, { timeScale: 1 / s });
    expect(r.failure).toBeUndefined();
    const { figures: f } = metricFigures('batting', stretched, r.events, 1 / s);
    const a = shape(f.lead_knee_contact, 'angle');
    expect(angleAt(a.a, a.b, a.c)).toBeCloseTo(r.metrics.lead_knee_contact!.value, 1);
    expect(f.lead_knee_contact!.t).toBeCloseTo(r.events.contact!, 6);
  });

  it('returns nothing without events', () => {
    const { seq } = loadFixture('batting-240fps');
    expect(metricFigures('batting', seq, {}).figures).toEqual({});
  });
});
