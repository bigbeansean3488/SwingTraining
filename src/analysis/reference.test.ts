import { describe, expect, it } from 'vitest';
import { analyze } from './index';
import {
  buildTimeWarp,
  comparability,
  diffMetrics,
  normalizePose,
  normalizeSequence,
  poseAt,
  poseBounds,
  torsoLengthPx,
  warpTime,
} from './reference';
import { LM } from './landmarks';
import type { Metrics, PoseSequence } from './types';
import {
  generateBatting,
  generatePitching,
  pitchingTruth,
  SYNTH_TORSO_PX,
} from '../../tests/synthetic';

const metric = (value: number, unit: string, confidence = 0.9) => ({ value, unit, confidence });

/** Same motion seen smaller and elsewhere in the frame (farther camera, different framing). */
function reframe(seq: PoseSequence, k: number, dx: number, dy: number): PoseSequence {
  return {
    ...seq,
    frames: seq.frames.map((f) => ({
      t: f.t,
      lm: f.lm ? f.lm.map((p) => ({ x: dx + p.x * k, y: dy + p.y * k, v: p.v })) : null,
    })),
  };
}

describe('time alignment', () => {
  const user = { events: { liftTop: 0.6, plant: 1.0, release: 1.15, finish: 1.2 }, timeScale: 1 };
  const ref = { events: { liftTop: 0.9, plant: 1.5, release: 1.7, finish: 1.8 }, timeScale: 1 };

  it('maps every shared event onto the same event of the reference', () => {
    const w = buildTimeWarp('pitching', user, ref);
    expect(w.anchors.map((a) => a.event)).toEqual(['liftTop', 'plant', 'release', 'finish']);
    for (const e of ['liftTop', 'plant', 'release', 'finish'] as const)
      expect(warpTime(w, user.events[e])).toBeCloseTo(ref.events[e], 9);
  });

  it('stretches each phase linearly between events', () => {
    const w = buildTimeWarp('pitching', user, ref);
    // Halfway between lift top and plant -> halfway in the reference too.
    expect(warpTime(w, 0.8)).toBeCloseTo(1.2, 9);
    // A quarter of the way from plant to release.
    expect(warpTime(w, 1.0375)).toBeCloseTo(1.55, 9);
  });

  it('runs at real speed outside the shared events, honouring slow-motion time scales', () => {
    // Reference saved as stretched slow motion: 1 media second = 1/8 real second.
    const slow = {
      events: { liftTop: 4.8, plant: 8, release: 9.2, finish: 9.6 },
      timeScale: 1 / 8,
    };
    const w = buildTimeWarp('pitching', user, slow);
    // 0.1 real seconds before lift top = 0.8 media seconds in the slow clip.
    expect(warpTime(w, 0.5)).toBeCloseTo(4.0, 9);
    expect(warpTime(w, 1.3)).toBeCloseTo(9.6 + 0.1 * 8, 9);
  });

  it('skips events that would run time backwards and falls back to real time without events', () => {
    const bad = { events: { liftTop: 0.9, plant: 1.8, release: 1.7, finish: 1.9 }, timeScale: 1 };
    const w = buildTimeWarp('pitching', user, bad);
    expect(w.anchors.map((a) => a.event)).toEqual(['liftTop', 'plant', 'finish']);
    const none = buildTimeWarp('pitching', user, { events: {}, timeScale: 1 });
    expect(none.anchors).toEqual([]);
    expect(warpTime(none, 0.7)).toBeCloseTo(0.7, 9);
  });

  it('aligns two detected motions with different tempo', () => {
    const fast = analyze('pitching', generatePitching({ fps: 240 }) as PoseSequence);
    const slow = analyze('pitching', generatePitching({ fps: 120, tempo: 1.25 }) as PoseSequence);
    expect(fast.failure).toBeUndefined();
    expect(slow.failure).toBeUndefined();
    const w = buildTimeWarp(
      'pitching',
      { events: fast.events, timeScale: 1 },
      { events: slow.events, timeScale: 1 },
    );
    const truth = pitchingTruth(1, 1.25).events;
    expect(warpTime(w, fast.events.release!)).toBeCloseTo(truth.release, 1);
    expect(warpTime(w, fast.events.plant!)).toBeCloseTo(truth.plant, 1);
  });
});

describe('spatial normalization', () => {
  const seq = generatePitching({ fps: 120 }) as PoseSequence;

  it('measures the torso length in pixels', () => {
    expect(torsoLengthPx(seq)).toBeCloseTo(SYNTH_TORSO_PX, -1);
  });

  it('puts the pelvis at the origin and the torso at one unit', () => {
    const ns = normalizeSequence(seq, 1);
    const pose = ns.poses[60]!;
    const hip = {
      x: (pose[LM.L_HIP]!.x + pose[LM.R_HIP]!.x) / 2,
      y: (pose[LM.L_HIP]!.y + pose[LM.R_HIP]!.y) / 2,
    };
    expect(hip.x).toBeCloseTo(0, 9);
    expect(hip.y).toBeCloseTo(0, 9);
    const sh = {
      x: (pose[LM.L_SHOULDER]!.x + pose[LM.R_SHOULDER]!.x) / 2,
      y: (pose[LM.L_SHOULDER]!.y + pose[LM.R_SHOULDER]!.y) / 2,
    };
    expect(Math.hypot(sh.x, sh.y)).toBeCloseTo(1, 1);
    expect(sh.y).toBeLessThan(0); // shoulders above the pelvis
  });

  it('is unaffected by camera distance, framing and throwing side', () => {
    // A mirrored (left-handed) athlete has the left/right labels swapped.
    const pairs = [
      [LM.NOSE, LM.NOSE],
      [LM.L_WRIST, LM.R_WRIST],
      [LM.R_ANKLE, LM.L_ANKLE],
      [LM.L_KNEE, LM.R_KNEE],
    ] as const;
    const base = normalizeSequence(seq, 1);
    const far = normalizeSequence(reframe(seq, 0.5, 0.3, 0.2), 1);
    const mirrored = normalizeSequence(
      generatePitching({ fps: 120, forward: -1 }) as PoseSequence,
      -1,
    );
    for (const i of [10, 72, 120, 150]) {
      for (const [k, m] of pairs) {
        const p = base.poses[i]![k]!;
        expect(far.poses[i]![k]!.x).toBeCloseTo(p.x, 2);
        expect(far.poses[i]![k]!.y).toBeCloseTo(p.y, 2);
        expect(mirrored.poses[i]![m]!.x).toBeCloseTo(p.x, 2);
        expect(mirrored.poses[i]![m]!.y).toBeCloseTo(p.y, 2);
      }
    }
  });

  it('marks missing points and frames without a pelvis', () => {
    const lm = seq.frames[0]!.lm!.map((p, i) => (i === LM.NOSE ? { ...p, v: 0.1 } : p));
    const pose = normalizePose(lm, seq, 220, 1)!;
    expect(pose[LM.NOSE]!.v).toBe(0);
    const noHip = lm.map((p, i) => (i === LM.L_HIP ? { ...p, v: 0 } : p));
    expect(normalizePose(noHip, seq, 220, 1)).toBeNull();
    expect(normalizePose(null, seq, 220, 1)).toBeNull();
    expect(normalizePose(lm, seq, NaN, 1)).toBeNull();
  });

  it('interpolates between frames and holds the ends', () => {
    const ns = normalizeSequence(seq, 1);
    const a = ns.poses[30]![LM.R_WRIST]!;
    const b = ns.poses[31]![LM.R_WRIST]!;
    const mid = poseAt(ns, (ns.times[30]! + ns.times[31]!) / 2)![LM.R_WRIST]!;
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 9);
    expect(poseAt(ns, -1)).toBe(ns.poses[0]);
    expect(poseAt(ns, 99)).toBe(ns.poses[ns.poses.length - 1]);
  });

  it('bounds cover the whole figure', () => {
    const b = poseBounds([normalizeSequence(seq, 1)]);
    expect(b.minY).toBeLessThan(-1); // head above the shoulders
    expect(b.maxY).toBeGreaterThan(1); // feet below the pelvis
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(poseBounds([])).toEqual({ minX: -1.5, maxX: 1.5, minY: -2, maxY: 2.5 });
  });
});

describe('metric differences', () => {
  it('reports you − reference with a direction for detected motions', () => {
    const you = analyze('pitching', generatePitching({ fps: 240, stride: 1.3 }) as PoseSequence);
    const ref = analyze('pitching', generatePitching({ fps: 240, stride: 1.6 }) as PoseSequence);
    const d = diffMetrics(you.metrics, ref.metrics, ['stride_length']);
    expect(d[0]!.key).toBe('stride_length');
    expect(d[0]!.delta).toBeCloseTo(-0.3, 1);
    expect(d[0]!.direction).toBe('lower');
    expect(d.find((x) => x.key === 'trunk_forward_release')!.direction).toBe('similar');
  });

  it('skips metrics one side lacks, different units and old negative strides', () => {
    const you: Metrics = {
      stride_length: metric(-0.4, 'torso'),
      lead_knee_release: metric(150, 'deg', 0.5),
      trunk_forward_release: metric(20, 'deg'),
      phase_plant_to_release_ms: metric(150, 'ms'),
      only_you: metric(1, 'torso'),
    };
    const ref: Metrics = {
      stride_length: metric(1.2, 'torso'),
      lead_knee_release: metric(160, 'deg'),
      trunk_forward_release: metric(28, 'deg'),
      phase_plant_to_release_ms: metric(1, 'torso'),
    };
    const d = diffMetrics(you, ref, ['trunk_forward_release']);
    expect(d.map((x) => x.key)).toEqual(['trunk_forward_release', 'lead_knee_release']);
    expect(d[0]).toMatchObject({ delta: -8, direction: 'lower', lowConfidence: false });
    expect(d[1]).toMatchObject({ delta: -10, direction: 'lower', lowConfidence: true });
  });

  it('treats changes below the per-unit minimum as similar', () => {
    const d = diffMetrics(
      { a: metric(1.03, 'torso'), b: metric(92, 'deg'), c: metric(110, 'ms') },
      { a: metric(1.0, 'torso'), b: metric(90, 'deg'), c: metric(140, 'ms') },
    );
    expect(d.map((x) => x.direction)).toEqual(['similar', 'similar', 'lower']);
  });
});

describe('comparability', () => {
  const ok = { engineVersion: '1.1.0', warnings: [], forward: 1 };
  it('is clean for the same engine major and no warnings', () => {
    expect(comparability(ok, { ...ok, engineVersion: '1.0.0', forward: -1 })).toEqual([]);
  });
  it('with the motion kind, flags engine versions that measure it differently', () => {
    const side = (engineVersion: string) => ({ engineVersion, warnings: [], forward: 1 });
    // Batting contact moved in 1.2.0; pitching did not change.
    expect(comparability(side('1.2.0'), side('1.1.0'), undefined, 'batting')).toEqual([
      'engine_major_differs',
    ]);
    expect(comparability(side('1.2.0'), side('1.1.0'), undefined, 'pitching')).toEqual([]);
  });

  it('flags engine major changes, quality warnings, unknown direction and missing events', () => {
    const w = buildTimeWarp(
      'batting',
      { events: {}, timeScale: 1 },
      { events: { plant: 1 }, timeScale: 1 },
    );
    expect(
      comparability(
        { ...ok, warnings: ['fps_low'] },
        { engineVersion: '2.0.0', warnings: ['finish_not_in_clip'], forward: 0 },
        w,
      ),
    ).toEqual([
      'engine_major_differs',
      'user_warnings',
      'ref_warnings',
      'direction_unknown',
      'no_shared_events',
    ]);
  });
});

describe('batting', () => {
  it('normalizes and aligns a batting motion too', () => {
    const seq = generateBatting({ fps: 240 }) as PoseSequence;
    const r = analyze('batting', seq);
    const w = buildTimeWarp(
      'batting',
      { events: r.events, timeScale: 1 },
      { events: r.events, timeScale: 1 },
    );
    expect(w.anchors.map((a) => a.event)).toEqual(['load', 'plant', 'contact', 'finish']);
    expect(warpTime(w, 0.3)).toBeCloseTo(0.3, 9);
    expect(normalizeSequence(seq, r.forward).poses.every((p) => p !== null)).toBe(true);
  });
});
